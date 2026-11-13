import type { PrismaClient } from "@hms/db";
import { enforceBilling } from "@hms/db/platform-billing";
import { clearTenantCache } from "./gates";

/** Marks a Swasthya invoice paid exactly once, then lifts a suspension that was waiting on it. */
export async function settlePlatformInvoice(db: PrismaClient, id: string, paymentRef: string): Promise<({ outcome: "paid" } & Awaited<ReturnType<typeof enforceBilling>>) | { outcome: "already" }> {
  const inv = await db.platformInvoice.findUnique({ where: { id } });
  if (!inv) return { outcome: "already" };
  const done = await db.platformInvoice.updateMany({ where: { id, status: "DUE" }, data: { status: "PAID", paidAt: new Date(), paymentRef } });
  if (done.count === 0) return { outcome: "already" };
  const r = await enforceBilling(db, new Date(), [inv.tenantId]);
  clearTenantCache();
  return { outcome: "paid", ...r };
}
