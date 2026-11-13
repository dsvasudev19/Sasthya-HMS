import { gstInvoicePdf, thermalReceiptPdf } from "../pdf";
import { loadPharmBill } from "../pharmBill";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { posSaleInput, saleReturnInput, shiftCloseInput, shiftOpenInput } from "@hms/contracts";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { authorize, inScope } from "../authz";
import { createInvoice, invoiceInclude, refundInvoice } from "../billing";
import { featureGate } from "../gates";
import { istDay } from "../billing";
import { staff, staffGuard, todayIst } from "../guards";
import { addDays, allocateFefo, restock, startOfToday, stockTotals } from "../stock";
import { httpError, prefixOf } from "../util";

const idParam = z.object({ id: z.string().uuid() });

/** Cash the drawer should hold: opening float + cash taken on this shift's sales - cash handed back on its returns. */
async function expectedCash(tx: TenantTx, shift: { id: string; branchId: string; openedBy: string; openedAt: Date; openingCashPaise: number }, until: Date): Promise<number> {
  const sales = await tx.payment.aggregate({ where: { method: "CASH", invoice: { dispense: { shiftId: shift.id } } }, _sum: { amountPaise: true } });
  const back = await tx.saleReturn.aggregate({ where: { branchId: shift.branchId, refundMethod: "CASH", createdBy: shift.openedBy, createdAt: { gte: shift.openedAt, lte: until } }, _sum: { amountPaise: true } });
  return shift.openingCashPaise + (sales._sum.amountPaise ?? 0) - (back._sum.amountPaise ?? 0);
}

