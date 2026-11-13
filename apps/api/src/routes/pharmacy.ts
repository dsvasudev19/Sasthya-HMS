import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adjustmentInput, dispenseInput, medicineInput, medicinePatch, receiptInput, transferInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { authorize, inScope } from "../authz";
import { createInvoice } from "../billing";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { addDays, allocateFefo, receiveBatch, startOfToday, stockTotals } from "../stock";
import { httpError, prefixOf } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export default async function pharmacyRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "pharmacy"));

  // ── catalogue (shared by every branch; stock is per branch) ──
  app.get("/medicines", { preHandler: staffGuard("pharmacy:read") }, async (req) => {
    const { q, all, barcode, low } = z.object({ q: z.string().trim().max(60).optional(), all: z.enum(["1"]).optional(), barcode: z.string().trim().max(40).optional(), low: z.enum(["1"]).optional() }).parse(req.query);
    return withTenant(db, staff(req).tid, async (tx) => {
      const meds = await tx.medicine.findMany({
        where: {
          ...(all ? {} : { active: true }),
          ...(barcode ? { barcode } : {}),
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { genericName: { contains: q, mode: "insensitive" } }, { barcode: q }] } : {}),
        },
        orderBy: { name: "asc" },
        take: 200,
      });
      const totals = await stockTotals(tx, req.access!.branchIds, meds.map((m) => m.id));
      const rows = meds.map((m) => ({ ...m, onHand: totals.get(m.id)?.onHand ?? 0, nextExpiry: totals.get(m.id)?.nextExpiry ?? null }));
      return low ? rows.filter((m) => m.onHand <= m.reorderLevel) : rows;
    });
  });

  app.post("/medicines", { preHandler: staffGuard("pharmacy:write") }, async (req, reply) => {
    const input = medicineInput.parse(req.body);
    const created = await withTenant(db, staff(req).tid, (tx) => tx.medicine.create({ data: { tenantId: staff(req).tid, ...input } }));
    return reply.code(201).send(created);
  });

  app.patch("/medicines/:id", { preHandler: staffGuard("pharmacy:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = medicinePatch.parse(req.body);
    return withTenant(db, staff(req).tid, (tx) => tx.medicine.update({ where: { id }, data: input }));
  });

  app.get("/medicines/:id/batches", { preHandler: staffGuard("pharmacy:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => ({
      batches: await tx.stockBatch.findMany({ where: { medicineId: id, ...inScope(req) }, orderBy: { expiryDate: "asc" }, include: { branch: { select: { code: true } } } }),
      movements: await tx.stockMovement.findMany({ where: { medicineId: id, ...inScope(req) }, orderBy: { createdAt: "desc" }, take: 30, include: { batch: { select: { batchNo: true } } } }),
    }));
  });

  // ── stock in / adjustments (the branch being worked in) ──
  app.post("/pharmacy/receipts", { preHandler: staffGuard("pharmacy:write") }, async (req, reply) => {
    const input = receiptInput.parse(req.body);
    const tenantId = staff(req).tid;
    const expiry = day(input.expiryDate);
    if (expiry <= startOfToday()) throw httpError(400, "This batch is already expired");
    const batch = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.medicine.findUnique({ where: { id: input.medicineId } }))) throw httpError(404, "Medicine not found");
      return receiveBatch(tx, { tenantId, branchId: req.access!.branchId, medicineId: input.medicineId, batchNo: input.batchNo, expiryDate: expiry, qty: input.qty, costPaise: input.costPaise, by: staff(req).sub });
    });
    return reply.code(201).send(batch);
  });

  app.post("/pharmacy/adjustments", { preHandler: staffGuard("pharmacy:write") }, async (req, reply) => {
    const input = adjustmentInput.parse(req.body);
    const tenantId = staff(req).tid;
    const result = await withTenant(db, tenantId, async (tx) => {
      const batch = await tx.stockBatch.findFirst({ where: { id: input.batchId, ...inScope(req) } });
      if (!batch) throw httpError(404, "Batch not found");
      authorize(req, "pharmacy:write", { quantity: Math.abs(input.qtyDelta) });
      const rows = await tx.$executeRaw`UPDATE hms.stock_batches SET qty_on_hand = qty_on_hand + ${input.qtyDelta}
        WHERE id = ${input.batchId}::uuid AND qty_on_hand + ${input.qtyDelta} >= 0 AND qty_on_hand + ${input.qtyDelta} <= qty_received`;
      if (rows === 0) throw httpError(409, "Adjustment would take the batch below zero or above what was received");
      await tx.stockMovement.create({
        data: { tenantId, branchId: batch.branchId, medicineId: batch.medicineId, batchId: batch.id, type: input.reason === "EXPIRED" ? "EXPIRY" : "ADJUSTMENT", qty: input.qtyDelta, note: `${input.reason}${input.note ? `: ${input.note}` : ""}`, createdBy: staff(req).sub },
      });
      return tx.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    });
    return reply.code(201).send(result);
  });

  app.get("/pharmacy/alerts", { preHandler: staffGuard("pharmacy:read") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const today = startOfToday();
      const meds = await tx.medicine.findMany({ where: { active: true } });
      const totals = await stockTotals(tx, req.access!.branchIds);
      const lowStock = meds.filter((m) => (totals.get(m.id)?.onHand ?? 0) <= m.reorderLevel).map((m) => ({ id: m.id, name: m.name, strength: m.strength, onHand: totals.get(m.id)?.onHand ?? 0, reorderLevel: m.reorderLevel }));
      const include = { medicine: { select: { name: true, strength: true } }, branch: { select: { code: true } } };
      const soon = await tx.stockBatch.findMany({ where: { ...inScope(req), qtyOnHand: { gt: 0 }, expiryDate: { gt: today, lte: addDays(today, 60) } }, include, orderBy: { expiryDate: "asc" } });
      const expired = await tx.stockBatch.findMany({ where: { ...inScope(req), qtyOnHand: { gt: 0 }, expiryDate: { lte: today } }, include, orderBy: { expiryDate: "asc" } });
      return { lowStock, expiringSoon: soon, expired };
    }),
  );

  // Prescriptions waiting at the counter: completed in the last 3 days, nothing dispensed yet.
  app.get("/pharmacy/prescriptions", { preHandler: staffGuard("pharmacy:read") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.consultation.findMany({
        where: { completedAt: { gte: addDays(new Date(), -3) }, items: { some: {} }, dispenses: { none: {} }, appointment: inScope(req) },
        include: { items: true, patient: { select: { id: true, fullName: true, patientNo: true } }, doctor: { select: { fullName: true } } },
        orderBy: { completedAt: "asc" },
      });
      const medIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.medicineId).filter(Boolean) as string[]))];
      const totals = await stockTotals(tx, req.access!.branchIds, medIds);
      return rows.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, available: i.medicineId ? totals.get(i.medicineId)?.onHand ?? 0 : null })) }));
    }),
  );

  // ── dispensing a prescription (the POS sale is POST /pos/sales) ──
  app.post("/pharmacy/dispense", { preHandler: staffGuard("pharmacy:pos") }, async (req, reply) => {
    const input = dispenseInput.parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = await prefixOf(db, tenantId);
    const { branchId, branchCode } = req.access!;
    const out = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      if (input.consultationId) {
        const c = await tx.consultation.findFirst({ where: { id: input.consultationId, patientId: input.patientId } });
        if (!c) throw httpError(404, "Prescription not found for this patient");
        if (await tx.dispense.findFirst({ where: { consultationId: c.id } })) throw httpError(409, "This prescription was already dispensed");
      }
      const want = new Map<string, number>();
      for (const i of input.items) want.set(i.medicineId, (want.get(i.medicineId) ?? 0) + i.qty);
      const meds = await tx.medicine.findMany({ where: { id: { in: [...want.keys()] }, active: true } });
      if (meds.length !== want.size) throw httpError(404, "Medicine not found");
      const picks = [];
      for (const m of meds) picks.push(...(await allocateFefo(tx, { branchId, medicine: m, qty: want.get(m.id)! })));

      const invoice = await createInvoice(tx, {
        tenantId, tenantPrefix: prefix, branch: { id: branchId, code: branchCode }, patientId: input.patientId, source: "PHARMACY", createdBy: staff(req).sub, payment: input.payment,
        lines: meds.map((m) => ({ kind: "MEDICINE" as const, description: `${m.name}${m.strength ? ` ${m.strength}` : ""}`, quantity: want.get(m.id)!, unitPaise: m.pricePaise, gstPercent: m.gstPercent })),
      });
      const dispense = await tx.dispense.create({ data: { tenantId, branchId, patientId: input.patientId, consultationId: input.consultationId, invoiceId: invoice.id, createdBy: staff(req).sub } });
      await tx.dispenseLine.createMany({ data: picks.map((p) => ({ tenantId, dispenseId: dispense.id, medicineId: p.medicineId, batchId: p.batchId, qty: p.qty, unitPaise: p.unitPaise, amountPaise: p.qty * p.unitPaise })) });
      await tx.stockMovement.createMany({ data: picks.map((p) => ({ tenantId, branchId, medicineId: p.medicineId, batchId: p.batchId, type: "DISPENSE" as const, qty: -p.qty, refType: "dispense", refId: dispense.id, createdBy: staff(req).sub })) });
      return { dispenseId: dispense.id, invoice };
    });
    return reply.code(201).send(out);
  });

  // ── stock transfer between branches ──
  app.post("/pharmacy/transfers", { preHandler: staffGuard("pharmacy:transfer") }, async (req, reply) => {
    const input = transferInput.parse(req.body);
    const tenantId = staff(req).tid;
    const from = req.access!.branchId;
    if (input.toBranchId === from) throw httpError(400, "Choose a different branch to send stock to");
    const out = await withTenant(db, tenantId, async (tx) => {
      const dest = await tx.branch.findFirst({ where: { id: input.toBranchId, active: true } });
      if (!dest) throw httpError(404, "Destination branch not found");
      const moved = [];
      for (const it of input.items) {
        const b = await tx.stockBatch.findFirst({ where: { id: it.batchId, branchId: from } });
        if (!b) throw httpError(404, "Batch not found in this branch");
        if (b.expiryDate <= startOfToday()) throw httpError(409, `Batch ${b.batchNo} is expired and cannot be transferred`);
        const rows = await tx.$executeRaw`UPDATE hms.stock_batches SET qty_on_hand = qty_on_hand - ${it.qty} WHERE id = ${b.id}::uuid AND qty_on_hand >= ${it.qty}`;
        if (rows === 0) throw httpError(409, `Only ${b.qtyOnHand} left in batch ${b.batchNo}`);
        await tx.stockMovement.create({ data: { tenantId, branchId: from, medicineId: b.medicineId, batchId: b.id, type: "TRANSFER_OUT", qty: -it.qty, refType: "transfer", note: `To ${dest.code}${input.note ? `: ${input.note}` : ""}`, createdBy: staff(req).sub } });
        await receiveBatch(tx, { tenantId, branchId: dest.id, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: it.qty, costPaise: b.costPaise, by: staff(req).sub, type: "TRANSFER_IN", refType: "transfer", note: `From ${req.access!.branchCode}` });
        moved.push({ medicineId: b.medicineId, batchNo: b.batchNo, qty: it.qty });
      }
      return { to: dest.code, moved };
    });
    return reply.code(201).send(out);
  });
}
