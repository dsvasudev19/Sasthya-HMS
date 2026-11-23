import { taxInside } from "@hms/billing-core";
import { nextSeq, type TenantTx } from "@hms/db";

export type LineInput = { kind: "CONSULTATION" | "CARD_ISSUE" | "CARD_PLAN" | "SERVICE" | "MEDICINE" | "LAB" | "OTHER"; description: string; quantity: number; unitPaise: number; gstPercent?: number };
type Method = "CASH" | "UPI" | "CARD" | "INSURANCE" | "CHEQUE" | "BANK_TRANSFER";

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export const invoiceInclude = {
  lines: true,
  payments: { orderBy: { receivedAt: "asc" as const } },
  refunds: { orderBy: { createdAt: "asc" as const } },
  patient: { select: { id: true, fullName: true, patientNo: true, phone: true } },
} as const;

export interface BranchRef { id: string; code: string }

export interface NewInvoice {
  tenantId: string;
  tenantPrefix: string;
  branch: BranchRef;
  /** Omit for a counter sale to a walk-in customer. */
  patientId?: string;
  customerName?: string;
  customerPhone?: string;
  appointmentId?: string;
  source: "MANUAL" | "CONSULTATION" | "HEALTH_CARD" | "PHARMACY" | "LAB" | "IPD";
  lines: LineInput[];
  discountPaise?: number;
  note?: string;
  createdBy?: string;
  /** One payment (amount defaults to the whole total) or several, for a split tender. */
  payment?: { method: Method; amountPaise?: number; reference?: string };
  payments?: { method: Method; amountPaise: number; reference?: string }[];
}

/** Creates an invoice with a gap-free number and optionally takes payment in the same transaction. */
export async function createInvoice(tx: TenantTx, inv: NewInvoice) {
  const subtotal = inv.lines.reduce((sum, l) => sum + l.quantity * l.unitPaise, 0);
  const discount = inv.discountPaise ?? 0;
  if (discount > subtotal) throw httpError(400, "Discount cannot be more than the bill");
  const total = subtotal - discount;
  // Prices are tax-inclusive. A discount shrinks the taxable value in the same proportion.
  const grossTax = inv.lines.reduce((sum, l) => sum + taxInside(l.quantity * l.unitPaise, l.gstPercent ?? 0), 0);
  const tax = subtotal === 0 ? 0 : Math.round((grossTax * total) / subtotal);
  const year = new Date().getFullYear();
  // The main branch keeps the original numbering; other branches carry their code, with their own sequence.
  const main = inv.branch.code === "MAIN";
  const seq = await nextSeq(tx, inv.tenantId, main ? `invoice:${year}` : `invoice:${inv.branch.code}:${year}`);
  const created = await tx.invoice.create({
    data: {
      tenantId: inv.tenantId,
      branchId: inv.branch.id,
      invoiceNo: `${inv.tenantPrefix}${main ? "" : `-${inv.branch.code}`}-${year}-${String(seq).padStart(5, "0")}`,
      patientId: inv.patientId,
      customerName: inv.customerName,
      customerPhone: inv.customerPhone,
      appointmentId: inv.appointmentId,
      source: inv.source,
      status: total === 0 ? "PAID" : "UNPAID",
      subtotalPaise: subtotal,
      discountPaise: discount,
      totalPaise: total,
      taxPaise: tax,
      note: inv.note,
      createdBy: inv.createdBy,
    },
  });
  await tx.invoiceLine.createMany({
    data: inv.lines.map((l) => ({ tenantId: inv.tenantId, invoiceId: created.id, kind: l.kind, description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.quantity * l.unitPaise, gstPercent: l.gstPercent ?? 0 })),
  });
  if (total > 0) {
    const pays = inv.payments ?? (inv.payment ? [{ ...inv.payment, amountPaise: inv.payment.amountPaise ?? total }] : []);
    const sum = pays.reduce((a, p) => a + p.amountPaise, 0);
    if (sum > total) throw httpError(400, "Payments add up to more than the total");
    for (const p of pays) await recordPayment(tx, inv.tenantId, created.id, { method: p.method, amountPaise: p.amountPaise, reference: p.reference, receivedBy: inv.createdBy });
  }
  return tx.invoice.findUniqueOrThrow({ where: { id: created.id }, include: invoiceInclude });
}

/**
 * Adds a payment. The balance check and the update are one atomic statement, so two cashiers can never
 * overpay an invoice or pay a void one.
 */
export async function recordPayment(tx: TenantTx, tenantId: string, invoiceId: string, p: { amountPaise: number; method: Method; reference?: string; receivedBy?: string; externalId?: string }) {
  const updated = await tx.$executeRaw`
    UPDATE hms.invoices
    SET paid_paise = paid_paise + ${p.amountPaise},
        status = CASE WHEN paid_paise + ${p.amountPaise} = total_paise THEN 'PAID'::hms."InvoiceStatus" ELSE 'PARTIAL'::hms."InvoiceStatus" END
    WHERE id = ${invoiceId}::uuid AND status NOT IN ('VOID', 'REFUNDED') AND paid_paise + ${p.amountPaise} <= total_paise`;
  if (updated === 0) {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw httpError(404, "Invoice not found");
    if (inv.status === "VOID" || inv.status === "REFUNDED") throw httpError(409, `Invoice is ${inv.status.toLowerCase()}`);
    throw httpError(409, `Payment is more than the balance due (${inv.totalPaise - inv.paidPaise} paise)`);
  }
  await tx.payment.create({ data: { tenantId, invoiceId, amountPaise: p.amountPaise, method: p.method, reference: p.reference, receivedBy: p.receivedBy, externalId: p.externalId } });
}

