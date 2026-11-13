import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyPassword } from "@hms/auth";
import type { PrismaClient } from "@hms/db";
import { withTenant } from "@hms/db";
import { hashRecovery, newRecoveryCodes, newSecret, otpauthUrl, seal, verifySecondFactor } from "../mfa";
import { clearSecurityCache, securityState } from "../security";
import { staff, staffGuard } from "../guards";
import { revokeAllFor } from "../session";
import { logEvent } from "../syslog";
import { httpError } from "../util";

/** A signed-in staff member of any role. Deliberately not tied to a permission, so someone who is told to set up two-step sign-in always can. */
const signedIn = async (req: FastifyRequest, reply: FastifyReply) => {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
  if (req.user.kind !== "staff") return reply.code(403).send({ error: "Forbidden" });
};

export default async function mfaRoutes(app: FastifyInstance, { db, secret }: { db: PrismaClient; secret: string }) {
  app.get("/auth/mfa/status", { preHandler: signedIn }, async (req) => ({ ...(await securityState(staff(req).tid, staff(req).sub)), recoveryCodesLeft: (await db.identityMfa.findUnique({ where: { identityId: staff(req).sub } }))?.recoveryHashes.length ?? 0 }));

  // Step 1: make a secret for the authenticator app. Nothing changes about sign-in until it is confirmed.
  app.post("/auth/mfa/setup", { preHandler: signedIn, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const id = staff(req).sub;
    const existing = await db.identityMfa.findUnique({ where: { identityId: id } });
    if (existing?.enabledAt) throw httpError(409, "Two-step sign-in is already on. Turn it off first to set it up again");
    const identity = await db.identity.findUniqueOrThrow({ where: { id }, select: { phone: true } });
    const s = newSecret();
    await db.identityMfa.upsert({ where: { identityId: id }, create: { identityId: id, secretEnc: seal(secret, s) }, update: { secretEnc: seal(secret, s), lastStep: null, recoveryHashes: [] } });
    return { secret: s, otpauthUrl: otpauthUrl(s, `${identity.phone.slice(-4).padStart(10, "•")}`) };
  });

  // Step 2: prove the app works by entering a code. Recovery codes are shown once.
  app.post("/auth/mfa/enable", { preHandler: signedIn, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
    const id = staff(req).sub;
    const row = await db.identityMfa.findUnique({ where: { identityId: id } });
    if (!row) throw httpError(409, "Start the setup first");
    if (row.enabledAt) throw httpError(409, "Two-step sign-in is already on");
    if (!(await verifySecondFactor(db, secret, id, code, true))) throw httpError(400, "That code is not right. Check the time on your phone and try the next one");
    const codes = newRecoveryCodes();
    await db.identityMfa.update({ where: { identityId: id }, data: { enabledAt: new Date(), recoveryHashes: codes.map(hashRecovery) } });
    clearSecurityCache();
    logEvent({ level: "SECURITY", source: "auth", message: "Two-step sign-in turned on", identityId: id, tenantId: staff(req).tid, ip: req.ip });
    return { enabled: true, recoveryCodes: codes };
  });

  app.post("/auth/mfa/disable", { preHandler: signedIn, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const i = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(14) }).parse(req.body);
    const id = staff(req).sub;
    if ((await securityState(staff(req).tid, id)).mfaRequired) throw httpError(409, "Your organization requires two-step sign-in, so it cannot be turned off");
    const identity = await db.identity.findUniqueOrThrow({ where: { id } });
    if (!identity.passwordHash || !(await verifyPassword(i.password, identity.passwordHash))) throw httpError(403, "Your password is not right");
    if (!(await verifySecondFactor(db, secret, id, i.code))) throw httpError(400, "That code is not right");
    await db.identityMfa.delete({ where: { identityId: id } });
    clearSecurityCache();
    logEvent({ level: "SECURITY", source: "auth", message: "Two-step sign-in turned off", identityId: id, tenantId: staff(req).tid, ip: req.ip });
    return { enabled: false };
  });

  // ── the organization's rule, and help for someone who has lost their phone ──
  app.get("/security/policy", { preHandler: staffGuard("security:manage") }, async (req) => {
    const tenantId = staff(req).tid;
    const [pol, members] = await Promise.all([db.tenantSecurity.findUnique({ where: { tenantId } }), db.tenantMembership.findMany({ where: { tenantId }, include: { identity: { select: { id: true, fullName: true, phone: true, mfa: { select: { enabledAt: true } } } } } })]);
    const people = [...new Map(members.map((m) => [m.identityId, m])).values()];
    return { require2fa: !!pol?.require2fa, people: people.map((m) => ({ identityId: m.identityId, name: m.identity.fullName, phone: `••••${m.identity.phone.slice(-4)}`, enrolled: !!m.identity.mfa?.enabledAt })) };
  });
  app.put("/security/policy", { preHandler: staffGuard("security:manage") }, async (req) => {
    const { require2fa } = z.object({ require2fa: z.boolean() }).parse(req.body);
    const tenantId = staff(req).tid;
    const row = await db.tenantSecurity.upsert({ where: { tenantId }, create: { tenantId, require2fa, updatedBy: staff(req).sub }, update: { require2fa, updatedBy: staff(req).sub } });
    clearSecurityCache();
    await withTenant(db, tenantId, (tx) => tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "security.policy", entity: "security", meta: { require2fa } } }));
    return { require2fa: row.require2fa };
  });
  app.post("/security/mfa/:identityId/reset", { preHandler: staffGuard("security:manage") }, async (req) => {
    const { identityId } = z.object({ identityId: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    if (!(await db.tenantMembership.count({ where: { tenantId, identityId } }))) throw httpError(404, "That person is not on your staff");
    await db.identityMfa.deleteMany({ where: { identityId } });
    await revokeAllFor(db, identityId);
    clearSecurityCache();
    await withTenant(db, tenantId, (tx) => tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "security.mfa_reset", entity: "identity", entityId: identityId } }));
    return { reset: true };
  });
}