export default async function posRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "pharmacy"));

  // ── cash drawer shifts ──
  app.get("/pos/shift", { preHandler: staffGuard("pharmacy:pos") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const shift = await tx.posShift.findFirst({ where: { branchId: req.access!.branchId, openedBy: staff(req).sub, closedAt: null } });
      if (!shift) return { shift: null };
      const sales = await tx.dispense.count({ where: { shiftId: shift.id } });
      return { shift, sales, expectedCashPaise: await expectedCash(tx, shift, new Date()) };
    }),
  );

  app.post("/pos/shifts/open", { preHandler: staffGuard("pharmacy:pos") }, async (req, reply) => {
    const { openingCashPaise } = shiftOpenInput.parse(req.body);
    const tenantId = staff(req).tid;
    const shift = await withTenant(db, tenantId, async (tx) => {
      // One open drawer per cashier per branch; the lock stops a double click opening two.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`shift:${req.access!.branchId}:${staff(req).sub}`}, 0))`;
      if (await tx.posShift.findFirst({ where: { branchId: req.access!.branchId, openedBy: staff(req).sub, closedAt: null } })) throw httpError(409, "You already have a shift open");
      return tx.posShift.create({ data: { tenantId, branchId: req.access!.branchId, openedBy: staff(req).sub, openingCashPaise } });
    });
    return reply.code(201).send(shift);
  });

  app.post("/pos/shifts/:id/close", { preHandler: staffGuard("pharmacy:pos") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = shiftCloseInput.parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const shift = await tx.posShift.findFirst({ where: { id, ...inScope(req), openedBy: staff(req).sub } });
      if (!shift) throw httpError(404, "Shift not found");
      if (shift.closedAt) throw httpError(409, "This shift is already closed");
      const now = new Date();
      const expected = await expectedCash(tx, shift, now);
      const closed = await tx.posShift.update({ where: { id }, data: { closedAt: now, closedBy: staff(req).sub, expectedCashPaise: expected, countedCashPaise: input.countedCashPaise, notes: input.notes } });
      return { ...closed, differencePaise: input.countedCashPaise - expected };
    });
  });

  app.get("/pos/shifts", { preHandler: staffGuard("pharmacy:reports") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.posShift.findMany({ where: inScope(req), orderBy: { openedAt: "desc" }, take: 40 });
      const names = new Map((await db.identity.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.openedBy))] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
      return rows.map((r) => ({ ...r, cashier: names.get(r.openedBy) ?? null, differencePaise: r.countedCashPaise !== null && r.expectedCashPaise !== null ? r.countedCashPaise - r.expectedCashPaise : null }));
    }),
  );

  // ── the sale ──
  app.post("/pos/sales", { preHandler: staffGuard("pharmacy:pos") }, async (req, reply) => {
    const input = posSaleInput.parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = await prefixOf(db, tenantId);
    const { branchId, branchCode } = req.access!;
    const out = await withTenant(db, tenantId, async (tx) => {
      const shift = await tx.posShift.findFirst({ where: { branchId, openedBy: staff(req).sub, closedAt: null } });
      if (!shift) throw httpError(409, "Open your shift before selling");
      if (input.patientId && !(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      if (input.consultationId) {
        if (!input.patientId) throw httpError(400, "A prescription sale needs the patient");
        const c = await tx.consultation.findFirst({ where: { id: input.consultationId, patientId: input.patientId } });
        if (!c) throw httpError(404, "Prescription not found for this patient");
        if (await tx.dispense.findFirst({ where: { consultationId: c.id } })) throw httpError(409, "This prescription was already dispensed");
      }
      const want = new Map<string, number>();
      for (const i of input.items) want.set(i.medicineId, (want.get(i.medicineId) ?? 0) + i.qty);
      const meds = await tx.medicine.findMany({ where: { id: { in: [...want.keys()] }, active: true } });
      if (meds.length !== want.size) throw httpError(404, "Medicine not found");
      if (meds.some((m) => m.scheduleDrug) && !input.prescriber && !input.consultationId) throw httpError(400, "Schedule H drugs need the prescriber's name");

      const subtotal = meds.reduce((s, m) => s + m.pricePaise * want.get(m.id)!, 0);
      const discount = Math.min(subtotal, input.discountPaise ?? Math.round((subtotal * (input.discountPercent ?? 0)) / 100));
      authorize(req, "pharmacy:pos", { discountPercent: subtotal ? Math.round((discount / subtotal) * 100) : 0, amountPaise: subtotal - discount });
      const total = subtotal - discount;
      const paid = input.payments.reduce((s, p) => s + p.amountPaise, 0);
      if (paid > total) throw httpError(400, "Payments add up to more than the total");
      if (paid < total && !input.patientId) throw httpError(400, `Collect the full ${(total / 100).toFixed(2)} from a walk-in customer`);

      const picks = [];
      for (const m of meds) picks.push(...(await allocateFefo(tx, { branchId, medicine: m, qty: want.get(m.id)! })));
      const invoice = await createInvoice(tx, {
        tenantId, tenantPrefix: prefix, branch: { id: branchId, code: branchCode }, patientId: input.patientId, customerName: input.customerName, customerPhone: input.customerPhone,
        source: "PHARMACY", createdBy: staff(req).sub, payments: input.payments, discountPaise: discount, note: input.prescriber ? `Prescriber: ${input.prescriber}` : undefined,
        lines: meds.map((m) => ({ kind: "MEDICINE" as const, description: `${m.name}${m.strength ? ` ${m.strength}` : ""}`, quantity: want.get(m.id)!, unitPaise: m.pricePaise, gstPercent: m.gstPercent })),
      });
      const sale = await tx.dispense.create({
        data: { tenantId, branchId, patientId: input.patientId, customerName: input.customerName, customerPhone: input.customerPhone, consultationId: input.consultationId, invoiceId: invoice.id, shiftId: shift.id, createdBy: staff(req).sub },
      });
      await tx.dispenseLine.createMany({ data: picks.map((p) => ({ tenantId, dispenseId: sale.id, medicineId: p.medicineId, batchId: p.batchId, qty: p.qty, unitPaise: p.unitPaise, amountPaise: p.qty * p.unitPaise })) });
      await tx.stockMovement.createMany({ data: picks.map((p) => ({ tenantId, branchId, medicineId: p.medicineId, batchId: p.batchId, type: "DISPENSE" as const, qty: -p.qty, refType: "dispense", refId: sale.id, createdBy: staff(req).sub })) });
      return { saleId: sale.id, invoice, changePaise: 0 };
    });
    return reply.code(201).send(out);
  });

  // Recent sales (for reprints and returns), searchable by invoice number, customer or phone.
  app.get("/pos/sales", { preHandler: staffGuard("pharmacy:pos") }, async (req) => {
    const { q, date } = z.object({ q: z.string().trim().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const range = istDay(date ?? todayIst());
    return withTenant(db, staff(req).tid, (tx) =>
      tx.dispense.findMany({
        where: {
          ...inScope(req),
          ...(q ? { invoice: { OR: [{ invoiceNo: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { customerPhone: { contains: q } }, { patient: { fullName: { contains: q, mode: "insensitive" } } }] } } : { createdAt: { gte: range.from, lt: range.to } }),
        },
        include: { invoice: { select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true, refundedPaise: true, customerName: true, patient: { select: { fullName: true } } } }, lines: true, returns: { select: { id: true, amountPaise: true } } },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    );
  });

  // The counter prints its own bill: a cashier needs this without needing access to billing.
  app.get("/pos/sales/:id/receipt.pdf", { preHandler: staffGuard("pharmacy:pos") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { format } = z.object({ format: z.enum(["a4", "thermal"]).default("thermal") }).parse(req.query);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    const out = await withTenant(db, tenant.id, async (tx) => {
      const sale = await tx.dispense.findFirst({ where: { id, ...inScope(req) }, select: { invoiceId: true } });
      if (!sale?.invoiceId) throw httpError(404, "Sale not found");
      const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "profile" } } });
      const profile = { legalName: tenant.name, address: "", phone: "", gstin: "", upiVpa: "", drugLicence: "", ...((row?.value as object | undefined) ?? {}) };
      return loadPharmBill(db, tx, tenant, sale.invoiceId, req.access!.branchIds, profile);
    });
    if (!out) throw httpError(404, "Sale not found");
    const pdf = await (format === "thermal" ? thermalReceiptPdf(out.bill, out.seller) : gstInvoicePdf(out.bill, out.seller));
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${out.bill.invoiceNo}.pdf"`).header("cache-control", "private, no-store").send(pdf);
  });

  app.get("/pos/sales/:id", { preHandler: staffGuard("pharmacy:pos") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const sale = await tx.dispense.findFirst({ where: { id, ...inScope(req) }, include: { lines: { include: { batch: { select: { batchNo: true, expiryDate: true } }, } }, returns: { include: { lines: true } } } });
      if (!sale) throw httpError(404, "Sale not found");
      const invoice = sale.invoiceId ? await tx.invoice.findUnique({ where: { id: sale.invoiceId }, include: invoiceInclude }) : null;
      const medicines = await tx.medicine.findMany({ where: { id: { in: sale.lines.map((l) => l.medicineId) } }, select: { id: true, name: true, strength: true } });
      const returned = new Map<string, number>();
      for (const r of sale.returns) for (const l of r.lines) returned.set(l.dispenseLineId, (returned.get(l.dispenseLineId) ?? 0) + l.qty);
      return { ...sale, invoice, lines: sale.lines.map((l) => ({ ...l, medicine: medicines.find((m) => m.id === l.medicineId), returnedQty: returned.get(l.id) ?? 0 })) };
    });
  });

  // ── returns ──
  app.post("/pos/returns", { preHandler: staffGuard("pharmacy:returns") }, async (req, reply) => {
    const input = saleReturnInput.parse(req.body);
    const tenantId = staff(req).tid;
    const { branchId, branchCode } = req.access!;
    const out = await withTenant(db, tenantId, async (tx) => {
      const sale = await tx.dispense.findFirst({ where: { id: input.dispenseId, ...inScope(req) }, include: { lines: true, returns: { include: { lines: true } } } });
      if (!sale || !sale.invoiceId) throw httpError(404, "Sale not found");
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: sale.invoiceId } });
      const already = new Map<string, number>();
      for (const r of sale.returns) for (const l of r.lines) already.set(l.dispenseLineId, (already.get(l.dispenseLineId) ?? 0) + l.qty);

      const ratio = inv.subtotalPaise === 0 ? 1 : inv.totalPaise / inv.subtotalPaise; // any discount is shared out across the lines
      let amount = 0;
      const lines: { dispenseLineId: string; qty: number; amountPaise: number }[] = [];
      for (const it of input.items) {
        const line = sale.lines.find((l) => l.id === it.dispenseLineId);
        if (!line) throw httpError(404, "Line not found on this sale");
        const left = line.qty - (already.get(line.id) ?? 0);
        if (it.qty > left) throw httpError(409, `Only ${left} of this item can still be returned`);
        const value = Math.round(line.unitPaise * it.qty * ratio);
        amount += value;
        lines.push({ dispenseLineId: line.id, qty: it.qty, amountPaise: value });
      }
      const refund = Math.min(amount, inv.paidPaise - inv.refundedPaise);
      authorize(req, "pharmacy:returns", { amountPaise: refund });
      const year = new Date().getFullYear();
      const seq = await nextSeq(tx, tenantId, `return:${year}`);
      const ret = await tx.saleReturn.create({
        data: { tenantId, branchId, dispenseId: sale.id, returnNo: `RET-${branchCode}-${year}-${String(seq).padStart(5, "0")}`, reason: input.reason, refundMethod: input.refundMethod, amountPaise: refund, createdBy: staff(req).sub },
      });
      await tx.saleReturnLine.createMany({ data: lines.map((l) => ({ tenantId, returnId: ret.id, ...l })) });
      for (const l of lines) {
        const line = sale.lines.find((x) => x.id === l.dispenseLineId)!;
        await restock(tx, { tenantId, branchId: sale.branchId, batchId: line.batchId, medicineId: line.medicineId, qty: l.qty, by: staff(req).sub, refId: ret.id });
      }
      if (refund > 0) await refundInvoice(tx, { tenantId, invoiceId: inv.id, amountPaise: refund, method: input.refundMethod, reason: `Sale return ${ret.returnNo}: ${input.reason}`, by: staff(req).sub });
      return { ...ret, lines, refundedPaise: refund };
    });
    return reply.code(201).send(out);
  });

  app.get("/pos/returns", { preHandler: staffGuard("pharmacy:returns") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.saleReturn.findMany({ where: inScope(req), include: { lines: true, dispense: { select: { invoice: { select: { invoiceNo: true } } } } }, orderBy: { createdAt: "desc" }, take: 60 })),
  );

  // ── dashboard cards for the pharmacy home screen ──
  app.get("/pharmacy/dashboard", { preHandler: staffGuard("pharmacy:read") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const { from, to } = istDay(todayIst());
      const today = startOfToday();
      const sales = await tx.invoice.aggregate({ where: { source: "PHARMACY", status: { not: "VOID" }, createdAt: { gte: from, lt: to }, ...inScope(req) }, _sum: { totalPaise: true }, _count: { _all: true } });
      const returns = await tx.saleReturn.aggregate({ where: { createdAt: { gte: from, lt: to }, ...inScope(req) }, _sum: { amountPaise: true }, _count: { _all: true } });
      const meds = await tx.medicine.findMany({ where: { active: true } });
      const totals = await stockTotals(tx, req.access!.branchIds);
      const low = meds.filter((m) => (totals.get(m.id)?.onHand ?? 0) <= m.reorderLevel).length;
      const soon = await tx.stockBatch.count({ where: { ...inScope(req), qtyOnHand: { gt: 0 }, expiryDate: { gt: today, lte: addDays(today, 60) } } });
      const expired = await tx.stockBatch.count({ where: { ...inScope(req), qtyOnHand: { gt: 0 }, expiryDate: { lte: today } } });
      const waiting = await tx.consultation.count({ where: { completedAt: { gte: addDays(new Date(), -3) }, items: { some: {} }, dispenses: { none: {} }, appointment: inScope(req) } });
      const top = await tx.dispenseLine.groupBy({ by: ["medicineId"], where: { dispense: { createdAt: { gte: from, lt: to }, ...inScope(req) } }, _sum: { qty: true, amountPaise: true }, orderBy: { _sum: { amountPaise: "desc" } }, take: 5 });
      const names = new Map(meds.map((m) => [m.id, `${m.name}${m.strength ? ` ${m.strength}` : ""}`]));
      const shift = await tx.posShift.findFirst({ where: { branchId: req.access!.branchId, openedBy: staff(req).sub, closedAt: null } });
      return {
        salesPaise: sales._sum.totalPaise ?? 0, salesCount: sales._count._all, returnsPaise: returns._sum.amountPaise ?? 0, returnsCount: returns._count._all,
        lowStock: low, expiringSoon: soon, expired, waitingPrescriptions: waiting, shiftOpen: !!shift,
        topItems: top.map((t) => ({ medicineId: t.medicineId, name: names.get(t.medicineId) ?? "Medicine", qty: t._sum.qty ?? 0, amountPaise: t._sum.amountPaise ?? 0 })),
      };
    }),
  );
}
