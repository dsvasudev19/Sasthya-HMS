import type { PrismaClient } from "@hms/db";

let db: PrismaClient;
export const configureSecurity = (client: PrismaClient) => { db = client; };
const TTL = 15_000;
const tenants = new Map<string, { v: boolean; at: number }>();
const people = new Map<string, { v: boolean; at: number }>();
export const clearSecurityCache = () => { tenants.clear(); people.clear(); };

const requires = async (tenantId: string) => {
  const c = tenants.get(tenantId);
  if (c && Date.now() - c.at < TTL) return c.v;
  const v = !!(await db.tenantSecurity.findUnique({ where: { tenantId } }))?.require2fa;
  tenants.set(tenantId, { v, at: Date.now() });
  return v;
};
export const enrolled = async (identityId: string) => {
  const c = people.get(identityId);
  if (c && Date.now() - c.at < TTL) return c.v;
  const v = !!(await db.identityMfa.findUnique({ where: { identityId } }))?.enabledAt;
  people.set(identityId, { v, at: Date.now() });
  return v;
};
/** True when the organization insists on two-step sign-in and this person has not set it up yet. */
export const mfaBlocked = async (tenantId: string, identityId: string) => (await requires(tenantId)) && !(await enrolled(identityId));
export const securityState = async (tenantId: string, identityId: string) => ({ mfaEnabled: await enrolled(identityId), mfaRequired: await requires(tenantId) });
