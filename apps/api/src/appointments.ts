import type { TenantTx } from "@hms/db";
import { consultationInvoice } from "./billing";
import { applyCoverage } from "./cards";

/**
 * Checks a patient in: applies their health card if it covers the visit, and raises the consultation bill. One place, so the
 * reception screen, the scanner and the mobile app all do exactly the same thing.
 */
export async function checkIn(tx: TenantTx, appt: { id: string; tenantId: string; branchId: string; patientId: string; doctorId: string | null; channel: "IN_PERSON" | "TELE"; feeWaived: boolean }, o: { tenantPrefix: string; branch: { id: string; code: string }; createdBy: string }) {
  const feeWaived = await applyCoverage(tx, appt as never);
  await consultationInvoice(tx, appt as never, { tenantPrefix: o.tenantPrefix, branch: o.branch, feeWaived, createdBy: o.createdBy });
  return tx.appointment.update({ where: { id: appt.id }, data: { status: "CHECKED_IN", feeWaived }, include: { invoice: { select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true } }, patient: true, doctor: { select: { id: true, fullName: true } } } });
}
