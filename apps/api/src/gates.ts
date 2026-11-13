import type { FastifyReply, FastifyRequest } from "fastify";
import { PLANS, effectivePlan, readOnlyReason, resolveFeatures, type Feature } from "@hms/billing-core";
import { platformFlags } from "./flags";
import type { PrismaClient } from "@hms/db";

export interface Info { overrides: Record<string, boolean>; maxSeats: number | null; maxBranches: number | null; kind: "HOSPITAL" | "CLINIC" | "PHARMACY"; planCode: "PAY_PER_PATIENT" | "STARTER" | "UNLIMITED"; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED"; trialEndsAt: Date | null; suspendedReason: string | null }
const cache = new Map<string, { at: number; v: Info }>();
const TTL = 15_000;

export async function tenantInfo(db: PrismaClient, tenantId: string): Promise<Info> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { kind: true, planCode: true, status: true, trialEndsAt: true, suspendedReason: true } });
  const [ov, lim] = await Promise.all([db.tenantFeatureOverride.findMany({ where: { tenantId }, select: { feature: true, enabled: true } }), db.tenantLimits.findUnique({ where: { tenantId } })]);
  const v: Info = { ...t, overrides: Object.fromEntries(ov.map((o) => [o.feature, o.enabled])), maxSeats: lim?.maxSeats ?? null, maxBranches: lim?.maxBranches ?? null };
  cache.set(tenantId, { at: Date.now(), v });
  return v;
}
/** Everything this hospital can use right now: its plan, the trial, its kind, and the operator's switches. */
export const featuresOf = (t: Info): Feature[] => resolveFeatures(effectivePlan(t), t.overrides, t.kind === "PHARMACY" ? ["pharmacy"] : []);

export const clearTenantCache = (tenantId?: string) => (tenantId ? cache.delete(tenantId) : cache.clear());

async function staffTenant(req: FastifyRequest): Promise<string | null> {
  if (!req.headers.authorization) return null;
  try { await req.jwtVerify(); } catch { return null; }
  return req.user.kind === "staff" ? req.user.tid : null;
}

/** Suspended, closed and trial-expired hospitals can read but not change anything, except to pay or sign in. */
export const readOnlyGate = (db: PrismaClient) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (req.method === "GET" || req.method === "HEAD" || req.url.startsWith("/auth")) return;
  const tid = await staffTenant(req);
  if (!tid) return;
  const maint = (await platformFlags(db)).get("maintenance_mode");
  if (maint?.enabled) return reply.code(503).send({ error: String(maint.value?.["message"] ?? "Scheduled maintenance. Records are read-only for a short while."), code: "MAINTENANCE" });
  if (req.url.startsWith("/subscription")) return;
  const t = await tenantInfo(db, tid);
  const why = readOnlyReason(t, t.suspendedReason);
  if (why) return reply.code(402).send({ error: why, code: "READ_ONLY" });
};

const LABEL: Record<Feature, string> = { cards: "health cards", pharmacy: "the pharmacy module", lab: "the laboratory module", messaging: "SMS and WhatsApp messaging", multi_branch: "multiple branches", api: "API access", documents: "documents and scans", tele: "video consultations", tasks: "tasks", reports: "reports and analytics", scan: "scan to act", imports: "spreadsheet import", ipd: "inpatient care", insurance: "insurance and TPA", ot: "operation theatres", emergency: "emergency", workforce: "staff rosters and payouts", feedback: "patient feedback" };

/** Blocks a module the hospital's plan does not include. A running trial unlocks everything. */
export const featureGate = (db: PrismaClient, feature: Feature) => async (req: FastifyRequest, reply: FastifyReply) => {
  const tid = await staffTenant(req);
  if (!tid) return; // the route's own guard answers 401
  const t = await tenantInfo(db, tid);
  if (!featuresOf(t).includes(feature)) {
    const needs = (["STARTER", "UNLIMITED"] as const).find((p) => PLANS[p].features.includes(feature));
    // Included in the plan but switched off by Swasthya for this hospital: say so, rather than asking for an upgrade.
    if (t.overrides[feature] === false) return reply.code(403).send({ error: `${LABEL[feature][0]!.toUpperCase()}${LABEL[feature].slice(1)} is not enabled for your hospital. Contact Swasthya support.`, code: "DISABLED", feature });
    return reply.code(402).send({ error: `Your plan does not include ${LABEL[feature]}. Upgrade to ${PLANS[needs ?? "UNLIMITED"].label}.`, code: "UPGRADE", feature });
  }
};
