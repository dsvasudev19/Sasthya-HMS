import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashPassword, temporaryPassword } from "@hms/auth";
import { FEATURE_CATALOG, PLANS, TRIAL_DAYS, resolveFeatures, type Feature } from "@hms/billing-core";
import { withTenant, type PrismaClient } from "@hms/db";
import { clearTenantCache } from "../gates";
import { clearFlagCache, platformFlags } from "../flags";
import { clearAuthzCache } from "../authz";
import { clearSecurityCache } from "../security";
import { platformGuard, platformUser, staffGuard, staff } from "../guards";
import { provisionTenant } from "../provision";
import { revokeAllFor } from "../session";
import { flushLogs, logEvent, purgeLogs } from "../syslog";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const phone = z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number");
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const profileShape = z.object({
  legalName: text(3, 150), entityType: z.enum(["PRIVATE_LIMITED", "LLP", "PARTNERSHIP", "PROPRIETORSHIP", "TRUST", "GOVERNMENT", "OTHER"]),
  registrationNo: optText(60), drugLicenceNo: optText(60),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "That GSTIN is not valid").optional().or(z.literal("").transform(() => undefined)),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "That PAN is not valid").optional().or(z.literal("").transform(() => undefined)),
  addressLine1: text(3, 150), addressLine2: optText(150), city: text(2, 60), state: text(2, 60), pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode"),
  contactEmail: z.string().trim().email().max(120), contactPhone: optText(15), website: optText(120), bedCount: z.number().int().min(0).max(5000).optional(),
  adminDesignation: optText(60), adminEmail: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)),
  billingEmail: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)), billingContact: optText(100),
});
const agreementShape = z.object({
  kind: z.enum(["MSA", "DPA", "ORDER_FORM", "BAA", "OTHER"]), version: text(1, 30), signedByName: text(2, 100), signedByTitle: text(2, 80), signedByEmail: z.string().trim().email().max(120),
  signedAt: z.coerce.date(), effectiveFrom: z.coerce.date(), termMonths: z.number().int().min(1).max(120), autoRenew: z.boolean().default(true), documentRef: optText(120), notes: optText(400),
});
/** A hospital needs its clinical registration; a pharmacy needs its drug licence. Without them we should not switch the account on. */
function needsLicences(kind: string, p: { registrationNo?: string; drugLicenceNo?: string }) {
  if (kind !== "PHARMACY" && !p.registrationNo) throw httpError(400, "Enter the clinical establishment registration number");
  if (kind === "PHARMACY" && !p.drugLicenceNo) throw httpError(400, "Enter the drug licence number");
}
const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key) as [Feature, ...Feature[]];

/** Everything an operator does is written here with who did it. */
export async function operatorAudit(db: PrismaClient, req: FastifyRequest, action: string, o: { tenantId?: string; type?: string; id?: string; meta?: object } = {}) {
  const op = platformUser(req).sub;
  await db.platformAudit.create({ data: { operatorId: op, action, targetTenantId: o.tenantId, targetType: o.type, targetId: o.id, meta: o.meta as never, ip: req.ip } });
  logEvent({ level: "INFO", source: "platform", message: action, identityId: op, tenantId: o.tenantId, ip: req.ip, meta: o.meta as Record<string, unknown> | undefined });
}

