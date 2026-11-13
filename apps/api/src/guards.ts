import type { FastifyReply, FastifyRequest } from "fastify";
import { can, deniedBy, type PatientClaims, type Permission, type PlatformClaims, type StaffClaims } from "@hms/auth";
import { buildAccess, istParts } from "./authz";
import { mfaBlocked } from "./security";

/**
 * Staff routes: verifies the token, resolves what the caller's roles currently allow (so role edits take effect within seconds),
 * checks the permission, then lets the hospital's policies veto it. The hospital and branch always come from the token and
 * the signed-in user's allowed branches, never from the request body.
 */
export const staffGuard = (permission: Permission) => async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  if (req.user.kind !== "staff") return reply.code(403).send({ error: "Forbidden" });
  // An organization can insist on two-step sign-in. Until someone has set it up, the only thing they can do is read who they are and set it up.
  if (req.routeOptions.url !== "/me" && (await mfaBlocked(req.user.tid, req.user.sub))) return reply.code(403).send({ error: "Your organization requires two-step sign-in. Set it up to continue.", code: "MFA_SETUP_REQUIRED" });
  const header = req.headers["x-branch-id"];
  const access = await buildAccess(req.user, typeof header === "string" ? header : undefined);
  req.access = access;
  if (!can(access.permissions, permission)) return reply.code(403).send({ error: "Forbidden" });
  const denied = deniedBy(access.policies, { permission, roles: access.roles, attrs: { ...istParts(), branchCode: access.branchCode, userId: req.user.sub } });
  if (denied) return reply.code(403).send({ error: denied.message, code: "POLICY", policy: denied.name });
};

/** Patient app routes. */
export const patientGuard = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  if (req.user.kind !== "patient") return reply.code(403).send({ error: "Forbidden" });
};

/** Platform operators (our own staff). */
export const platformGuard = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  if (req.user.kind !== "platform") return reply.code(403).send({ error: "Forbidden" });
};

export const staff = (req: FastifyRequest) => req.user as StaffClaims;
export const platformUser = (req: FastifyRequest) => req.user as PlatformClaims;
export const patient = (req: FastifyRequest) => req.user as PatientClaims;

const DAY = 24 * 3600_000;
/** Day boundaries use the Indian time zone, the default for every tenant. */
export const startOfDay = (date: string) => new Date(`${date}T00:00:00+05:30`);
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const dayRange = (date: string) => {
  const from = startOfDay(date);
  return { from, to: new Date(from.getTime() + DAY) };
};
