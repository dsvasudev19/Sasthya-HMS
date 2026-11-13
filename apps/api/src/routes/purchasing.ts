import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { goodsReceiptInput, purchaseOrderInput, supplierInput, supplierPatch, supplierPaymentInput } from "@hms/contracts";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { authorize, inScope } from "../authz";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { receiveBatch, startOfToday, stockTotals } from "../stock";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const year = () => new Date().getFullYear();
const pad = (n: number) => String(n).padStart(5, "0");

/** Pays down a supplier's open bills, oldest first (or one named bill). Each update is capped, so over-payment is impossible. */
async function allocateSupplierPayment(tx: TenantTx, supplierId: string, amount: number, grnId?: string) {
  const open = await tx.goodsReceipt.findMany({ where: { supplierId, ...(grnId ? { id: grnId } : {}) }, orderBy: { createdAt: "asc" } });
  let left = amount;
  for (const g of open) {
    if (left === 0) break;
    const room = g.totalPaise - g.paidPaise;
    if (room <= 0) continue;
    const put = Math.min(room, left);
    const rows = await tx.$executeRaw`UPDATE hms.goods_receipts SET paid_paise = paid_paise + ${put} WHERE id = ${g.id}::uuid AND paid_paise + ${put} <= total_paise`;
    if (rows === 1) left -= put;
  }
  if (left > 0) throw httpError(409, grnId ? "That payment is more than the bill still owes" : "That payment is more than the supplier is owed");
}

