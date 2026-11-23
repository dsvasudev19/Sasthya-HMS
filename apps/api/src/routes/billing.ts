import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { closingInput, createInvoiceInput, paymentInput, profileInput, refundInput, updateFeeInput } from "@hms/contracts";
import { taxInside, type PaymentGateway } from "@hms/billing-core";
import { enqueueManual } from "@hms/notifications";
import { effectivePlan, hasFeature } from "@hms/billing-core";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { adjustPatientAdvance, createInvoice, createPatientAdvance, invoiceInclude, istDay, recordPayment, refundInvoice } from "../billing";
import { authorize, inScope } from "../authz";
import { advanceReceiptPdf, gstInvoicePdf, patientInvoicePdf, thermalReceiptPdf } from "../pdf";
import { loadPharmBill } from "../pharmBill";
import { staff, staffGuard, todayIst } from "../guards";

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayIst()) });

export interface Profile { legalName: string; address: string; phone: string; gstin: string; upiVpa: string; drugLicence: string }

async function getProfile(tx: TenantTx, tenantId: string, fallbackName: string): Promise<Profile> {
  const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "profile" } } });
  return { legalName: fallbackName, address: "", phone: "", gstin: "", upiVpa: "", drugLicence: "", ...((row?.value as Partial<Profile> | undefined) ?? {}) };
}

/** GST per rate with the CGST/SGST split, scaled for any discount. */
export function taxBreakup(inv: { subtotalPaise: number; totalPaise: number; lines: { amountPaise: number; gstPercent: number }[] }) {
  const byRate = new Map<number, number>();
  for (const l of inv.lines) if (l.gstPercent > 0) byRate.set(l.gstPercent, (byRate.get(l.gstPercent) ?? 0) + l.amountPaise);
  return [...byRate.entries()].map(([rate, gross]) => {
    const net = inv.subtotalPaise === 0 ? 0 : Math.round((gross * inv.totalPaise) / inv.subtotalPaise);
    const tax = taxInside(net, rate);
    const cgst = Math.floor(tax / 2);
    return { gstPercent: rate, taxablePaise: net - tax, cgstPaise: cgst, sgstPaise: tax - cgst };
  });
}