export default async function platformOpsRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", platformGuard);
  const names = async (ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

  // ── onboarding ──
  app.post("/platform/tenants", async (req, reply) => {
    const input = z.object({
      name: z.string().trim().min(3).max(100),
      kind: z.enum(["HOSPITAL", "CLINIC", "PHARMACY"]),
      planCode: z.enum(["PAY_PER_PATIENT", "STARTER", "UNLIMITED"]),
      status: z.enum(["TRIAL", "ACTIVE"]).default("TRIAL"),
      trialDays: z.number().int().min(1).max(365).default(TRIAL_DAYS),
      branchName: z.string().trim().min(2).max(100).optional(),
      owner: z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().toLowerCase().optional(), phone: phone.optional() }).refine((d) => !!d.email || !!d.phone, { message: "Owner email or phone is required" }),
      profile: profileShape,
      agreements: z.array(agreementShape).min(1, "Record the signed agreement before creating the account").max(6),
      features: z.array(z.object({ feature: z.enum(FEATURE_KEYS), enabled: z.boolean() })).default([]),
      limits: z.object({ maxSeats: z.number().int().min(1).max(10_000).nullable().optional(), maxBranches: z.number().int().min(1).max(500).nullable().optional() }).optional(),
      note: z.string().trim().max(300).optional(),
    }).parse(req.body);
    needsLicences(input.kind, input.profile);
    if (!input.agreements.some((a) => a.kind === "MSA")) throw httpError(400, "A master services agreement is required");
    const existing = await db.identity.findFirst({
      where: {
        OR: [
          ...(input.owner.email ? [{ email: input.owner.email }] : []),
          ...(input.owner.phone ? [{ phone: input.owner.phone }] : []),
        ],
      },
    });
    // A person who already has a password keeps it; a new owner gets a temporary one, shown once, that they must change at first sign-in.
    let temp: string | undefined;
    const identity = existing?.passwordHash
      ? existing
      : await (async () => {
          temp = temporaryPassword();
          const passwordHash = await hashPassword(temp);
          const data = {
            passwordHash,
            mustChangePassword: true,
            fullName: existing?.fullName ?? input.owner.name,
            email: input.owner.email ?? input.profile.adminEmail ?? undefined,
            phone: input.owner.phone,
          };
          return existing ? db.identity.update({ where: { id: existing.id }, data }) : db.identity.create({ data });
        })();
    const tenant = await provisionTenant(db, { name: input.name, kind: input.kind, planCode: input.planCode, status: input.status, trialDays: input.trialDays, ownerIdentityId: identity.id, branchName: input.branchName });
    const op = platformUser(req).sub;
    await db.tenantProfile.create({ data: { tenantId: tenant.id, ...input.profile, adminEmail: input.profile.adminEmail ?? undefined, updatedBy: op } });
    await db.tenantAgreement.createMany({ data: input.agreements.map((a) => ({ ...a, tenantId: tenant.id, recordedBy: op })) });
    if (input.features.length) await db.tenantFeatureOverride.createMany({ data: input.features.map((f) => ({ tenantId: tenant.id, feature: f.feature, enabled: f.enabled, reason: "Set at onboarding", setBy: op })) });
    if (input.limits && (input.limits.maxSeats || input.limits.maxBranches)) await db.tenantLimits.create({ data: { tenantId: tenant.id, maxSeats: input.limits.maxSeats ?? null, maxBranches: input.limits.maxBranches ?? null, notes: input.note, updatedBy: op } });
    await operatorAudit(db, req, "tenant.onboard", { tenantId: tenant.id, type: "tenant", id: tenant.id, meta: { name: tenant.name, legalName: input.profile.legalName, agreements: input.agreements.map((a) => `${a.kind} v${a.version}`), kind: tenant.kind, plan: tenant.planCode, status: tenant.status, owner: input.owner.email ?? input.owner.phone, note: input.note } });
    return reply.code(201).send({ tenant: { id: tenant.id, name: tenant.name, kind: tenant.kind, slug: tenant.slug, status: tenant.status, planCode: tenant.planCode, trialEndsAt: tenant.trialEndsAt }, owner: { name: identity.fullName, email: identity.email ?? input.owner.email, phone: identity.phone ?? input.owner.phone, temporaryPassword: temp, existingAccount: !temp } });
  });

  // ── organisation record and agreements ──
  app.get("/platform/tenants/:id/profile", async (req) => {
    const { id } = idParam.parse(req.params);
    const [profile, agreements, admins] = await Promise.all([
      db.tenantProfile.findUnique({ where: { tenantId: id } }),
      db.tenantAgreement.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" } }),
      db.tenantMembership.findMany({ where: { tenantId: id, role: "OWNER" }, include: { identity: { select: { fullName: true, phone: true } } } }),
    ]);
    return { profile, agreements, admins: admins.map((m) => ({ identityId: m.identityId, name: m.identity.fullName, phone: m.identity.phone })) };
  });
  app.put("/platform/tenants/:id/profile", async (req) => {
    const { id } = idParam.parse(req.params);
    const t = await db.tenant.findUnique({ where: { id }, select: { kind: true } });
    if (!t) throw httpError(404, "Hospital not found");
    const input = profileShape.parse(req.body);
    needsLicences(t.kind, input);
    const data = { ...input, adminEmail: input.adminEmail ?? null, billingEmail: input.billingEmail ?? null, updatedBy: platformUser(req).sub };
    const row = await db.tenantProfile.upsert({ where: { tenantId: id }, create: { tenantId: id, ...data }, update: data });
    await operatorAudit(db, req, "tenant.profile", { tenantId: id, type: "tenant", id });
    return row;
  });
  app.post("/platform/tenants/:id/agreements", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await db.tenant.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, "Hospital not found");
    const input = agreementShape.parse(req.body);
    const row = await db.tenantAgreement.create({ data: { ...input, tenantId: id, recordedBy: platformUser(req).sub } });
    await operatorAudit(db, req, "tenant.agreement", { tenantId: id, type: "agreement", id: row.id, meta: { kind: row.kind, version: row.version, signedBy: row.signedByName } });
    return reply.code(201).send(row);
  });

  // ── feature switches ──
  app.get("/platform/features", async () => ({ catalog: FEATURE_CATALOG, plans: Object.values(PLANS).map((p) => ({ code: p.code, label: p.label, features: p.features })) }));

  app.get("/platform/tenants/:id/features", async (req) => {
    const { id } = idParam.parse(req.params);
    const t = await db.tenant.findUnique({ where: { id } });
    if (!t) throw httpError(404, "Hospital not found");
    const rows = await db.tenantFeatureOverride.findMany({ where: { tenantId: id } });
    const lim = await db.tenantLimits.findUnique({ where: { tenantId: id } });
    const by = new Map(rows.map((r) => [r.feature, r]));
    const planOn = new Set<Feature>([...PLANS[t.planCode].features, ...(t.kind === "PHARMACY" ? (["pharmacy"] as Feature[]) : [])]);
    const eff = new Set(resolveFeatures(t.planCode, Object.fromEntries(rows.map((r) => [r.feature, r.enabled])), t.kind === "PHARMACY" ? ["pharmacy"] : []));
    const setters = await names(rows.map((r) => r.setBy));
    return {
      tenant: { id: t.id, name: t.name, kind: t.kind, planCode: t.planCode },
      features: FEATURE_CATALOG.map((f) => ({ ...f, plan: planOn.has(f.key), override: by.get(f.key)?.enabled ?? null, effective: eff.has(f.key), reason: by.get(f.key)?.reason ?? null, setBy: by.get(f.key) ? setters.get(by.get(f.key)!.setBy) ?? null : null, setAt: by.get(f.key)?.setAt ?? null })),
      limits: { maxSeats: lim?.maxSeats ?? null, maxBranches: lim?.maxBranches ?? null, notes: lim?.notes ?? null, planSeats: PLANS[t.planCode].seats },
    };
  });

  app.put("/platform/tenants/:id/features", async (req) => {
    const { id } = idParam.parse(req.params);
    const { changes, reason } = z.object({ changes: z.array(z.object({ feature: z.enum(FEATURE_KEYS), enabled: z.boolean().nullable() })).min(1).max(30), reason: z.string().trim().min(3).max(200) }).parse(req.body);
    if (!(await db.tenant.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, "Hospital not found");
    const op = platformUser(req).sub;
    const before = Object.fromEntries((await db.tenantFeatureOverride.findMany({ where: { tenantId: id } })).map((r) => [r.feature, r.enabled]));
    for (const c of changes) {
      if (c.enabled === null) await db.tenantFeatureOverride.deleteMany({ where: { tenantId: id, feature: c.feature } });
      else await db.tenantFeatureOverride.upsert({ where: { tenantId_feature: { tenantId: id, feature: c.feature } }, update: { enabled: c.enabled, reason, setBy: op, setAt: new Date() }, create: { tenantId: id, feature: c.feature, enabled: c.enabled, reason, setBy: op } });
    }
    clearTenantCache(id);
    await operatorAudit(db, req, "tenant.features", { tenantId: id, type: "tenant", id, meta: { reason, changes: changes.map((c) => ({ feature: c.feature, from: before[c.feature] ?? null, to: c.enabled })) } });
    return { changed: changes.length };
  });

  app.put("/platform/tenants/:id/limits", async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ maxSeats: z.number().int().min(1).max(10_000).nullable(), maxBranches: z.number().int().min(1).max(500).nullable(), notes: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    if (!(await db.tenant.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, "Hospital not found");
    const op = platformUser(req).sub;
    await db.tenantLimits.upsert({ where: { tenantId: id }, update: { ...input, updatedBy: op }, create: { tenantId: id, ...input, updatedBy: op } });
    clearTenantCache(id);
    await operatorAudit(db, req, "tenant.limits", { tenantId: id, type: "tenant", id, meta: input });
    return input;
  });

  // ── people in a hospital ──
  app.get("/platform/tenants/:id/users", async (req) => {
    const { id } = idParam.parse(req.params);
    const rows = await db.tenantMembership.findMany({ where: { tenantId: id }, include: { identity: true }, orderBy: { createdAt: "asc" } });
    const by = new Map<string, { identityId: string; name: string | null; email: string | null; phone: string | null; roles: string[]; mustChangePassword: boolean; hasPassword: boolean; since: Date }>();
    for (const m of rows) { const e = by.get(m.identityId) ?? { identityId: m.identityId, name: m.identity.fullName, email: m.identity.email, phone: m.identity.phone, roles: [] as string[], mustChangePassword: m.identity.mustChangePassword, hasPassword: !!m.identity.passwordHash, since: m.createdAt }; e.roles.push(m.role); by.set(m.identityId, e); }
    const sessions = await db.refreshToken.groupBy({ by: ["identityId"], where: { tenantId: id, revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true }, _max: { createdAt: true } });
    return [...by.values()].map((u) => ({ ...u, activeSessions: sessions.find((s) => s.identityId === u.identityId)?._count._all ?? 0, lastSignIn: sessions.find((s) => s.identityId === u.identityId)?._max.createdAt ?? null }));
  });

  app.post("/platform/tenants/:id/users/:identityId/reset-password", async (req) => {
    const { id, identityId } = z.object({ id: z.string().uuid(), identityId: z.string().uuid() }).parse(req.params);
    if ((await db.tenantMembership.count({ where: { tenantId: id, identityId } })) === 0) throw httpError(404, "That person is not on this hospital's staff");
    const temp = temporaryPassword();
    await db.identity.update({ where: { id: identityId }, data: { passwordHash: await hashPassword(temp), mustChangePassword: true } });
    await revokeAllFor(db, identityId);
    await operatorAudit(db, req, "user.reset_password", { tenantId: id, type: "identity", id: identityId });
    return { temporaryPassword: temp };
  });

  app.post("/platform/tenants/:id/users/:identityId/sign-out", async (req) => {
    const { id, identityId } = z.object({ id: z.string().uuid(), identityId: z.string().uuid() }).parse(req.params);
    if ((await db.tenantMembership.count({ where: { tenantId: id, identityId } })) === 0) throw httpError(404, "That person is not on this hospital's staff");
    const r = await revokeAllFor(db, identityId);
    clearAuthzCache(id);
    await operatorAudit(db, req, "user.sign_out_everywhere", { tenantId: id, type: "identity", id: identityId, meta: { sessions: r.count } });
    return { signedOut: r.count };
  });

  app.post("/platform/tenants/:id/users/:identityId/reset-mfa", async (req) => {
    const { id, identityId } = z.object({ id: z.string().uuid(), identityId: z.string().uuid() }).parse(req.params);
    if ((await db.tenantMembership.count({ where: { tenantId: id, identityId } })) === 0) throw httpError(404, "That person is not on this hospital's staff");
    await db.identityMfa.deleteMany({ where: { identityId } });
    await revokeAllFor(db, identityId);
    clearSecurityCache();
    await operatorAudit(db, req, "user.reset_mfa", { tenantId: id, type: "identity", id: identityId });
    return { reset: true };
  });

  // Find a person across every hospital by number or name: "which hospital is this doctor at?"
  app.get("/platform/people", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(3).max(40) }).parse(req.query);
    const rows = await db.identity.findMany({ where: { OR: [{ phone: { contains: q.replace(/\D/g, "") || "xx" } }, { fullName: { contains: q, mode: "insensitive" } }], memberships: { some: {} } }, include: { memberships: { include: { tenant: { select: { id: true, name: true } } } } }, take: 20 });
    return rows.map((i) => ({ id: i.id, name: i.fullName, phone: i.phone, hospitals: [...new Map(i.memberships.map((m) => [m.tenantId, { id: m.tenant.id, name: m.tenant.name, roles: i.memberships.filter((x) => x.tenantId === m.tenantId).map((x) => x.role) }])).values()] }));
  });

  // What the hospital's own people have been doing (their audit trail), seen from the operator's side.
  app.get("/platform/tenants/:id/activity", async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ action: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(60), before: z.string().datetime().optional() }).parse(req.query);
    if (!(await db.tenant.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, "Hospital not found");
    const rows = await withTenant(db, id, (tx) => tx.auditLog.findMany({ where: { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit + 1 }));
    const who = await names(rows.map((r) => r.actorIdentityId));
    const page = rows.slice(0, q.limit);
    return { rows: page.map((r) => ({ ...r, actorName: r.actorIdentityId ? who.get(r.actorIdentityId) ?? null : null })), next: rows.length > q.limit ? page[page.length - 1]!.createdAt : null };
  });

  // ── system logs ──
  app.get("/platform/logs", async (req) => {
    await flushLogs();
    const q = z.object({
      level: z.enum(["INFO", "WARN", "ERROR", "SECURITY"]).optional(), source: z.string().trim().max(30).optional(), tenantId: z.string().uuid().optional(), q: z.string().trim().max(80).optional(),
      status: z.coerce.number().int().min(100).max(599).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(),
      before: z.string().datetime().optional(), after: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(80),
    }).parse(req.query);
    const where = {
      ...(q.level ? { level: q.level } : {}), ...(q.source ? { source: q.source } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}), ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ message: { contains: q.q, mode: "insensitive" as const } }, { route: { contains: q.q, mode: "insensitive" as const } }, { requestId: q.q }] } : {}),
      createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}), ...(q.before ? { lt: new Date(q.before) } : {}), ...(q.after ? { gt: new Date(q.after) } : {}) },
    };
    const rows = await db.systemLog.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit + 1 });
    const t = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const page = rows.slice(0, q.limit);
    return { rows: page.map((r) => ({ ...r, tenantName: r.tenantId ? t.get(r.tenantId) ?? null : null })), next: rows.length > q.limit ? page[page.length - 1]!.createdAt : null };
  });

  app.get("/platform/logs/stats", async (req) => {
    await flushLogs();
    const { hours } = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).parse(req.query);
    const since = new Date(Date.now() - hours * 3_600_000);
    const series = await db.$queryRaw<{ h: Date; level: string; n: bigint }[]>`SELECT date_trunc('hour', created_at) AS h, level::text AS level, count(*) AS n FROM platform.system_logs WHERE created_at >= ${since} GROUP BY 1, 2 ORDER BY 1`;
    const routes = await db.$queryRaw<{ route: string; method: string; n: bigint; avg: number | null }[]>`SELECT route, method, count(*) AS n, round(avg(duration_ms))::float AS avg FROM platform.system_logs WHERE created_at >= ${since} AND level = 'ERROR' AND route IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`;
    const slowest = await db.$queryRaw<{ route: string; method: string; n: bigint; avg: number | null }[]>`SELECT route, method, count(*) AS n, round(avg(duration_ms))::float AS avg FROM platform.system_logs WHERE created_at >= ${since} AND message LIKE 'Slow request%' GROUP BY 1, 2 ORDER BY avg DESC NULLS LAST LIMIT 8`;
    const byTenant = await db.$queryRaw<{ tenant_id: string; n: bigint }[]>`SELECT tenant_id, count(*) AS n FROM platform.system_logs WHERE created_at >= ${since} AND level IN ('ERROR', 'SECURITY') AND tenant_id IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`;
    const totals = await db.systemLog.groupBy({ by: ["level"], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const tn = new Map((await db.tenant.findMany({ where: { id: { in: byTenant.map((b) => b.tenant_id) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    return {
      hours, totals: Object.fromEntries(totals.map((t) => [t.level, t._count._all])),
      series: series.map((s) => ({ hour: s.h, level: s.level, n: Number(s.n) })),
      failingRoutes: routes.map((r) => ({ route: r.route, method: r.method, n: Number(r.n), avgMs: r.avg })), slowRoutes: slowest.map((r) => ({ route: r.route, method: r.method, n: Number(r.n), avgMs: r.avg })),
      noisyHospitals: byTenant.map((b) => ({ tenantId: b.tenant_id, name: tn.get(b.tenant_id) ?? null, n: Number(b.n) })),
    };
  });

  app.delete("/platform/logs", async (req) => {
    const removed = await purgeLogs(db);
    await operatorAudit(db, req, "logs.purge", { meta: { removed } });
    return { removed };
  });

  app.get("/platform/audit", async (req) => {
    const q = z.object({ action: z.string().trim().max(60).optional(), tenantId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(60), before: z.string().datetime().optional() }).parse(req.query);
    const rows = await db.platformAudit.findMany({ where: { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.tenantId ? { targetTenantId: q.tenantId } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit + 1 });
    const who = await names(rows.map((r) => r.operatorId));
    const t = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.targetTenantId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const page = rows.slice(0, q.limit);
    return { rows: page.map((r) => ({ ...r, operatorName: who.get(r.operatorId) ?? null, tenantName: r.targetTenantId ? t.get(r.targetTenantId) ?? null : null })), next: rows.length > q.limit ? page[page.length - 1]!.createdAt : null };
  });

  // ── platform-wide switches ──
  app.get("/platform/flags", async () => db.platformFlag.findMany({ orderBy: { key: "asc" } }));
  app.put("/platform/flags/:key", async (req) => {
    const { key } = z.object({ key: z.enum(["maintenance_mode", "signup_open", "log_retention_days", "trial_days"]) }).parse(req.params);
    const input = z.object({ enabled: z.boolean(), value: z.record(z.string(), z.unknown()).nullable().optional() }).parse(req.body);
    if (key === "log_retention_days" && !(Number(input.value?.["days"]) >= 1 && Number(input.value?.["days"]) <= 365)) throw httpError(400, "Keep logs for 1 to 365 days");
    if (key === "trial_days" && !(Number(input.value?.["days"]) >= 1 && Number(input.value?.["days"]) <= 180)) throw httpError(400, "A trial is 1 to 180 days");
    const before = (await db.platformFlag.findUnique({ where: { key } })) ?? null;
    const f = await db.platformFlag.update({ where: { key }, data: { enabled: input.enabled, ...(input.value !== undefined ? { value: input.value as never } : {}), updatedBy: platformUser(req).sub } });
    clearFlagCache();
    await operatorAudit(db, req, `flag.${key}`, { type: "flag", id: key, meta: { from: before ? { enabled: before.enabled, value: before.value } : null, to: { enabled: f.enabled, value: f.value } } });
    return f;
  });

  // ── banners for hospitals ──
  app.get("/platform/announcements", async () => db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
  app.post("/platform/announcements", async (req, reply) => {
    const input = z.object({ title: z.string().trim().min(3).max(100), body: z.string().trim().min(3).max(600), severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("INFO"), allTenants: z.boolean().default(true), tenantIds: z.array(z.string().uuid()).max(500).default([]), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().nullable().optional() }).parse(req.body);
    if (!input.allTenants && input.tenantIds.length === 0) throw httpError(400, "Choose who should see it");
    const a = await db.announcement.create({ data: { ...input, createdBy: platformUser(req).sub } });
    await operatorAudit(db, req, "announcement.create", { type: "announcement", id: a.id, meta: { title: a.title, severity: a.severity, all: a.allTenants, hospitals: a.tenantIds.length } });
    return reply.code(201).send(a);
  });
  app.delete("/platform/announcements/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.announcement.delete({ where: { id } });
    await operatorAudit(db, req, "announcement.delete", { type: "announcement", id });
    return { removed: true };
  });

  // ── is the platform healthy right now ──
  app.get("/platform/health", async () => {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - t0;
    const tenants = await db.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } });
    let queued = 0, failed = 0, oldest: Date | null = null;
    for (const t of tenants) {
      const s = await withTenant(db, t.id, async (tx) => ({ q: await tx.message.count({ where: { status: "QUEUED" } }), f: await tx.message.count({ where: { status: "FAILED", createdAt: { gt: new Date(Date.now() - 86_400_000) } } }), o: await tx.message.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }) }));
      queued += s.q; failed += s.f; if (s.o && (!oldest || s.o.createdAt < oldest)) oldest = s.o.createdAt;
    }
    await flushLogs();
    const hourAgo = new Date(Date.now() - 3_600_000), dayAgo = new Date(Date.now() - 86_400_000);
    const [e1, e24, sec24] = await Promise.all([db.systemLog.count({ where: { level: "ERROR", createdAt: { gt: hourAgo } } }), db.systemLog.count({ where: { level: "ERROR", createdAt: { gt: dayAgo } } }), db.systemLog.count({ where: { level: "SECURITY", createdAt: { gt: dayAgo } } })]);
    const byStatus = await db.tenant.groupBy({ by: ["status"], _count: { _all: true } });
    const flags = await platformFlags(db);
    return {
      ok: dbMs < 1500 && e1 < 20, checkedAt: new Date(),
      database: { ok: true, latencyMs: dbMs }, messages: { queued, failedLast24h: failed, oldestQueuedSeconds: oldest ? Math.round((Date.now() - oldest.getTime()) / 1000) : 0 },
      errors: { lastHour: e1, last24h: e24 }, securityEvents24h: sec24, hospitals: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      maintenance: flags.get("maintenance_mode")?.enabled ?? false, uptimeSeconds: Math.round(process.uptime()),
    };
  });
}

/** Staff side: the banners that apply to the signed-in hospital right now. */
export async function announcementRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/announcements/active", { preHandler: staffGuard("patients:read") }, async (req) => {
    const now = new Date(), tid = staff(req).tid;
    const rows = await db.announcement.findMany({ where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], AND: [{ OR: [{ allTenants: true }, { tenantIds: { has: tid } }] }] }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, body: true, severity: true, endsAt: true } });
    const maint = (await platformFlags(db)).get("maintenance_mode");
    return { announcements: rows, maintenance: maint?.enabled ? String(maint.value?.["message"] ?? "Scheduled maintenance") : null };
  });
}
