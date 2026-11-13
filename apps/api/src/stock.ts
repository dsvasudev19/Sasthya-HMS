import type { TenantTx } from "@hms/db";
import { httpError } from "./util";

export const startOfToday = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Sellable stock (not expired) per medicine across the given branches. */
export async function stockTotals(tx: TenantTx, branchIds: string[], medicineIds?: string[]) {
  const rows = await tx.stockBatch.groupBy({
    by: ["medicineId"],
    where: { branchId: { in: branchIds }, qtyOnHand: { gt: 0 }, expiryDate: { gt: startOfToday() }, ...(medicineIds ? { medicineId: { in: medicineIds } } : {}) },
    _sum: { qtyOnHand: true },
    _min: { expiryDate: true },
  });
  return new Map(rows.map((r) => [r.medicineId, { onHand: r._sum.qtyOnHand ?? 0, nextExpiry: r._min.expiryDate }]));
}

export interface Pick { medicineId: string; batchId: string; qty: number; unitPaise: number; costPaise: number | null }

/**
 * Takes `qty` of a medicine from the branch's batches, earliest expiry first, never expired stock. Rows are locked, so two counters
 * selling the last units at once take turns. Throws 409 with the shortfall when there is not enough.
 */
export async function allocateFefo(tx: TenantTx, o: { branchId: string; medicine: { id: string; name: string; strength: string | null; pricePaise: number }; qty: number }): Promise<Pick[]> {
  let need = o.qty;
  const picks: Pick[] = [];
  const batches = await tx.$queryRaw<{ id: string; qty_on_hand: number; cost_paise: number | null }[]>`
    SELECT id, qty_on_hand, cost_paise FROM hms.stock_batches
    WHERE branch_id = ${o.branchId}::uuid AND medicine_id = ${o.medicine.id}::uuid AND qty_on_hand > 0 AND expiry_date > CURRENT_DATE
    ORDER BY expiry_date, received_at FOR UPDATE`;
  for (const b of batches) {
    if (need === 0) break;
    const take = Math.min(need, b.qty_on_hand);
    await tx.$executeRaw`UPDATE hms.stock_batches SET qty_on_hand = qty_on_hand - ${take} WHERE id = ${b.id}::uuid`;
    picks.push({ medicineId: o.medicine.id, batchId: b.id, qty: take, unitPaise: o.medicine.pricePaise, costPaise: b.cost_paise });
    need -= take;
  }
  if (need > 0) throw httpError(409, `Not enough stock for ${o.medicine.name}${o.medicine.strength ? ` ${o.medicine.strength}` : ""}`, { medicineId: o.medicine.id, short: need });
  return picks;
}

/** Adds stock to a batch (creating it if new) and writes the ledger row. */
export async function receiveBatch(
  tx: TenantTx,
  o: { tenantId: string; branchId: string; medicineId: string; batchNo: string; expiryDate: Date; qty: number; costPaise?: number | null; by?: string; type?: "RECEIPT" | "TRANSFER_IN"; refType?: string; refId?: string; note?: string },
) {
  const existing = await tx.stockBatch.findUnique({ where: { tenantId_branchId_medicineId_batchNo: { tenantId: o.tenantId, branchId: o.branchId, medicineId: o.medicineId, batchNo: o.batchNo } } });
  if (existing && existing.expiryDate.getTime() !== o.expiryDate.getTime()) throw httpError(409, `Batch ${o.batchNo} already exists with a different expiry date`);
  const b = existing
    ? await tx.stockBatch.update({ where: { id: existing.id }, data: { qtyReceived: { increment: o.qty }, qtyOnHand: { increment: o.qty }, costPaise: o.costPaise ?? existing.costPaise } })
    : await tx.stockBatch.create({ data: { tenantId: o.tenantId, branchId: o.branchId, medicineId: o.medicineId, batchNo: o.batchNo, expiryDate: o.expiryDate, qtyReceived: o.qty, qtyOnHand: o.qty, costPaise: o.costPaise ?? undefined } });
  await tx.stockMovement.create({
    data: { tenantId: o.tenantId, branchId: o.branchId, medicineId: o.medicineId, batchId: b.id, type: o.type ?? "RECEIPT", qty: o.qty, refType: o.refType, refId: o.refId, note: o.note, createdBy: o.by },
  });
  return b;
}

/** Puts returned units back on the batch they came from (never above what was received). */
export async function restock(tx: TenantTx, o: { tenantId: string; branchId: string; batchId: string; medicineId: string; qty: number; by?: string; refId: string }) {
  const rows = await tx.$executeRaw`UPDATE hms.stock_batches SET qty_on_hand = qty_on_hand + ${o.qty} WHERE id = ${o.batchId}::uuid AND qty_on_hand + ${o.qty} <= qty_received`;
  if (rows === 0) throw httpError(409, "Returned quantity does not fit the batch it came from");
  await tx.stockMovement.create({ data: { tenantId: o.tenantId, branchId: o.branchId, medicineId: o.medicineId, batchId: o.batchId, type: "RETURN", qty: o.qty, refType: "sale_return", refId: o.refId, createdBy: o.by } });
}