/** Voids an unpaid invoice (used when a visit is cancelled). Returns false if money was already taken. */
export async function voidIfUnpaid(tx: TenantTx, where: { appointmentId: string }): Promise<boolean> {
  const inv = await tx.invoice.findFirst({ where: { appointmentId: where.appointmentId } });
  if (!inv || inv.status === "VOID") return true;
  if (inv.paidPaise > 0) return false;
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: new Date() } });
  return true;
}

/** Consultation invoice created at check-in. A card-covered visit shows the fee with a full discount. */
export async function consultationInvoice(
  tx: TenantTx,
  a: { id: string; tenantId: string; branchId: string; patientId: string; doctorId?: string | null; channel: "IN_PERSON" | "TELE" },
  opts: { tenantPrefix: string; branch: BranchRef; feeWaived: boolean; createdBy: string },
) {
  const existing = await tx.invoice.findFirst({ where: { appointmentId: a.id } });
  if (existing) return existing;
  const code = a.channel === "TELE" ? "CONSULT_TELE" : "CONSULT_IN_PERSON";
  const fee = await tx.feeItem.findUnique({ where: { tenantId_code: { tenantId: a.tenantId, code } } });
  // A doctor with their own fee overrides the hospital's default for the visit type.
  const doctor = a.doctorId ? await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId: a.tenantId, identityId: a.doctorId } } }) : null;
  const own = a.channel === "TELE" ? doctor?.feeTelePaise : doctor?.feeInPersonPaise;
  const price = own ?? fee?.pricePaise ?? 0;
  return createInvoice(tx, {
    tenantId: a.tenantId,
    tenantPrefix: opts.tenantPrefix,
    branch: opts.branch,
    patientId: a.patientId,
    appointmentId: a.id,
    source: "CONSULTATION",
    lines: [{ kind: "CONSULTATION", description: doctor ? `${fee?.name ?? "Consultation"}: ${doctor.displayName}` : fee?.name ?? "Consultation", quantity: 1, unitPaise: price }],
    discountPaise: opts.feeWaived ? price : 0,
    note: opts.feeWaived ? "Covered by health card" : undefined,
    createdBy: opts.createdBy,
  });
}

/** IST calendar day boundaries for a YYYY-MM-DD date. */
export const istDay = (date: string) => {
  const from = new Date(`${date}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
};

/**
 * Refunds money on an invoice. Atomic: the cap (never more than was paid and not yet refunded) is part of the update, so two
 * cashiers cannot refund the same money twice. A full refund of everything paid closes the invoice as REFUNDED.
 */
export async function refundInvoice(tx: TenantTx, o: { tenantId: string; invoiceId: string; amountPaise: number; method: Method; reason: string; by?: string }) {
  const rows = await tx.$executeRaw`UPDATE hms.invoices
    SET refunded_paise = refunded_paise + ${o.amountPaise},
        status = CASE WHEN refunded_paise + ${o.amountPaise} = paid_paise THEN 'REFUNDED'::hms."InvoiceStatus" ELSE status END
    WHERE id = ${o.invoiceId}::uuid AND status <> 'VOID' AND refunded_paise + ${o.amountPaise} <= paid_paise`;
  if (rows === 0) {
    const inv = await tx.invoice.findUnique({ where: { id: o.invoiceId } });
    if (!inv) throw httpError(404, "Invoice not found");
    throw httpError(409, `You can refund at most ${inv.paidPaise - inv.refundedPaise} paise on this invoice`);
  }
  await tx.refund.create({ data: { tenantId: o.tenantId, invoiceId: o.invoiceId, amountPaise: o.amountPaise, method: o.method, reason: o.reason, createdBy: o.by } });
}

/** Record a patient advance payment / deposit (e.g. for IPD or planned treatment). */
export async function createPatientAdvance(
  tx: TenantTx,
  adv: {
    tenantId: string;
    patientId: string;
    amountPaise: number;
    method: Method;
    reference?: string;
    notes?: string;
    receivedBy?: string;
  }
) {
  const year = new Date().getFullYear();
  const seq = await nextSeq(tx, adv.tenantId, `advance:${year}`);
  const receiptNo = `ADV-${year}-${String(seq).padStart(5, "0")}`;

  return tx.patientAdvance.create({
    data: {
      tenantId: adv.tenantId,
      receiptNo,
      patientId: adv.patientId,
      amountPaise: adv.amountPaise,
      balancePaise: adv.amountPaise,
      method: adv.method,
      reference: adv.reference,
      notes: adv.notes,
      receivedBy: adv.receivedBy,
    },
    include: {
      patient: { select: { id: true, fullName: true, patientNo: true, phone: true } },
    },
  });
}

/** Adjust unallocated patient advance balance against an invoice. */
export async function adjustPatientAdvance(
  tx: TenantTx,
  tenantId: string,
  invoiceId: string,
  patientId: string,
  amountPaise: number,
  receivedBy?: string
) {
  const advances = await tx.patientAdvance.findMany({
    where: { tenantId, patientId, balancePaise: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });

  const totalAvail = advances.reduce((s, a) => s + a.balancePaise, 0);
  if (totalAvail < amountPaise) {
    throw httpError(400, `Insufficient advance balance (available: ${totalAvail} paise, required: ${amountPaise} paise)`);
  }

  let remaining = amountPaise;
  const refs: string[] = [];
  for (const a of advances) {
    if (remaining <= 0) break;
    const deduct = Math.min(a.balancePaise, remaining);
    await tx.patientAdvance.update({
      where: { id: a.id },
      data: { balancePaise: a.balancePaise - deduct },
    });
    remaining -= deduct;
    refs.push(a.receiptNo);
  }

  await recordPayment(tx, tenantId, invoiceId, {
    amountPaise,
    method: "CASH",
    reference: `Adjusted from Advance: ${refs.join(", ")}`,
    receivedBy,
  });
}
