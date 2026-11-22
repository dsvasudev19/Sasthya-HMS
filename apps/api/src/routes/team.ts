import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { can, hashPassword, temporaryPassword, type Role } from "@hms/auth";
import { effectivePlan, seatLimit } from "@hms/billing-core";
import { staffBranchesInput, teamAddInput, teamRolesInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { clearAuthzCache } from "../authz";
import { staff, staffGuard } from "../guards";
import { tenantInfo } from "../gates";
import { revokeAllFor } from "../session";
import { logAccess } from "./access";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });

export default async function teamRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  /** A role can be handed out only by someone who already holds every permission it grants (the owner holds all). */
  const mayGrant = async (req: Parameters<typeof staff>[0], tenantId: string, keys: Role[]): Promise<boolean> => {
    const roles = await db.tenantRole.findMany({ where: { tenantId, key: { in: keys } } });
    if (roles.length !== new Set(keys).size) throw httpError(400, "One of those roles does not exist");
    return roles.every((r) => r.permissions.every((p) => can(req.access!.permissions, p)));
  };

  const list = async (tenantId: string) => {
    const rows = await db.tenantMembership.findMany({ where: { tenantId }, include: { identity: true }, orderBy: { createdAt: "asc" } });
    const branches = await db.staffBranch.findMany({ where: { tenantId } });
    const by = new Map<string, { identityId: string; name: string | null; email: string | null; phone: string | null; roles: Role[]; branchIds: string[]; mustChangePassword: boolean }>();
    for (const m of rows) {
      const e = by.get(m.identityId) ?? { identityId: m.identityId, name: m.identity.fullName, email: m.identity.email, phone: m.identity.phone, roles: [], branchIds: branches.filter((b) => b.identityId === m.identityId).map((b) => b.branchId), mustChangePassword: m.identity.mustChangePassword };
      e.roles.push(m.role as Role);
      by.set(m.identityId, e);
    }
    return [...by.values()];
  };

  app.get("/team", { preHandler: staffGuard("team:manage") }, async (req) => {
    const t = await tenantInfo(db, staff(req).tid);
    const members = await list(staff(req).tid);
    return { members, seats: { used: members.length, limit: seatLimit(effectivePlan(t), t.maxSeats) } };
  });

  app.post("/team", { preHandler: staffGuard("team:manage") }, async (req, reply) => {
    const input = teamAddInput.parse(req.body);
    const tenantId = staff(req).tid;
    if (!(await mayGrant(req, tenantId, input.roles))) throw httpError(403, "You cannot give a role that grants more than you have");
    const t = await tenantInfo(db, tenantId);
    const members = await list(tenantId);
    const existing = await db.identity.findFirst({
      where: input.email ? { email: input.email } : { phone: input.phone },
    });
    const already = existing ? members.find((m) => m.identityId === existing.id) : undefined;
    if (!already && members.length >= seatLimit(effectivePlan(t), t.maxSeats)) throw Object.assign(httpError(402, `Your plan allows ${seatLimit(effectivePlan(t), t.maxSeats)} staff accounts. Upgrade to add more.`), { extra: { code: "UPGRADE", feature: "seats" } });

    let temp: string | undefined;
    let identity = existing;
    if (!identity) {
      temp = temporaryPassword();
      identity = await db.identity.create({
        data: {
          email: input.email,
          phone: input.phone,
          fullName: input.fullName,
          passwordHash: await hashPassword(temp),
          mustChangePassword: true,
        },
      });
    } else if (!identity.passwordHash) {
      temp = temporaryPassword(); // a patient who is now joining the staff
      identity = await db.identity.update({
        where: { id: identity.id },
        data: {
          passwordHash: await hashPassword(temp),
          mustChangePassword: true,
          fullName: identity.fullName ?? input.fullName,
          ...(input.email && !identity.email ? { email: input.email } : {}),
        },
      });
    }
    const have = new Set(already?.roles ?? []);
    const add = input.roles.filter((r) => !have.has(r));
    if (add.length) await db.tenantMembership.createMany({ data: add.map((role) => ({ tenantId, identityId: identity!.id, role })) });
    if (input.branchIds?.length) {
      const valid = await withTenant(db, tenantId, (tx) => tx.branch.findMany({ where: { id: { in: input.branchIds }, active: true }, select: { id: true } }));
      if (valid.length !== new Set(input.branchIds).size) throw httpError(404, "Branch not found");
      await db.staffBranch.createMany({ data: valid.map((b) => ({ tenantId, identityId: identity!.id, branchId: b.id })), skipDuplicates: true });
    }
    clearAuthzCache(tenantId);
    return reply.code(201).send({ identityId: identity.id, email: identity.email, phone: identity.phone, roles: [...have, ...add], temporaryPassword: temp });
  });

  const lastOwnerGuard = async (tenantId: string, identityId: string) => {
    const owners = await db.tenantMembership.findMany({ where: { tenantId, role: "OWNER" } });
    if (owners.length === 1 && owners[0]!.identityId === identityId) throw httpError(409, "A hospital needs at least one owner");
  };

  app.put("/team/:id/roles", { preHandler: staffGuard("team:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { roles } = teamRolesInput.parse(req.body);
    const tenantId = staff(req).tid;
    const current = (await db.tenantMembership.findMany({ where: { tenantId, identityId: id } })).map((m) => m.role as Role);
    if (current.length === 0) throw httpError(404, "Staff member not found");
    const changed = [...roles.filter((r) => !current.includes(r)), ...current.filter((r) => !roles.includes(r))];
    if (!(await mayGrant(req, tenantId, changed))) throw httpError(403, "You cannot change roles that grant more than you have");
    if (current.includes("OWNER") && !roles.includes("OWNER")) await lastOwnerGuard(tenantId, id);
    await db.$transaction([
      db.tenantMembership.deleteMany({ where: { tenantId, identityId: id, role: { notIn: roles } } }),
      db.tenantMembership.createMany({ data: roles.filter((r) => !current.includes(r)).map((role) => ({ tenantId, identityId: id, role })), skipDuplicates: true }),
    ]);
    clearAuthzCache(tenantId);
    await revokeAllFor(db, id); // new roles apply at the next sign-in
    await logAccess(db, tenantId, staff(req).sub, "access.team.roles", id, { before: current, after: roles });
    return { identityId: id, roles };
  });

  app.delete("/team/:id", { preHandler: staffGuard("team:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    if (id === staff(req).sub) throw httpError(409, "You cannot remove yourself");
    const current = (await db.tenantMembership.findMany({ where: { tenantId, identityId: id } })).map((m) => m.role as Role);
    if (current.length === 0) throw httpError(404, "Staff member not found");
    if (!(await mayGrant(req, tenantId, current))) throw httpError(403, "You cannot remove someone with more access than you have");
    await lastOwnerGuard(tenantId, id);
    await db.tenantMembership.deleteMany({ where: { tenantId, identityId: id } });
    await db.staffBranch.deleteMany({ where: { tenantId, identityId: id } });
    clearAuthzCache(tenantId);
    await revokeAllFor(db, id);
    return { removed: true };
  });

  // Which branches a staff member can work in. Staff whose role has "work in every branch" are not limited by this.
  app.put("/team/:id/branches", { preHandler: staffGuard("team:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { branchIds } = staffBranchesInput.parse(req.body);
    const tenantId = staff(req).tid;
    if ((await db.tenantMembership.count({ where: { tenantId, identityId: id } })) === 0) throw httpError(404, "Staff member not found");
    const valid = await withTenant(db, tenantId, (tx) => tx.branch.findMany({ where: { id: { in: branchIds }, active: true }, select: { id: true } }));
    if (valid.length !== new Set(branchIds).size) throw httpError(404, "Branch not found");
    await db.$transaction([
      db.staffBranch.deleteMany({ where: { tenantId, identityId: id } }),
      db.staffBranch.createMany({ data: valid.map((b) => ({ tenantId, identityId: id, branchId: b.id })) }),
    ]);
    clearAuthzCache(tenantId);
    await logAccess(db, tenantId, staff(req).sub, "access.team.branches", id, { branchIds: valid.map((b) => b.id) });
    return { identityId: id, branchIds: valid.map((b) => b.id) };
  });

  app.post("/team/:id/reset-password", { preHandler: staffGuard("team:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const roles = (await db.tenantMembership.findMany({ where: { tenantId, identityId: id } })).map((m) => m.role as Role);
    if (roles.length === 0) throw httpError(404, "Staff member not found");
    if (!(await mayGrant(req, tenantId, roles))) throw httpError(403, "You cannot reset someone with more access than you have");
    const temp = temporaryPassword();
    await db.identity.update({ where: { id }, data: { passwordHash: await hashPassword(temp), mustChangePassword: true } });
    await revokeAllFor(db, id);
    return { temporaryPassword: temp };
  });
}
