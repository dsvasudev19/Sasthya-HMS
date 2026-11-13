import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { hashToken, newRefreshToken, primaryRole, type AccessClaims, type Role } from "@hms/auth";
import type { PrismaClient } from "@hms/db";

export const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;
export const COOKIE = "hms_rt";
/** Platform operators use their own cookie so a hospital session and an operator session on the same host never mix. */
export const PLATFORM_COOKIE = "hms_pt";
export const cookieFor = (kind: "staff" | "platform") => (kind === "platform" ? PLATFORM_COOKIE : COOKIE);

type Client = "web" | "mobile";

/** The browser sends this header on refresh and logout; a cross-site form cannot, which blocks CSRF on cookie requests. */
export const CSRF_HEADER = "x-requested-with";

export async function startSession(
  app: FastifyInstance, db: PrismaClient, reply: FastifyReply,
  s: { identityId: string; kind: "staff" | "platform"; tenantId?: string; roles?: Role[]; claims: AccessClaims; client: Client; familyId?: string },
) {
  const { token, hash } = newRefreshToken();
  await db.refreshToken.create({
    data: { identityId: s.identityId, tenantId: s.tenantId, role: s.roles ? primaryRole(s.roles) : null, kind: s.kind, familyId: s.familyId ?? randomUUID(), tokenHash: hash, expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000) },
  });
  if (s.client === "web") {
    reply.setCookie(cookieFor(s.kind), token, { httpOnly: true, sameSite: "strict", secure: process.env["NODE_ENV"] === "production", path: "/", maxAge: REFRESH_DAYS * 86_400 });
  }
  return { token: app.jwt.sign(s.claims, { expiresIn: ACCESS_TTL }), refreshToken: s.client === "mobile" ? token : undefined };
}

export type Rotated = { identityId: string; tenantId: string | null; kind: string; familyId: string };

/**
 * Uses a refresh token once. A token that was already used means it leaked or was replayed: the whole family is revoked,
 * so both the thief and the real user must sign in again.
 */
export async function rotateRefreshToken(db: PrismaClient, token: string, expectedKind?: string): Promise<Rotated | null> {
  const hash = hashToken(token);
  const row = await db.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  if (expectedKind && row.kind !== expectedKind) return null; // presented at the wrong door: refuse without using it up
  const claimed = await db.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) {
    await db.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }
  return { identityId: row.identityId, tenantId: row.tenantId, kind: row.kind, familyId: row.familyId };
}

export const revokeFamily = (db: PrismaClient, familyId: string) => db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
export const revokeAllFor = (db: PrismaClient, identityId: string) => db.refreshToken.updateMany({ where: { identityId, revokedAt: null }, data: { revokedAt: new Date() } });