export default async function purchasingRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "pharmacy"));

  // ── suppliers ──
  app.get("/suppliers", { preHandler: staffGuard("pharmacy:purchase") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const suppliers = await tx.supplier.findMany({ orderBy: { name: "asc" } });
      const grns = await tx.goodsReceipt.groupBy({ by: ["supplierId"], _sum: { totalPaise: true, paidPaise: true } });
      return suppliers.map((s) => {
        const g = grns.find((x) => x.supplierId === s.id);
        return { ...s, billedPaise: g?._sum.totalPaise ?? 0, duePaise: (g?._sum.totalPaise ?? 0) - (g?._sum.paidPaise ?? 0) };
      });
    }),
  );

  app.post("/suppliers", { preHandler: staffGuard("pharmacy:purchase") }, async (req, reply) => {
    const input = supplierInput.parse(req.body);
    const s = await withTenant(db, staff(req).tid, (tx) => tx.supplier.create({ data: { tenantId: staff(req).tid, ...input } }));
    return reply.code(201).send(s);
  });

  app.patch("/suppliers/:id", { preHandler: staffGuard("pharmacy:purchase") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = supplierPatch.parse(req.body);
    return withTenant(db, staff(req).tid, (tx) => tx.supplier.update({ where: { id }, data: input }));
  });

  app.get("/suppliers/:id/ledger", { preHandler: staffGuard("pharmacy:purchase") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id } });
      if (!supplier) throw httpError(404, "Supplier not found");
      const grns = await tx.goodsReceipt.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 50 });
      const payments = await tx.supplierPayment.findMany({ where: { supplierId: id }, orderBy: { paidAt: "desc" }, take: 50 });
      return { supplier, grns, payments, duePaise: grns.reduce((a, g) => a + g.totalPaise - g.paidPaise, 0) };
    });
  });

  app.post("/suppliers/:id/payments", { preHandler: staffGuard("pharmacy:purchase") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = supplierPaymentInput.parse(req.body);
    const tenantId = staff(req).tid;
    const p = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id } }))) throw httpError(404, "Supplier not found");
      authorize(req, "pharmacy:purchase", { amountPaise: input.amountPaise });
      await allocateSupplierPayment(tx, id, input.amountPaise, input.grnId);
      return tx.supplierPayment.create({ data: { tenantId, supplierId: id, grnId: input.grnId, amountPaise: input.amountPaise, method: input.method, reference: input.reference, paidBy: staff(req).sub } });
    });
    return reply.code(201).send(p);
  });

  // ── purchase orders ──
  app.get("/purchase-orders", { preHandler: staffGuard("pharmacy:purchase") }, async (req) => {
    const { status } = z.object({ status: z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]).optional() }).parse(req.query);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.purchaseOrder.findMany({ where: { ...inScope(req), ...(status ? { status } : {}) }, include: { supplier: { select: { name: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 80 }),
    );
  });

  app.get("/purchase-orders/:id", { preHandler: staffGuard("pharmacy:purchase") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, ...inScope(req) }, include: { supplier: true, lines: true } });
      if (!po) throw httpError(404, "Purchase order not found");
      const meds = await tx.medicine.findMany({ where: { id: { in: po.lines.map((l) => l.medicineId) } }, select: { id: true, name: true, strength: true } });
      return { ...po, lines: po.lines.map((l) => ({ ...l, medicine: meds.find((m) => m.id === l.medicineId) })) };
    });
  });

  app.post("/purchase-orders", { preHandler: staffGuard("pharmacy:purchase") }, async (req, reply) => {
    const input = purchaseOrderInput.parse(req.body);
    const tenantId = staff(req).tid;
    const po = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.supplier.findFirst({ where: { id: input.supplierId, active: true } }))) throw httpError(404, "Supplier not found");
      const ids = [...new Set(input.lines.map((l) => l.medicineId))];
      if ((await tx.medicine.count({ where: { id: { in: ids } } })) !== ids.length) throw httpError(404, "Medicine not found");
      const total = input.lines.reduce((a, l) => a + l.qty * l.costPaise, 0);
      authorize(req, "pharmacy:purchase", { amountPaise: total });
      const seq = await nextSeq(tx, tenantId, `po:${year()}`);
      const created = await tx.purchaseOrder.create({
        data: { tenantId, branchId: req.access!.branchId, supplierId: input.supplierId, poNo: `PO-${req.access!.branchCode}-${year()}-${pad(seq)}`, status: input.placeOrder ? "ORDERED" : "DRAFT", orderedAt: input.placeOrder ? new Date() : undefined, notes: input.notes, createdBy: staff(req).sub },
      });
      await tx.purchaseOrderLine.createMany({ data: input.lines.map((l) => ({ tenantId, poId: created.id, medicineId: l.medicineId, qty: l.qty, costPaise: l.costPaise })) });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true, supplier: { select: { name: true } } } });
    });
    return reply.code(201).send(po);
  });

  const transition = (path: string, from: string[], to: "ORDERED" | "CANCELLED") =>
    app.post(path, { preHandler: staffGuard("pharmacy:purchase") }, async (req) => {
      const { id } = idParam.parse(req.params);
      return withTenant(db, staff(req).tid, async (tx) => {
        const po = await tx.purchaseOrder.findFirst({ where: { id, ...inScope(req) } });
        if (!po) throw httpError(404, "Purchase order not found");
        if (!from.includes(po.status)) throw httpError(409, `A ${po.status.toLowerCase()} order cannot be changed this way`);
        return tx.purchaseOrder.update({ where: { id }, data: { status: to, ...(to === "ORDERED" ? { orderedAt: new Date() } : {}) } });
      });
    });
  transition("/purchase-orders/:id/order", ["DRAFT"], "ORDERED");
  transition("/purchase-orders/:id/cancel", ["DRAFT", "ORDERED"], "CANCELLED");

  // Medicines at or below their reorder level, with a suggested quantity and the last cost paid.
  app.get("/pharmacy/reorder-suggestions", { preHandler: staffGuard("pharmacy:purchase") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const meds = await tx.medicine.findMany({ where: { active: true } });
      const totals = await stockTotals(tx, [req.access!.branchId]);
      const lastCost = await tx.stockBatch.findMany({ where: { branchId: req.access!.branchId, costPaise: { not: null } }, orderBy: { receivedAt: "desc" }, select: { medicineId: true, costPaise: true } });
      return meds
        .map((m) => ({ m, onHand: totals.get(m.id)?.onHand ?? 0 }))
        .filter(({ m, onHand }) => onHand <= m.reorderLevel)
        .map(({ m, onHand }) => ({ medicineId: m.id, name: `${m.name}${m.strength ? ` ${m.strength}` : ""}`, onHand, reorderLevel: m.reorderLevel, suggestedQty: Math.max(m.reorderLevel * 2 - onHand, 1), lastCostPaise: lastCost.find((c) => c.medicineId === m.id)?.costPaise ?? Math.round(m.pricePaise * 0.7) }));
    }),
  );

  // ── goods received (stock in against a supplier bill) ──
  app.get("/goods-receipts", { preHandler: staffGuard("pharmacy:purchase") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.goodsReceipt.findMany({ where: inScope(req), include: { supplier: { select: { name: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 80 })),
  );

  app.post("/goods-receipts", { preHandler: staffGuard("pharmacy:purchase") }, async (req, reply) => {
    const input = goodsReceiptInput.parse(req.body);
    const tenantId = staff(req).tid;
    const { branchId, branchCode } = req.access!;
    const grn = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.supplier.findFirst({ where: { id: input.supplierId, active: true } }))) throw httpError(404, "Supplier not found");
      const po = input.poId ? await tx.purchaseOrder.findFirst({ where: { id: input.poId, supplierId: input.supplierId, ...inScope(req) } }) : null;
      if (input.poId && !po) throw httpError(404, "Purchase order not found for this supplier");
      if (po && !["ORDERED", "DRAFT"].includes(po.status)) throw httpError(409, `That order is already ${po.status.toLowerCase()}`);
      const ids = [...new Set(input.lines.map((l) => l.medicineId))];
      if ((await tx.medicine.count({ where: { id: { in: ids } } })) !== ids.length) throw httpError(404, "Medicine not found");
      for (const l of input.lines) if (new Date(`${l.expiryDate}T00:00:00Z`) <= startOfToday()) throw httpError(400, `Batch ${l.batchNo} is already expired`);

      const total = input.lines.reduce((a, l) => a + l.qty * l.costPaise, 0);
      if (input.payment && input.payment.amountPaise > total) throw httpError(400, "The payment is more than the bill");
      const seq = await nextSeq(tx, tenantId, `grn:${year()}`);
      const g = await tx.goodsReceipt.create({
        data: { tenantId, branchId, supplierId: input.supplierId, poId: input.poId, grnNo: `GRN-${branchCode}-${year()}-${pad(seq)}`, billNo: input.billNo, billDate: input.billDate ? new Date(`${input.billDate}T00:00:00Z`) : undefined, totalPaise: total, receivedBy: staff(req).sub },
      });
      for (const l of input.lines) {
        const batch = await receiveBatch(tx, { tenantId, branchId, medicineId: l.medicineId, batchNo: l.batchNo, expiryDate: new Date(`${l.expiryDate}T00:00:00Z`), qty: l.qty, costPaise: l.costPaise, by: staff(req).sub, refType: "grn", refId: g.id });
        await tx.goodsReceiptLine.create({ data: { tenantId, grnId: g.id, medicineId: l.medicineId, batchId: batch.id, batchNo: l.batchNo, expiryDate: new Date(`${l.expiryDate}T00:00:00Z`), qty: l.qty, costPaise: l.costPaise } });
      }
      if (po) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED" } });
      if (input.payment) {
        await allocateSupplierPayment(tx, input.supplierId, input.payment.amountPaise, g.id);
        await tx.supplierPayment.create({ data: { tenantId, supplierId: input.supplierId, grnId: g.id, amountPaise: input.payment.amountPaise, method: input.payment.method, reference: input.payment.reference, paidBy: staff(req).sub } });
      }
      return tx.goodsReceipt.findUniqueOrThrow({ where: { id: g.id }, include: { lines: true, supplier: { select: { name: true } } } });
    });
    return reply.code(201).send(grn);
  });
}
