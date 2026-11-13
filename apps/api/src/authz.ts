import type { FastifyRequest } from "fastify";
import { can, deniedBy, effectivePermissions, type AccessOverride, type Condition, type Policy, type StaffClaims } from "@hms/auth";
import { withTenant, type PrismaClient } from "@hms/db";
import { httpError } from "./util";

export interface BranchInfo { id: string; code: string; name: string; isMain: boolean }

interface TenantAccess {
  at: number;
  roles: Map<string, string[]>;
  policies: Policy[];
  overrides: Map<string, AccessOverride[]>;
  branches: BranchInfo[];
}

/** What the caller may do in this request, resolved from the hospital's current roles, policies and branches. */
export interface Access {
  roles: string[];
  permissions: Set<string>;
  policies: Policy[];
  /** Branches this request reads from. One branch normally; every allowed branch when the caller chose "all". */
  branchIds: string[];
  /** The branch new records are written to. */
  branchId: string;
  branchCode: string;
  /** Every branch the caller may switch to. */
  allowed: BranchInfo[];
  viewingAll: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    access?: Access;
  }
}

let db: PrismaClient;
export const configureAuthz = (client: PrismaClient) => { db = client; };

const TTL = 15_000;
const tenantCache = new Map<string, TenantAccess>();
const staffBranchCache = new Map<string, { at: number; ids: string[] }>();

export function clearAuthzCache(tenantId?: string) {
  if (!tenantId) { tenantCache.clear(); staffBranchCache.clear(); return; }
  tenantCache.delete(tenantId);
  for (const k of [...staffBranchCache.keys()]) if (k.startsWith(`${tenantId}:`)) staffBranchCache.delete(k);
}

type PolicyRow = { id: string; name: string; enabled: boolean; permission: string; appliesToRoles: string[]; conditions: unknown; message: string; match: string; exceptRoles: string[]; validFrom: Date | null; validUntil: Date | null };
export const toPolicy = (p: PolicyRow): Policy => ({ id: p.id, name: p.name, enabled: p.enabled, permission: p.permission, appliesToRoles: p.appliesToRoles, conditions: p.conditions as Condition[], message: p.message, match: p.match === "ANY" ? "ANY" : "ALL", exceptRoles: p.exceptRoles, validFrom: p.validFrom, validUntil: p.validUntil });

/** A person's permissions: their roles' plus any unexpired personal grants, minus personal revokes. */
const resolve = (t: TenantAccess, roles: string[], identityId: string): Set<string> =>
  effectivePermissions(roles.flatMap((r) => t.roles.get(r) ?? []), t.overrides.get(identityId) ?? []);

async function loadTenant(tenantId: string): Promise<TenantAccess> {
  const hit = tenantCache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const [roles, policies, overrides, branches] = await Promise.all([
    db.tenantRole.findMany({ where: { tenantId } }),
    db.tenantPolicy.findMany({ where: { tenantId, enabled: true } }),
    db.userAccessOverride.findMany({ where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    withTenant(db, tenantId, (tx) => tx.branch.findMany({ where: { active: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] })),
  ]);
  const v: TenantAccess = {
    at: Date.now(),
    roles: new Map(roles.map((r) => [r.key, r.permissions])),
    policies: policies.map(toPolicy),
    overrides: overrides.reduce((m, o) => m.set(o.identityId, [...(m.get(o.identityId) ?? []), { permission: o.permission, effect: o.effect, expiresAt: o.expiresAt }]), new Map<string, AccessOverride[]>()),
    branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name, isMain: b.isMain })),
  };
  tenantCache.set(tenantId, v);
  return v;
}

async function staffBranches(tenantId: string, identityId: string): Promise<string[]> {
  const key = `${tenantId}:${identityId}`;
  const hit = staffBranchCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.ids;
  const ids = (await db.staffBranch.findMany({ where: { tenantId, identityId } })).map((r) => r.branchId);
  staffBranchCache.set(key, { at: Date.now(), ids });
  return ids;
}

export const istParts = (d = new Date()) => {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return { hour: ist.getUTCHours(), weekday: ist.getUTCDay(), date: ist.toISOString().slice(0, 10) };
};

export async function buildAccess(claims: StaffClaims, branchHeader: string | undefined): Promise<Access> {
  const t = await loadTenant(claims.tid);
  const perms = resolve(t, claims.roles, claims.sub);
  const everywhere = can(perms, "branches:all");
  const main = t.branches.find((b) => b.isMain) ?? t.branches[0];
  if (!main) throw httpError(409, "This hospital has no active branch");
  let allowed = t.branches;
  if (!everywhere) {
    const mine = await staffBranches(claims.tid, claims.sub);
    const own = t.branches.filter((b) => mine.includes(b.id));
    allowed = own.length > 0 ? own : [main];
  }
  const viewingAll = branchHeader === "all" && allowed.length > 1;
  const chosen = allowed.find((b) => b.id === branchHeader) ?? allowed.find((b) => b.isMain) ?? allowed[0]!;
  return {
    roles: claims.roles, permissions: perms, policies: t.policies,
    branchIds: viewingAll ? allowed.map((b) => b.id) : [chosen.id],
    branchId: chosen.id, branchCode: chosen.code, allowed, viewingAll,
  };
}

/** Roles the policies and role definitions currently grant; used by the sign-in response. */
export async function permissionsFor(tenantId: string, roles: string[], identityId: string): Promise<string[]> {
  return [...resolve(await loadTenant(tenantId), roles, identityId)];
}

export async function branchesFor(claims: StaffClaims): Promise<BranchInfo[]> {
  return (await buildAccess(claims, undefined)).allowed;
}

/** Evaluates the hospital's policies for an action, with extra attributes such as the amount. Throws 403 when one denies it. */
export function authorize(req: FastifyRequest, permission: string, attrs: Record<string, unknown> = {}): void {
  const a = req.access;
  if (!a) throw httpError(401, "Unauthorized");
  const denied = deniedBy(a.policies, { permission, roles: a.roles, attrs: { ...istParts(), branchCode: a.branchCode, userId: (req.user as { sub?: string }).sub, ...attrs } });
  if (denied) throw httpError(403, denied.message, { code: "POLICY", policy: denied.name });
}

export const hasPermission = (req: FastifyRequest, permission: string) => !!req.access && can(req.access.permissions, permission);

/** Query filter for branch-scoped tables. */
export const inScope = (req: FastifyRequest) => ({ branchId: { in: req.access!.branchIds } });
