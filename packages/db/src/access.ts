import { DEFAULT_ROLES } from "@hms/auth";
import type { PrismaClient, TenantTx } from "./index";

type Db = PrismaClient | TenantTx;

/**
 * Makes sure a hospital has the built-in roles. New roles get the product defaults; a built-in role nobody has edited follows
 * the defaults as the product grows; an edited one is left alone.
 */
export async function ensureSystemRoles(db: Db, tenantId: string): Promise<void> {
  const existing = await db.tenantRole.findMany({ where: { tenantId, isSystem: true } });
  for (const def of DEFAULT_ROLES) {
    const row = existing.find((r) => r.key === def.key);
    if (!row) {
      await db.tenantRole.create({ data: { tenantId, key: def.key, name: def.name, description: def.description, isSystem: true, permissions: def.permissions } });
    } else if (!row.customized && (row.permissions.length !== def.permissions.length || row.permissions.some((p, i) => p !== def.permissions[i]))) {
      await db.tenantRole.update({ where: { id: row.id }, data: { permissions: def.permissions, description: def.description } });
    }
  }
}

/** Run at API start-up: brings every hospital's built-in roles up to date. */
export async function syncSystemRoles(db: PrismaClient): Promise<void> {
  const tenants = await db.tenant.findMany({ select: { id: true } });
  for (const t of tenants) await ensureSystemRoles(db, t.id);
}

/** A hospital always has one main branch. Call inside the tenant transaction. */
export async function ensureMainBranch(tx: TenantTx, tenantId: string, name: string): Promise<{ id: string }> {
  const main = await tx.branch.findFirst({ where: { isMain: true } });
  if (main) return main;
  return tx.branch.create({ data: { tenantId, code: "MAIN", name, isMain: true } });
}
