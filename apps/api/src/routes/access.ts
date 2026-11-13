import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ALL_PERMISSIONS, PERMISSION_CATALOG, POLICY_ATTRIBUTES, can, deniedBy, expandPermissions, type Policy } from "@hms/auth";
import { auditQuery, branchInput, branchPatch, overrideInput, policyInput, policySimulateInput, roleInput, rolePatch } from "@hms/contracts";
import { effectivePlan, hasFeature } from "@hms/billing-core";
import { withTenant, type PrismaClient } from "@hms/db";
import { clearAuthzCache, istParts, toPolicy } from "../authz";
import { featuresOf, tenantInfo } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });

/** Who changed access, and how. Every change to roles, policies, personal grants or branches leaves a row here. */
export async function logAccess(db: PrismaClient, tenantId: string, actor: string, action: string, entityId: string | null, meta: object) {
  await withTenant(db, tenantId, (tx) => tx.auditLog.create({ data: { tenantId, actorIdentityId: actor, action, entity: "access", entityId, meta } }));
}
const validPermission = (p: string) => p === "*" || ALL_PERMISSIONS.includes(p) || (p.endsWith(":*") && ALL_PERMISSIONS.some((x) => x.startsWith(p.slice(0, -1))));

/** Roles, policies and branches: the pieces a hospital shapes its own access control from. */
export default async function accessRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/permissions", { preHandler: staffGuard("team:manage") }, async () => ({ permissions: PERMISSION_CATALOG, attributes: POLICY_ATTRIBUTES }));

  // ── roles ──
  app.get("/roles", { preHandler: staffGuard("team:manage") }, async (req) => {
    const tenantId = staff(req).tid;
    const roles = await db.tenantRole.findMany({ where: { tenantId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
    const counts = await db.tenantMembership.groupBy({ by: ["role"], where: { tenantId }, _count: { _all: true } });
    return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, customized: r.customized, permissions: r.permissions, members: counts.find((c) => c.role === r.key)?._count._all ?? 0 }));
  });

  /** Nobody can build or edit a role that grants more than they hold themselves. */
  const assertCovers = (req: Parameters<typeof staff>[0], perms: string[]) => {
    for (const p of perms) {
      if (!validPermission(p)) throw httpError(400, `Unknown permission ${p}`);
      if (!can(req.access!.permissions, p)) throw httpError(403, `You cannot grant ${p} because you do not have it`);
    }
  };

  app.post("/roles", { preHandler: staffGuard("roles:manage") }, async (req, reply) => {
    const input = roleInput.parse(req.body);
    const tenantId = staff(req).tid;
    assertCovers(req, input.permissions);
    if (await db.tenantRole.findUnique({ where: { tenantId_key: { tenantId, key: input.key } } })) throw httpError(409, "A role with that key already exists");
    const r = await db.tenantRole.create({ data: { tenantId, key: input.key, name: input.name, description: input.description, isSystem: false, permissions: [...new Set(input.permissions)] } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.role.create", r.id, { key: r.key, permissions: r.permissions });
    return reply.code(201).send(r);
  });

  app.patch("/roles/:id", { preHandler: staffGuard("roles:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = rolePatch.parse(req.body);
    const tenantId = staff(req).tid;
    const role = await db.tenantRole.findFirst({ where: { id, tenantId } });
    if (!role) throw httpError(404, "Role not found");
    if (role.key === "OWNER") throw httpError(409, "The owner role cannot be changed");
    if (input.permissions) assertCovers(req, [...new Set([...input.permissions, ...role.permissions.filter((p) => !input.permissions!.includes(p))])]);
    const r = await db.tenantRole.update({ where: { id }, data: { ...input, ...(input.permissions ? { permissions: [...new Set(input.permissions)] } : {}), customized: role.isSystem ? true : role.customized } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.role.update", id, { key: role.key, before: role.permissions, after: r.permissions });
    return r;
  });

  app.delete("/roles/:id", { preHandler: staffGuard("roles:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const role = await db.tenantRole.findFirst({ where: { id, tenantId } });
    if (!role) throw httpError(404, "Role not found");
    if (role.isSystem) throw httpError(409, "Built-in roles cannot be deleted");
    if ((await db.tenantMembership.count({ where: { tenantId, role: role.key } })) > 0) throw httpError(409, "Move the people in this role to another role first");
    await db.tenantRole.delete({ where: { id } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.role.delete", id, { key: role.key });
    return { removed: true };
  });

  // ── policies ──
  app.get("/policies", { preHandler: staffGuard("policies:manage") }, async (req) =>
    db.tenantPolicy.findMany({ where: { tenantId: staff(req).tid }, orderBy: { createdAt: "asc" } }),
  );

  const policyData = (i: z.infer<typeof policyInput>) => ({
    name: i.name, description: i.description ?? null, enabled: i.enabled, permission: i.permission, appliesToRoles: i.appliesToRoles, exceptRoles: i.exceptRoles,
    match: i.match, conditions: i.conditions as never, validFrom: i.validFrom ?? null, validUntil: i.validUntil ?? null, message: i.message,
  });
  const checkPolicy = (input: z.infer<typeof policyInput>) => {
    if (input.validFrom && input.validUntil && input.validFrom >= input.validUntil) throw httpError(400, "The end of the window must be after its start");
    if (!validPermission(input.permission)) throw httpError(400, `Unknown permission ${input.permission}`);
    for (const c of input.conditions) {
      const numeric = ["amountPaise", "discountPercent", "quantity", "hour", "weekday"].includes(c.attr);
      if (numeric && ["gt", "gte", "lt", "lte", "eq", "ne"].includes(c.op) && typeof c.value !== "number") throw httpError(400, `${c.attr} needs a number`);
    }
  };

  app.post("/policies", { preHandler: staffGuard("policies:manage") }, async (req, reply) => {
    const input = policyInput.parse(req.body);
    checkPolicy(input);
    const tenantId = staff(req).tid;
    const p = await db.tenantPolicy.create({ data: { tenantId, ...policyData(input), createdBy: staff(req).sub } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.policy.create", p.id, { name: p.name, permission: p.permission });
    return reply.code(201).send(p);
  });

  app.put("/policies/:id", { preHandler: staffGuard("policies:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = policyInput.parse(req.body);
    checkPolicy(input);
    const tenantId = staff(req).tid;
    if (!(await db.tenantPolicy.findFirst({ where: { id, tenantId } }))) throw httpError(404, "Policy not found");
    const p = await db.tenantPolicy.update({ where: { id }, data: policyData(input) });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.policy.update", id, { name: p.name, enabled: p.enabled });
    return p;
  });

  app.delete("/policies/:id", { preHandler: staffGuard("policies:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    if (!(await db.tenantPolicy.findFirst({ where: { id, tenantId } }))) throw httpError(404, "Policy not found");
    const gone = await db.tenantPolicy.delete({ where: { id } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.policy.delete", id, { name: gone.name });
    return { removed: true };
  });

  // "What would happen if...": runs the hospital's policies against a made-up action without doing anything.
  app.post("/policies/simulate", { preHandler: staffGuard("policies:manage") }, async (req) => {
    const input = policySimulateInput.parse(req.body);
    const rows = await db.tenantPolicy.findMany({ where: { tenantId: staff(req).tid, enabled: true } });
    const policies: Policy[] = rows.map(toPolicy);
    const at = input.at ?? new Date();
    const denied = deniedBy(policies, { permission: input.permission, roles: input.roles, attrs: { ...istParts(at), ...input.attrs }, now: at });
    return denied ? { allowed: false, policy: denied.name, message: denied.message } : { allowed: true };
  });

  // ── one person's access: where it comes from, and exceptions to it ──
  const member = async (tenantId: string, identityId: string) => {
    const rows = await db.tenantMembership.findMany({ where: { tenantId, identityId }, include: { identity: true } });
    if (rows.length === 0) throw httpError(404, "Staff member not found");
    return { identity: rows[0]!.identity, roles: rows.map((r) => r.role) };
  };

  app.get("/team/:id/access", { preHandler: staffGuard("team:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const m = await member(tenantId, id);
    const roleRows = await db.tenantRole.findMany({ where: { tenantId, key: { in: m.roles } } });
    const overrides = await db.userAccessOverride.findMany({ where: { tenantId, identityId: id }, orderBy: { createdAt: "desc" } });
    const now = new Date();
    const live = overrides.filter((o) => !o.expiresAt || o.expiresAt > now);
    const fromRoles = new Map<string, string[]>();
    for (const r of roleRows) for (const p of expandPermissions(r.permissions)) fromRoles.set(p, [...(fromRoles.get(p) ?? []), r.name]);
    const grants = new Set(live.filter((o) => o.effect === "GRANT").flatMap((o) => [...expandPermissions([o.permission])]));
    const revokes = new Set(live.filter((o) => o.effect === "REVOKE").flatMap((o) => [...expandPermissions([o.permission])]));
    const permissions = PERMISSION_CATALOG.map((p) => {
      const viaRoles = fromRoles.get(p.key) ?? [];
      const granted = grants.has(p.key), revoked = revokes.has(p.key);
      return { key: p.key, group: p.group, label: p.label, allowed: !revoked && (viaRoles.length > 0 || granted), viaRoles, viaGrant: granted, revoked };
    });
    const policies = (await db.tenantPolicy.findMany({ where: { tenantId, enabled: true } })).map(toPolicy)
      .filter((p) => (p.appliesToRoles.length === 0 || m.roles.some((r) => p.appliesToRoles.includes(r))) && !(p.exceptRoles ?? []).some((r) => m.roles.includes(r)));
    const mine = await db.staffBranch.findMany({ where: { tenantId, identityId: id } });
    return {
      person: { id: m.identity.id, name: m.identity.fullName, phone: m.identity.phone },
      roles: roleRows.map((r) => ({ key: r.key, name: r.name })),
      permissions, overrides: overrides.map((o) => ({ id: o.id, permission: o.permission, effect: o.effect, reason: o.reason, expiresAt: o.expiresAt, createdAt: o.createdAt, active: !o.expiresAt || o.expiresAt > now })),
      policies: policies.map((p) => ({ id: p.id, name: p.name, permission: p.permission, message: p.message })),
      branchIds: mine.map((b) => b.branchId),
    };
  });

  app.post("/team/:id/overrides", { preHandler: staffGuard("roles:manage") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = overrideInput.parse(req.body);
    const tenantId = staff(req).tid;
    if (!validPermission(input.permission) || input.permission === "*") throw httpError(400, "Choose a specific permission or a group such as billing:*");
    if (id === staff(req).sub) throw httpError(409, "You cannot change your own access");
    const m = await member(tenantId, id);
    if (m.roles.includes("OWNER")) throw httpError(409, "The owner's access cannot be reduced or extended with exceptions");
    if (input.effect === "GRANT") for (const p of expandPermissions([input.permission])) if (!can(req.access!.permissions, p)) throw httpError(403, `You cannot grant ${p} because you do not have it`);
    if (input.expiresAt && input.expiresAt <= new Date()) throw httpError(400, "The end date must be in the future");
    const o = await db.userAccessOverride.create({ data: { tenantId, identityId: id, permission: input.permission, effect: input.effect, reason: input.reason, expiresAt: input.expiresAt ?? null, createdBy: staff(req).sub } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.override.create", o.id, { person: id, permission: o.permission, effect: o.effect, expiresAt: o.expiresAt, reason: o.reason });
    return reply.code(201).send(o);
  });

  app.delete("/team/:id/overrides/:oid", { preHandler: staffGuard("roles:manage") }, async (req) => {
    const { id, oid } = z.object({ id: z.string().uuid(), oid: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    const o = await db.userAccessOverride.findFirst({ where: { id: oid, identityId: id, tenantId } });
    if (!o) throw httpError(404, "Exception not found");
    await db.userAccessOverride.delete({ where: { id: oid } });
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.override.remove", oid, { person: id, permission: o.permission, effect: o.effect });
    return { removed: true };
  });

  // ── the audit trail ──
  app.get("/audit", { preHandler: staffGuard("audit:read") }, async (req) => {
    const q = auditQuery.parse(req.query);
    const tenantId = staff(req).tid;
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.auditLog.findMany({
        where: {
          ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.actor ? { actorIdentityId: q.actor } : {}), ...(q.entity ? { entity: q.entity } : {}),
          createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000) } : {}), ...(q.before ? { lt: new Date(q.before) } : {}) },
        },
        orderBy: { createdAt: "desc" }, take: q.limit + 1,
      }),
    );
    const names = new Map((await db.identity.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorIdentityId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
    const page = rows.slice(0, q.limit);
    return { rows: page.map((r) => ({ ...r, actorName: r.actorIdentityId ? names.get(r.actorIdentityId) ?? null : null })), next: rows.length > q.limit ? page[page.length - 1]!.createdAt : null };
  });

  // ── branches ──
  app.get("/branches", { preHandler: staffGuard("patients:read") }, async (req) => ({ branches: req.access!.allowed, active: req.access!.branchId, viewingAll: req.access!.viewingAll }));

  app.get("/branches/manage", { preHandler: staffGuard("branches:manage") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.branch.findMany({ orderBy: [{ isMain: "desc" }, { name: "asc" }] })),
  );

  app.post("/branches", { preHandler: staffGuard("branches:manage") }, async (req, reply) => {
    const input = branchInput.parse(req.body);
    const tenantId = staff(req).tid;
    const t = await tenantInfo(db, tenantId);
    const created = await withTenant(db, tenantId, async (tx) => {
      if ((await tx.branch.count({ where: { active: true } })) >= (t.maxBranches ?? (featuresOf(t).includes("multi_branch") ? Infinity : 1))) throw Object.assign(httpError(402, "Your plan covers one branch. Upgrade to Unlimited to add more.", { code: "UPGRADE", feature: "multi_branch" }));
      if (await tx.branch.findUnique({ where: { tenantId_code: { tenantId, code: input.code } } })) throw httpError(409, "A branch with that code already exists");
      return tx.branch.create({ data: { tenantId, ...input } });
    });
    clearAuthzCache(tenantId);
    return reply.code(201).send(created);
  });

  app.patch("/branches/:id", { preHandler: staffGuard("branches:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = branchPatch.parse(req.body);
    const tenantId = staff(req).tid;
    const b = await withTenant(db, tenantId, async (tx) => {
      const branch = await tx.branch.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!branch) throw httpError(404, "Branch not found");
      if (branch.isMain && (input.active === false || (input.code && input.code !== "MAIN"))) throw httpError(409, "The main branch cannot be deactivated or renamed to another code");
      return tx.branch.update({ where: { id }, data: input });
    });
    clearAuthzCache(tenantId);
    return b;
  });
}