export default async function billingRoutes(app: FastifyInstance, { db, gateway }: { db: PrismaClient; gateway: PaymentGateway | null }) {
  // ── price list ──
  app.get("/fee-items", { preHandler: staffGuard("billing:read") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.feeItem.findMany({ where: { active: true }, orderBy: { name: "asc" } })),
  );

  app.patch("/fee-items/:id", { preHandler: staffGuard("billing:close") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { pricePaise } = updateFeeInput.parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const item = await tx.feeItem.update({ where: { id }, data: { pricePaise } });
      await tx.auditLog.create({ data: { tenantId: staff(req).tid, actorIdentityId: staff(req).sub, action: "fee.update", entity: "fee_item", entityId: id, meta: { pricePaise } } });
      return item;
    });
  });

  // ── invoices ──
  app.get("/invoices", { preHandler: staffGuard("billing:read") }, async (req) => {
    const q = z.object({
      status: z.enum(["UNPAID", "PARTIAL", "PAID", "VOID"]).optional(),
      patientId: z.string().uuid().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      q: z.string().trim().max(60).optional(),
    }).parse(req.query);
    const range = q.date ? istDay(q.date) : null;
    return withTenant(db, staff(req).tid, (tx) =>
      tx.invoice.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.patientId ? { patientId: q.patientId } : {}),
          ...inScope(req),
          ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
          ...(q.q ? { OR: [{ invoiceNo: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }] } : {}),
        },
        include: { patient: { select: { id: true, fullName: true, patientNo: true } }, branch: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  });

  app.get("/invoices/:id", { preHandler: staffGuard("billing:read") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    return withTenant(db, staff(req).tid, async (tx) => {
      const inv = await tx.invoice.findFirstOrThrow({ where: { id, ...inScope(req) }, include: invoiceInclude });
      return { ...inv, hospital: await getProfile(tx, tenant.id, tenant.name), taxBreakup: taxBreakup(inv), gatewayEnabled: !!gateway };
    });
  });

  app.get("/invoices/:id/pdf", { preHandler: staffGuard("billing:read") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { format } = z.object({ format: z.enum(["a4", "thermal"]).default("a4") }).parse(req.query);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    const data = await withTenant(db, tenant.id, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, ...inScope(req) }, include: { ...invoiceInclude, branch: { select: { name: true, address: true, phone: true } } } });
      if (!inv) throw httpError(404, "Invoice not found");
      const profile = await getProfile(tx, tenant.id, tenant.name);
      // A pharmacy sale prints as a GST bill with batch, expiry and HSN; everything else as the plain invoice.
      return { inv, profile, pharm: inv.source === "PHARMACY" ? await loadPharmBill(db, tx, tenant, id, req.access!.branchIds, profile) : null };
    });
    const { inv, profile, pharm } = data;
    if (pharm) {
      const out = await (format === "thermal" ? thermalReceiptPdf(pharm.bill, pharm.seller) : gstInvoicePdf(pharm.bill, pharm.seller));
      return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${inv.invoiceNo}.pdf"`).send(out);
    }
    const pdf = await patientInvoicePdf(inv as never, { name: profile.legalName, branchName: inv.branch.name, address: profile.address || inv.branch.address, phone: profile.phone || inv.branch.phone, gstin: profile.gstin });
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${inv.invoiceNo}.pdf"`).send(pdf);
  });

  app.post("/invoices", { preHandler: staffGuard("billing:write") }, async (req, reply) => {
    const input = createInvoiceInput.parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const created = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      if (input.appointmentId && !(await tx.appointment.findFirst({ where: { id: input.appointmentId, patientId: input.patientId } }))) throw httpError(404, "Appointment not found");
      const subtotal = input.lines.reduce((a, l) => a + l.quantity * l.unitPaise, 0);
      authorize(req, "billing:write", { discountPercent: subtotal ? Math.round((input.discountPaise / subtotal) * 100) : 0, amountPaise: subtotal - input.discountPaise });
      return createInvoice(tx, { tenantId, tenantPrefix: tenant.slug.slice(0, 3).toUpperCase(), branch: { id: req.access!.branchId, code: req.access!.branchCode }, source: "MANUAL", createdBy: staff(req).sub, ...input });
    });
    return reply.code(201).send(created);
  });

  app.post("/invoices/:id/payments", { preHandler: staffGuard("billing:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const bodySchema = z.object({
      amountPaise: z.number().int().min(1),
      method: z.enum(["CASH", "UPI", "CARD", "INSURANCE", "CHEQUE", "BANK_TRANSFER", "ADVANCE"]),
      reference: z.string().trim().max(80).optional(),
    });
    const input = bodySchema.parse(req.body);
    const tenantId = staff(req).tid;
    const updated = await withTenant(db, tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, ...inScope(req) } });
      if (!inv) throw httpError(404, "Invoice not found");
      authorize(req, "billing:write", { amountPaise: input.amountPaise });

      if (input.method === "ADVANCE") {
        if (!inv.patientId) throw httpError(400, "Cannot pay from advance for walk-in customer without patient profile");
        await adjustPatientAdvance(tx, tenantId, id, inv.patientId, input.amountPaise, staff(req).sub);
      } else {
        await recordPayment(tx, tenantId, id, {
          amountPaise: input.amountPaise,
          method: input.method,
          reference: input.reference,
          receivedBy: staff(req).sub,
        });
      }
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
    return reply.code(201).send(updated);
  });

  // ── Patient Advances / Deposits ──

  app.post("/patients/:id/advances", { preHandler: staffGuard("billing:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      amountPaise: z.number().int().min(100),
      method: z.enum(["CASH", "UPI", "CARD", "INSURANCE", "CHEQUE", "BANK_TRANSFER"]),
      reference: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(300).optional(),
    }).parse(req.body);

    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id } });
      if (!patient) throw httpError(404, "Patient not found");

      const adv = await createPatientAdvance(tx, {
        tenantId,
        patientId: id,
        amountPaise: body.amountPaise,
        method: body.method,
        reference: body.reference,
        notes: body.notes,
        receivedBy: staff(req).sub,
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorIdentityId: staff(req).sub,
          action: "patient.advance",
          entity: "patient_advance",
          entityId: adv.id,
          meta: { receiptNo: adv.receiptNo, amountPaise: adv.amountPaise },
        },
      });

      return reply.code(201).send(adv);
    });
  });

  app.get("/patients/:id/advances", { preHandler: staffGuard("billing:read") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const advances = await tx.patientAdvance.findMany({
        where: { tenantId, patientId: id },
        orderBy: { createdAt: "desc" },
      });
      const totalAdvancePaise = advances.reduce((s, a) => s + a.amountPaise, 0);
      const availableBalancePaise = advances.reduce((s, a) => s + a.balancePaise, 0);
      return { advances, totalAdvancePaise, availableBalancePaise };
    });
  });

  app.get("/billing/advances", { preHandler: staffGuard("billing:read") }, async (req) => {
    return withTenant(db, staff(req).tid, async (tx) => {
      return tx.patientAdvance.findMany({
        include: { patient: { select: { id: true, fullName: true, patientNo: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    });
  });

  app.get("/advances/:id/receipt.pdf", { preHandler: staffGuard("billing:read") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const profile = await db.tenantProfile.findUnique({ where: { tenantId } });

    const adv = await withTenant(db, tenantId, async (tx) => {
      return tx.patientAdvance.findUnique({
        where: { id },
        include: { patient: { select: { fullName: true, patientNo: true, phone: true } } },
      });
    });
    if (!adv) throw httpError(404, "Advance receipt not found");

    const pdf = await advanceReceiptPdf({
      hospital: {
        name: profile?.legalName || tenant.name,
        address: profile?.addressLine1,
        phone: profile?.contactPhone,
        gstin: profile?.gstin,
      },
      receiptNo: adv.receiptNo,
      createdAt: adv.createdAt,
      patient: {
        name: adv.patient.fullName,
        patientNo: adv.patient.patientNo,
        phone: adv.patient.phone,
      },
      amountPaise: adv.amountPaise,
      balancePaise: adv.balancePaise,
      method: adv.method,
      reference: adv.reference,
      notes: adv.notes,
    });

    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="receipt-${adv.receiptNo}.pdf"`)
      .send(pdf);
  });

  // Void is only possible before any money is taken. Refunds are handled outside the system for now.
  app.post("/invoices/:id/void", { preHandler: staffGuard("billing:close") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, ...inScope(req) } });
      if (!inv) throw httpError(404, "Invoice not found");
      authorize(req, "billing:close", { amountPaise: inv.totalPaise });
      if (inv.status === "VOID") throw httpError(409, "Already void");
      if (inv.paidPaise > 0) throw httpError(409, "Money has been collected on this invoice, so it cannot be voided");
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "invoice.void", entity: "invoice", entityId: id } });
      return tx.invoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() }, include: invoiceInclude });
    });
  });

  // ── refunds: owner or admin, only up to what was paid, always with a reason ──
  app.post("/invoices/:id/refunds", { preHandler: staffGuard("billing:refund") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = refundInput.parse(req.body);
    const tenantId = staff(req).tid;
    const updated = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.invoice.findFirst({ where: { id, ...inScope(req) }, select: { id: true } }))) throw httpError(404, "Invoice not found");
      authorize(req, "billing:refund", { amountPaise: input.amountPaise });
      await refundInvoice(tx, { tenantId, invoiceId: id, ...input, by: staff(req).sub });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "invoice.refund", entity: "invoice", entityId: id, meta: { ...input } } });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
    return reply.code(201).send(updated);
  });

  // ── hospital profile: name, address, GSTIN and UPI id for receipts ──
  app.get("/settings/profile", { preHandler: staffGuard("billing:read") }, async (req) => {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    return withTenant(db, tenant.id, (tx) => getProfile(tx, tenant.id, tenant.name));
  });
  app.put("/settings/profile", { preHandler: staffGuard("settings:write") }, async (req) => {
    const input = profileInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      await tx.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: "profile" } }, update: { value: { ...input } }, create: { tenantId, key: "profile", value: { ...input } } });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "settings.profile", entity: "tenant_settings" } });
      return input;
    });
  });

  // ── online payment link (gateway) ──
  app.post("/invoices/:id/payment-link", { preHandler: staffGuard("billing:write") }, async (req, reply) => {
    if (!gateway) throw httpError(503, "Online payments are not set up for this deployment");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { sendSms } = z.object({ sendSms: z.boolean().default(false) }).parse(req.body ?? {});
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    return withTenant(db, tenant.id, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, ...inScope(req) }, include: { patient: true } });
      if (!inv) throw httpError(404, "Invoice not found");
      const due = inv.totalPaise - inv.paidPaise;
      if (inv.status === "VOID" || inv.status === "REFUNDED" || due <= 0) throw httpError(409, "Nothing is due on this invoice");
      const link = await gateway.createPaymentLink({
        amountPaise: due, reference: inv.id, description: `${tenant.name} bill ${inv.invoiceNo}`, customerName: inv.patient?.fullName ?? inv.customerName ?? undefined,
        customerPhone: (inv.patient?.phone ?? inv.customerPhone) ? `+91${inv.patient?.phone ?? inv.customerPhone}` : undefined, notes: { tenantId: tenant.id, invoiceId: inv.id },
      });
      await tx.paymentLink.create({ data: { tenantId: tenant.id, invoiceId: inv.id, gatewayRef: link.gatewayRef, url: link.url, amountPaise: due } });
      let sms = false;
      if (sendSms && inv.patientId && hasFeature(effectivePlan(tenant), "messaging")) sms = await enqueueManual(tx, { tenantId: tenant.id, patientId: inv.patientId!, text: `${tenant.name}: pay your bill ${inv.invoiceNo} of Rs ${(due / 100).toFixed(2)} online: ${link.url}` });
      return reply.code(201).send({ url: link.url, amountPaise: due, smsQueued: sms });
    });
  });

  // ── daily collections and cash closing (per branch) ──
  // Payments and refunds belong to the branch of their invoice.
  const payWhere = (req: Parameters<typeof inScope>[0], from: Date, to: Date) => ({ receivedAt: { gte: from, lt: to }, invoice: inScope(req) });
  const refWhere = (req: Parameters<typeof inScope>[0], from: Date, to: Date) => ({ createdAt: { gte: from, lt: to }, invoice: inScope(req) });

  app.get("/billing/collections", { preHandler: staffGuard("billing:read") }, async (req) => {
    const { date } = dateQuery.parse(req.query);
    const { from, to } = istDay(date);
    return withTenant(db, staff(req).tid, async (tx) => {
      const payments = await tx.payment.groupBy({ by: ["method"], where: payWhere(req, from, to), _sum: { amountPaise: true }, _count: { _all: true } });
      const refunds = await tx.refund.groupBy({ by: ["method"], where: refWhere(req, from, to), _sum: { amountPaise: true } });
      const byMethod = { CASH: 0, UPI: 0, CARD: 0, INSURANCE: 0, CHEQUE: 0, BANK_TRANSFER: 0 } as Record<string, number>;
      for (const p of payments) byMethod[p.method] = p._sum.amountPaise ?? 0;
      const refunded = refunds.reduce((a, r) => a + (r._sum.amountPaise ?? 0), 0);
      for (const r of refunds) byMethod[r.method] = (byMethod[r.method] ?? 0) - (r._sum.amountPaise ?? 0); // money handed back is not collected
      const issued = await tx.invoice.aggregate({ where: { createdAt: { gte: from, lt: to }, status: { not: "VOID" }, ...inScope(req) }, _sum: { totalPaise: true, paidPaise: true }, _count: { _all: true } });
      const closing = req.access!.viewingAll ? null : await tx.dailyClosing.findUnique({ where: { tenantId_branchId_date: { tenantId: staff(req).tid, branchId: req.access!.branchId, date: new Date(`${date}T00:00:00Z`) } } });
      return {
        date,
        branch: req.access!.viewingAll ? "all" : req.access!.branchCode,
        collectedPaise: Object.values(byMethod).reduce((a, b) => a + b, 0),
        refundedPaise: refunded,
        byMethod,
        paymentCount: payments.reduce((a, p) => a + p._count._all, 0),
        invoicesIssued: issued._count._all,
        billedPaise: issued._sum.totalPaise ?? 0,
        outstandingPaise: (issued._sum.totalPaise ?? 0) - (issued._sum.paidPaise ?? 0),
        closing,
      };
    });
  });

  // Each branch closes its own day against its own cash drawer.
  app.post("/billing/closings", { preHandler: staffGuard("billing:close") }, async (req, reply) => {
    const input = closingInput.parse(req.body);
    const tenantId = staff(req).tid;
    const { from, to } = istDay(input.date);
    const here = { ...req, access: { ...req.access!, branchIds: [req.access!.branchId] } } as typeof req;
    const closing = await withTenant(db, tenantId, async (tx) => {
      const pay = await tx.payment.groupBy({ by: ["method"], where: payWhere(here, from, to), _sum: { amountPaise: true } });
      const ref = await tx.refund.groupBy({ by: ["method"], where: refWhere(here, from, to), _sum: { amountPaise: true } });
      const cash = (pay.find((p) => p.method === "CASH")?._sum.amountPaise ?? 0) - (ref.find((r) => r.method === "CASH")?._sum.amountPaise ?? 0);
      const total = pay.reduce((a, p) => a + (p._sum.amountPaise ?? 0), 0) - ref.reduce((a, r) => a + (r._sum.amountPaise ?? 0), 0);
      return tx.dailyClosing.create({
        data: { tenantId, branchId: req.access!.branchId, date: new Date(`${input.date}T00:00:00Z`), expectedCashPaise: cash, countedCashPaise: input.countedCashPaise, totalCollectedPaise: total, notes: input.notes, closedBy: staff(req).sub },
      });
    });
    return reply.code(201).send({ ...closing, differencePaise: closing.countedCashPaise - closing.expectedCashPaise });
  });

  app.get("/billing/closings", { preHandler: staffGuard("billing:read") }, async (req) =>
    withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.dailyClosing.findMany({ where: inScope(req), orderBy: { date: "desc" }, take: 30, include: { branch: { select: { code: true, name: true } } } });
      return rows.map((c) => ({ ...c, differencePaise: c.countedCashPaise - c.expectedCashPaise }));
    }),
  );
}
