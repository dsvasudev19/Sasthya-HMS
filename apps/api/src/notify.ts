import { effectivePlan, hasFeature, type TenantPlanState } from "@hms/billing-core";
import { enqueue, fmtDate, fmtTime, getSettings } from "@hms/notifications";
import type { TenantTx } from "@hms/db";

/** Queues the booking confirmation (honours the hospital's setting). Call inside the booking transaction. */
export async function confirmAppointment(tx: TenantTx, tenant: { id: string; name: string } & TenantPlanState, a: { id: string; patientId: string; scheduledAt: Date; tokenNo: number | null }) {
  if (!hasFeature(effectivePlan(tenant), "messaging") || !(await getSettings(tx, tenant.id)).appointmentConfirmed) return;
  await enqueue(tx, {
    tenantId: tenant.id, patientId: a.patientId, template: "APPOINTMENT_CONFIRMED", dedupeKey: `appt-conf:${a.id}`,
    vars: (l) => ({ hospital: tenant.name, date: fmtDate(a.scheduledAt, l), time: fmtTime(a.scheduledAt, l), token: a.tokenNo ?? "" }),
  });
}

export async function reportReady(tx: TenantTx, tenant: { id: string; name: string } & TenantPlanState, o: { id: string; orderNo: string; patientId: string }) {
  if (!hasFeature(effectivePlan(tenant), "messaging") || !(await getSettings(tx, tenant.id)).reportReady) return;
  await enqueue(tx, { tenantId: tenant.id, patientId: o.patientId, template: "REPORT_READY", dedupeKey: `report:${o.id}`, vars: () => ({ hospital: tenant.name, orderNo: o.orderNo }) });
}
