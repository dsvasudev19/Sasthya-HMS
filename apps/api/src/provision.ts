import { ensureMainBranch, ensureSystemRoles } from "@hms/db/access";
import { ensureDefaultCardPlans, ensureDefaultFeeItems, ensureDefaultLabTests } from "@hms/db/defaults";
import { withTenant, type PrismaClient } from "@hms/db";
import type { Role } from "@hms/auth";

export interface ProvisionInput {
  name: string;
  kind: "HOSPITAL" | "CLINIC" | "PHARMACY";
  planCode: "PAY_PER_PATIENT" | "STARTER" | "UNLIMITED";
  status: "TRIAL" | "ACTIVE";
  trialDays: number;
  ownerIdentityId: string;
  branchName?: string;
}

/** Creates a hospital with everything it needs on day one: roles, a main branch, default fees, tests and card plans. Used by self-signup and by the operator. */
export async function provisionTenant(db: PrismaClient, i: ProvisionInput) {
  const base = i.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "hospital";
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await db.tenant.create({
    data: { slug, name: i.name, kind: i.kind, status: i.status, planCode: i.planCode, trialEndsAt: i.status === "TRIAL" ? new Date(Date.now() + i.trialDays * 86_400_000) : null },
  });
  const roles: Role[] = i.kind === "CLINIC" ? ["OWNER", "DOCTOR"] : ["OWNER"]; // a solo doctor is both
  await ensureSystemRoles(db, tenant.id);
  await db.tenantMembership.createMany({ data: roles.map((role) => ({ tenantId: tenant.id, identityId: i.ownerIdentityId, role })) });
  await withTenant(db, tenant.id, async (tx) => {
    await ensureMainBranch(tx, tenant.id, i.branchName ?? i.name);
    await ensureDefaultCardPlans(tx, tenant.id);
    await ensureDefaultFeeItems(tx, tenant.id);
    await ensureDefaultLabTests(tx, tenant.id);
  });
  return tenant;
}
