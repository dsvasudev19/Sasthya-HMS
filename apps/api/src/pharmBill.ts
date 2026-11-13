import type { PrismaClient, TenantTx } from "@hms/db";
import type { PharmBill, PharmSeller } from "./pdf";
import { invoiceInclude } from "./billing";
import { taxBreakup, type Profile } from "./routes/billing";
import { httpError } from "./util";

/** Gathers everything a pharmacy bill prints: the batch and expiry each unit came from, HSN, MRP, the tax split, who sold it. */
export async function loadPharmBill(db: PrismaClient, tx: TenantTx, tenant: { id: string; name: string }, invoiceId: string, branchIds: string[], profile: Profile): Promise<{ bill: PharmBill; seller: PharmSeller } | null> {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, branchId: { in: branchIds } }, include: { ...invoiceInclude, branch: { select: { name: true, address: true, phone: true } } } });
  if (!inv) throw httpError(404, "Invoice not found");
  const sale = await tx.dispense.findFirst({ where: { invoiceId }, include: { lines: { include: { batch: { select: { batchNo: true, expiryDate: true } }, medicine: { select: { name: true, strength: true, hsnCode: true, manufacturer: true, gstPercent: true } } } } } });
  if (!sale) return null;
  const cashier = inv.createdBy ? (await db.identity.findUnique({ where: { id: inv.createdBy }, select: { fullName: true } }))?.fullName ?? null : null;
  const prescriber = /^Prescriber: (.+)$/.exec(inv.note ?? "")?.[1] ?? null;
  return {
    seller: { name: profile.legalName || tenant.name, branch: inv.branch.name, address: profile.address || inv.branch.address, phone: profile.phone || inv.branch.phone, gstin: profile.gstin, drugLicence: profile.drugLicence },
    bill: {
      invoiceNo: inv.invoiceNo, date: inv.createdAt, cashier, prescriber,
      customer: { name: inv.patient?.fullName ?? inv.customerName ?? "Walk-in customer", phone: inv.patient?.phone ?? inv.customerPhone, patientNo: inv.patient?.patientNo },
      lines: sale.lines.map((l) => ({ name: `${l.medicine.name}${l.medicine.strength ? ` ${l.medicine.strength}` : ""}`, maker: l.medicine.manufacturer, hsn: l.medicine.hsnCode, batchNo: l.batch.batchNo, expiry: l.batch.expiryDate, qty: l.qty, mrpPaise: l.unitPaise, gstPercent: l.medicine.gstPercent, amountPaise: l.amountPaise })),
      subtotalPaise: inv.subtotalPaise, discountPaise: inv.discountPaise, totalPaise: inv.totalPaise,
      tax: taxBreakup(inv), payments: inv.payments.map((p) => ({ method: p.method, amountPaise: p.amountPaise })), paidPaise: inv.paidPaise, refundedPaise: inv.refundedPaise, status: inv.status,
    },
  };
}
