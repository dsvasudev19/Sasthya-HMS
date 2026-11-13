import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateOtp, hashOtp, hashPassword, passwordProblem, primaryRole, safeEqualHex, verifyPassword, type Role } from "@hms/auth";
import { loginInput, otpRequestInput, otpVerifyInput, signupInput } from "@hms/contracts";
import { TRIAL_DAYS } from "@hms/billing-core";
import { featuresOf, tenantInfo } from "../gates";
import { platformFlags } from "../flags";
import { logEvent } from "../syslog";
import { provisionTenant } from "../provision";
import { ensureDefaultCardPlans, ensureDefaultFeeItems, ensureDefaultLabTests } from "@hms/db/defaults";
import { withTenant, type PrismaClient } from "@hms/db";
import { ensureMainBranch, ensureSystemRoles } from "@hms/db/access";
import { branchesFor, permissionsFor } from "../authz";
import { render, toE164India, type MessageProvider } from "@hms/notifications";
import { revokeAllFor, revokeFamily, rotateRefreshToken, startSession, COOKIE, CSRF_HEADER, PLATFORM_COOKIE } from "../session";
import { enrolled, securityState } from "../security";
import { lockedFor, verifySecondFactor } from "../mfa";
import { httpError } from "../util";

const clientOf = (b: unknown): "web" | "mobile" => ((b as { client?: string } | undefined)?.client === "mobile" ? "mobile" : "web");

export const tenantView = (features: string[], t: { id: string; kind?: "HOSPITAL" | "CLINIC" | "PHARMACY"; name: string; planCode: "PAY_PER_PATIENT" | "STARTER" | "UNLIMITED"; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED"; trialEndsAt: Date | null; suspendedReason: string | null }) => ({
  id: t.id, name: t.name, kind: t.kind ?? "HOSPITAL", plan: t.planCode, status: t.status, trialEndsAt: t.trialEndsAt, suspendedReason: t.suspendedReason, features,
});

