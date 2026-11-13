import { nextSeq, type TenantTx } from "@hms/db";
import { createInvoice, type BranchRef } from "./billing";
import { httpError } from "./util";

type Num = { toNumber(): number } | number | null | undefined;
const n = (v: Num) => (v === null || v === undefined ? null : typeof v === "number" ? v : v.toNumber());

export type Flag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH";

/** Compares a numeric result with the test's reference and critical limits. */
export function flagFor(value: number, t: { refLow: Num; refHigh: Num; critLow: Num; critHigh: Num }): Flag {
  const [cl, rl, rh, ch] = [n(t.critLow), n(t.refLow), n(t.refHigh), n(t.critHigh)];
  if (cl !== null && value <= cl) return "CRITICAL_LOW";
  if (ch !== null && value >= ch) return "CRITICAL_HIGH";
  if (rl !== null && value < rl) return "LOW";
  if (rh !== null && value > rh) return "HIGH";
  return "NORMAL";
}

export const rangeText = (t: { refLow: Num; refHigh: Num }) => {
  const [lo, hi] = [n(t.refLow), n(t.refHigh)];
  if (lo !== null && hi !== null) return `${lo} - ${hi}`;
  if (hi !== null) return `up to ${hi}`;
  if (lo !== null) return `from ${lo}`;
  return null;
};

export const orderInclude = {
  items: { orderBy: { testName: "asc" as const } },
  patient: { select: { id: true, fullName: true, patientNo: true, phone: true, dateOfBirth: true, gender: true } },
  invoice: { select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true } },
} as const;

/** Creates a lab order with its bill. The price of each test is copied onto the order. */
export async function createLabOrder(
  tx: TenantTx,
  o: { tenantId: string; prefix: string; branch: BranchRef; patientId: string; consultationId?: string; testIds: string[]; orderedBy?: string; payment?: { method: "CASH" | "UPI" | "CARD" } },
) {
  const ids = [...new Set(o.testIds)];
  const tests = await tx.labTest.findMany({ where: { id: { in: ids }, active: true } });
  if (tests.length !== ids.length) throw httpError(404, "One or more tests were not found");

  const year = new Date().getFullYear();
  const seq = await nextSeq(tx, o.tenantId, `lab:${year}`);
  const invoice = await createInvoice(tx, {
    tenantId: o.tenantId, tenantPrefix: o.prefix, branch: o.branch, patientId: o.patientId, source: "LAB", createdBy: o.orderedBy, payment: o.payment,
    lines: tests.map((t) => ({ kind: "LAB" as const, description: t.name, quantity: 1, unitPaise: t.pricePaise })),
  });
  const order = await tx.labOrder.create({
    data: { tenantId: o.tenantId, branchId: o.branch.id, orderNo: `LAB-${year}-${String(seq).padStart(5, "0")}`, patientId: o.patientId, consultationId: o.consultationId, invoiceId: invoice.id, orderedBy: o.orderedBy },
  });
  await tx.labOrderItem.createMany({
    data: tests.map((t) => ({ tenantId: o.tenantId, orderId: order.id, testId: t.id, testName: t.name, unit: t.unit, refRange: rangeText(t), pricePaise: t.pricePaise })),
  });
  return tx.labOrder.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
}