export default async function authRoutes(app: FastifyInstance, { db, secret, provider }: { db: PrismaClient; secret: string; provider: MessageProvider }) {
  const staffSession = async (reply: FastifyReply, identityId: string, tenantId: string, client: "web" | "mobile", familyId?: string) => {
    const identity = await db.identity.findUniqueOrThrow({ where: { id: identityId } });
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const roles = (await db.tenantMembership.findMany({ where: { identityId, tenantId } })).map((m) => m.role as Role);
    if (roles.length === 0 || tenant.status === "CLOSED") throw httpError(403, "No active hospital for this account");
    const role = primaryRole(roles);
    const s = await startSession(app, db, reply, { identityId, kind: "staff", tenantId, roles, client, familyId, claims: { kind: "staff", sub: identityId, tid: tenantId, role, roles } });
    const claims = { kind: "staff" as const, sub: identityId, tid: tenantId, role, roles };
    return {
      ...s,
      user: { id: identity.id, name: identity.fullName, role, roles },
      tenant: tenantView(featuresOf(await tenantInfo(db, tenantId)), tenant),
      permissions: await permissionsFor(tenantId, roles, identityId),
      branches: await branchesFor(claims),
      mustChangePassword: identity.mustChangePassword,
      security: await securityState(tenantId, identityId),
    };
  };

  // ── hospital staff: phone + password ──
  app.post("/auth/login", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = loginInput.parse(req.body);
    const identity = await db.identity.findUnique({ where: { phone: input.phone }, include: { memberships: { include: { tenant: true } } } });
    // Same response for unknown phone and wrong password.
    const ok = identity?.passwordHash ? await verifyPassword(input.password, identity.passwordHash) : false;
    if (!identity || !ok) { logEvent({ level: "SECURITY", source: "auth", message: "Failed staff sign-in", ip: req.ip, meta: { phoneEnding: input.phone.slice(-4), known: !!identity } }); return reply.code(401).send({ error: "Invalid phone or password" }); }

    const byTenant = new Map<string, { tenantId: string; name: string; roles: Role[] }>();
    for (const m of identity.memberships.filter((x) => x.tenant.status !== "CLOSED")) {
      const e = byTenant.get(m.tenantId) ?? { tenantId: m.tenantId, name: m.tenant.name, roles: [] };
      e.roles.push(m.role as Role);
      byTenant.set(m.tenantId, e);
    }
    const choices = [...byTenant.values()].filter((c) => !input.tenantId || c.tenantId === input.tenantId);
    if (choices.length === 0) return reply.code(403).send({ error: "No active hospital for this account" });
    if (choices.length > 1) return reply.code(300).send({ choose: choices });
    // A person with two-step sign-in set up gets a short-lived ticket, and the session only starts once the second step passes.
    if (await enrolled(identity.id)) {
      const challenge = app.jwt.sign({ kind: "mfa", sub: identity.id, tid: choices[0]!.tenantId, client: clientOf(req.body) } as never, { expiresIn: "5m" });
      return reply.code(202).send({ mfaRequired: true, challenge });
    }
    return staffSession(reply, identity.id, choices[0]!.tenantId, clientOf(req.body));
  });

  app.post("/auth/login/mfa", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { challenge, code } = z.object({ challenge: z.string().min(20).max(2000), code: z.string().trim().min(6).max(14) }).parse(req.body);
    let t: { kind?: string; sub?: string; tid?: string; client?: "web" | "mobile" };
    try { t = app.jwt.verify(challenge); } catch { return reply.code(401).send({ error: "That sign-in has expired. Start again." }); }
    if (t.kind !== "mfa" || !t.sub || !t.tid) return reply.code(401).send({ error: "That sign-in has expired. Start again." });
    if (lockedFor(t.sub)) return reply.code(429).send({ error: `Too many wrong codes. Try again in ${lockedFor(t.sub)} minutes.` });
    if (!(await verifySecondFactor(db, secret, t.sub, code))) { logEvent({ level: "SECURITY", source: "auth", message: "Failed second step", identityId: t.sub, tenantId: t.tid, ip: req.ip }); return reply.code(401).send({ error: "That code is not right" }); }
    return staffSession(reply, t.sub, t.tid, t.client ?? "web");
  });

  const refreshToken = (req: FastifyRequest, cookieName: string): string | null => {
    const body = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    if (body) return body;
    const cookie = req.cookies[cookieName];
    return cookie && req.headers[CSRF_HEADER] ? cookie : null;
  };

  const refresh = (kind: "staff" | "platform") => async (req: FastifyRequest, reply: FastifyReply) => {
    const cookieName = kind === "platform" ? PLATFORM_COOKIE : COOKIE;
    const token = refreshToken(req, cookieName);
    if (!token) return reply.code(401).send({ error: "Not signed in" });
    const r = await rotateRefreshToken(db, token, kind);
    if (!r) { reply.clearCookie(cookieName, { path: "/" }); return reply.code(401).send({ error: "Session expired" }); }
    const client = (req.body as { refreshToken?: string } | undefined)?.refreshToken ? "mobile" : "web";
    try {
      return kind === "platform" ? await platformSession(reply, r.identityId, client, r.familyId) : await staffSession(reply, r.identityId, r.tenantId!, client, r.familyId);
    } catch {
      await revokeFamily(db, r.familyId);
      return reply.code(401).send({ error: "Session expired" });
    }
  };
  const logout = (cookieName: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    const token = refreshToken(req, cookieName);
    if (token) {
      const row = await db.refreshToken.findFirst({ where: { tokenHash: (await import("@hms/auth")).hashToken(token) } });
      if (row) await revokeFamily(db, row.familyId);
    }
    reply.clearCookie(cookieName, { path: "/" });
    return { ok: true };
  };
  app.post("/auth/refresh", refresh("staff"));
  app.post("/auth/logout", logout(COOKIE));
  app.post("/auth/platform/refresh", refresh("platform"));
  app.post("/auth/platform/logout", logout(PLATFORM_COOKIE));

  // Changing the password signs out every other session and starts a fresh one.
  app.post("/auth/change-password", async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    if (req.user.kind === "patient") return reply.code(403).send({ error: "Forbidden" });
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().max(128) }).parse(req.body);
    const problem = passwordProblem(newPassword);
    if (problem) throw httpError(400, problem);
    const identity = await db.identity.findUniqueOrThrow({ where: { id: req.user.sub } });
    if (!identity.passwordHash || !(await verifyPassword(currentPassword, identity.passwordHash))) throw httpError(401, "Current password is wrong");
    if (currentPassword === newPassword) throw httpError(400, "Choose a different password");
    await db.identity.update({ where: { id: identity.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    await revokeAllFor(db, identity.id);
    const client = clientOf(req.body);
    return req.user.kind === "platform" ? platformSession(reply, identity.id, client) : staffSession(reply, identity.id, req.user.tid, client);
  });

  // ── our own platform operators ──
  const platformSession = async (reply: FastifyReply, identityId: string, client: "web" | "mobile", familyId?: string) => {
    const admin = await db.platformAdmin.findUnique({ where: { identityId }, include: { identity: true } });
    if (!admin) throw httpError(403, "Not a platform operator");
    const s = await startSession(app, db, reply, { identityId, kind: "platform", client, familyId, claims: { kind: "platform", sub: identityId } });
    return { ...s, user: { id: identityId, name: admin.identity.fullName, role: "PLATFORM" }, mustChangePassword: admin.identity.mustChangePassword };
  };

  app.post("/auth/platform/login", async (req, reply) => {
    const { phone, password } = z.object({ phone: z.string().regex(/^\d{10}$/), password: z.string().min(1).max(128) }).parse(req.body);
    const identity = await db.identity.findUnique({ where: { phone }, include: { platformAdmins: true } });
    const ok = identity?.passwordHash ? await verifyPassword(password, identity.passwordHash) : false;
    if (!identity || !ok || identity.platformAdmins.length === 0) return reply.code(401).send({ error: "Invalid phone or password" });
    return platformSession(reply, identity.id, clientOf(req.body));
  });

  // ── hospital self-signup: 30-day free trial with every feature ──
  app.post("/signup", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const input = signupInput.parse(req.body);
    if (!(await platformFlags(db)).get("signup_open")?.enabled) throw httpError(403, "New sign-ups are paused for now. Please contact Swasthya.");
    if (!(await consumeOtp(input.phone, input.code))) return reply.code(401).send({ error: "Wrong or expired code" });
    let identity = await db.identity.findUnique({ where: { phone: input.phone } });
    if (identity?.passwordHash) {
      // Someone who already runs a hospital here can open another one with their existing password.
      if (!(await verifyPassword(input.password, identity.passwordHash))) throw httpError(409, "This number already has an account. Use your existing password, or sign in.");
    } else {
      const hash = await hashPassword(input.password);
      identity = identity
        ? await db.identity.update({ where: { id: identity.id }, data: { passwordHash: hash, fullName: identity.fullName ?? input.ownerName } })
        : await db.identity.create({ data: { phone: input.phone, fullName: input.ownerName, passwordHash: hash } });
    }
    const trialDays = Number((await platformFlags(db)).get("trial_days")?.value?.["days"] ?? TRIAL_DAYS);
    const tenant = await provisionTenant(db, { name: input.hospitalName, kind: input.kind, planCode: input.planCode, status: "TRIAL", trialDays, ownerIdentityId: identity.id });
    return reply.code(201).send(await staffSession(reply, identity.id, tenant.id, input.client ?? "web"));
  });

  // ── patients: phone OTP ──
  app.post("/patient/otp/request", { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { phone } = otpRequestInput.parse(req.body);
    const recent = await db.otpChallenge.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 3) return reply.code(429).send({ error: "Too many codes requested. Try again in a few minutes." });
    const code = generateOtp();
    const challenge = await db.otpChallenge.create({ data: { phone, codeHash: hashOtp(phone, code, secret), expiresAt: new Date(Date.now() + 5 * 60_000) } });
    try {
      await provider.send({ to: toE164India(phone), body: render("OTP", "en", { code }), channel: "SMS", template: "OTP", reference: challenge.id });
    } catch (e) {
      req.log.error({ err: e }, "OTP delivery failed");
      await db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }); // the code can never be used
      return reply.code(502).send({ error: "We could not send the code. Please try again." });
    }
    return { sent: true, ...(process.env["NODE_ENV"] === "production" ? {} : { devCode: code }) };
  });

  /** Checks and consumes a one-time code. Returns false for a wrong, expired or used code. */
  const consumeOtp = async (phone: string, code: string): Promise<boolean> => {
    const ch = await db.otpChallenge.findFirst({ where: { phone, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!ch || ch.attempts >= 5) return false;
    await db.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    if (!safeEqualHex(ch.codeHash, hashOtp(phone, code, secret))) return false;
    await db.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    return true;
  };
  app.decorate("consumeOtp", consumeOtp);

  app.post("/patient/otp/verify", async (req, reply) => {
    const { phone, code } = otpVerifyInput.parse(req.body);
    if (!(await consumeOtp(phone, code))) return reply.code(401).send({ error: "Wrong or expired code" });
    const identity = await db.identity.upsert({ where: { phone }, update: {}, create: { phone } });
    const token = app.jwt.sign({ kind: "patient", sub: identity.id }, { expiresIn: "30d" });
    return { token, identity: { id: identity.id, phone: identity.phone, name: identity.fullName } };
  });
}

declare module "fastify" {
  interface FastifyInstance {
    consumeOtp(phone: string, code: string): Promise<boolean>;
  }
}
