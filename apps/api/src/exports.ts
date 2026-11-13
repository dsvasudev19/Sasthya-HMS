import { withTenant, type PrismaClient } from "@hms/db";
import { istDay } from "./billing";
import { doctorStatement } from "./payouts";

export const REPORTS = ["COLLECTIONS", "GST_REGISTER", "DOCTOR_SHARE", "RECEIVABLES", "CLAIMS"] as const;
export type ReportName = (typeof REPORTS)[number];
export const REPORT_LABEL: Record<ReportName, string> = { COLLECTIONS: "Collections", GST_REGISTER: "GST sales register", DOCTOR_SHARE: "Doctor revenue share", RECEIVABLES: "Unpaid bills", CLAIMS: "Insurance claims" };

type Cell = string | number | null;
const DAY = 86_400_000;
const rs = (p: number) => (p / 100).toFixed(2);
const d = (x: Date | null) => (x ? new Date(x.getTime() + 19_800_000).toISOString().slice(0, 10) : "");
export const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

/** Quotes a cell so a name with a comma, or one that starts like a formula, cannot break or hijack a spreadsheet. */
const cell = (v: Cell) => {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: Cell[][]) => `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;

/** Builds one report for a range of days, limited to the branches the caller may see. */
export async function buildReport(db: PrismaClient, tenantId: string, report: ReportName, from: string, to: string, branchIds?: string[]): Promise<{ header: string[]; rows: Cell[][] }> {
  const A = istDay(from).from, Z = istDay(to).to;
  const scope = branchIds ? { branchId: { in: branchIds } } : {};
  return withTenant(db, tenantId, async (tx) => {
    switch (report) {
      case "COLLECTIONS": {
        const p = await tx.payment.findMany({ where: { receivedAt: { gte: A, lt: Z }, invoice: scope }, include: { invoice: { select: { invoiceNo: true, source: true, customerName: true, patient: { select: { fullName: true, patientNo: true } }, branch: { select: { code: true } } } } }, orderBy: { receivedAt: "asc" } });
        return { header: ["Date", "Branch", "Invoice", "Patient no", "Patient", "Source", "Method", "Reference", "Amount (Rs)"], rows: p.map((x) => [d(x.receivedAt), x.invoice.branch.code, x.invoice.invoiceNo, x.invoice.patient?.patientNo ?? "", x.invoice.patient?.fullName ?? x.invoice.customerName ?? "Walk-in", x.invoice.source, x.method, x.reference ?? "", rs(x.amountPaise)]) };
      }
      case "GST_REGISTER": {
        const i = await tx.invoice.findMany({ where: { ...scope, createdAt: { gte: A, lt: Z } }, include: { patient: { select: { fullName: true } }, branch: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
        return { header: ["Date", "Branch", "Invoice", "Customer", "Source", "Status", "Taxable value (Rs)", "GST (Rs)", "Total (Rs)"], rows: i.map((x) => [d(x.createdAt), x.branch.code, x.invoiceNo, x.patient?.fullName ?? x.customerName ?? "Walk-in", x.source, x.status, rs(x.status === "VOID" ? 0 : x.totalPaise - x.taxPaise), rs(x.status === "VOID" ? 0 : x.taxPaise), rs(x.status === "VOID" ? 0 : x.totalPaise)]) };
      }
      case "RECEIVABLES": {
        const i = await tx.invoice.findMany({ where: { ...scope, status: { in: ["UNPAID", "PARTIAL"] } }, include: { patient: { select: { fullName: true, phone: true } } }, orderBy: { createdAt: "asc" } });
        return { header: ["Invoice", "Date", "Customer", "Phone", "Source", "Total (Rs)", "Paid (Rs)", "Due (Rs)", "Age (days)", "Bucket"], rows: i.map((x) => { const age = Math.floor((Date.now() - x.createdAt.getTime()) / DAY); return [x.invoiceNo, d(x.createdAt), x.patient?.fullName ?? x.customerName ?? "Walk-in", x.patient?.phone ?? x.customerPhone ?? "", x.source, rs(x.totalPaise), rs(x.paidPaise), rs(x.totalPaise - x.paidPaise), age, age <= 7 ? "0-7" : age <= 30 ? "8-30" : "30+"]; }) };
      }
      case "CLAIMS": {
        const c = await tx.claim.findMany({ where: { ...scope, createdAt: { gte: A, lt: Z } }, include: { patient: { select: { fullName: true } }, payer: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
        return { header: ["Claim", "Opened", "Patient", "Payer", "Kind", "Status", "Billed (Rs)", "Approved (Rs)", "Settled (Rs)", "Outstanding (Rs)", "Disallowed (Rs)", "Submitted"], rows: c.map((x) => [x.claimNo, d(x.createdAt), x.patient.fullName, x.payer.name, x.kind, x.status, rs(x.billedPaise), rs(x.approvedPaise), rs(x.settledPaise), rs(Math.max(0, x.approvedPaise - x.settledPaise)), rs(x.disallowedPaise), d(x.submittedAt)]) };
      }
      case "DOCTOR_SHARE": {
        const rows: Cell[][] = [];
        for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7)) {
          for (const s of await doctorStatement(db, tenantId, m)) for (const l of s.lines) rows.push([m, s.doctor ?? "Doctor", l.source, l.bills, rs(l.receivedPaise), rs(l.refundedPaise), rs(l.netPaise), l.percent, rs(l.sharePaise)]);
        }
        return { header: ["Month", "Doctor", "Source", "Bills", "Received (Rs)", "Refunded (Rs)", "Net (Rs)", "Share %", "Share (Rs)"], rows };
      }
    }
  });
}

/** Where a schedule's reporting window falls: yesterday, last week (Mon to Sun) or last month. */
export function windowFor(frequency: string, now = new Date()): { from: string; to: string; key: string } {
  const today = new Date(now.getTime() + 19_800_000).toISOString().slice(0, 10);
  if (frequency === "DAILY") return { from: addDays(today, -1), to: addDays(today, -1), key: today };
  if (frequency === "WEEKLY") { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; const monday = addDays(today, -dow); return { from: addDays(monday, -7), to: addDays(monday, -1), key: monday }; }
  const first = `${today.slice(0, 7)}-01`; const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  return { from: prev, to: addDays(first, -1), key: first };
}

/** Produces every report that is due. Safe to run often: a schedule runs once per period. */
export async function runDueSchedules(db: PrismaClient, now = new Date(), onlyTenants?: string[]): Promise<number> {
  const tenants = await db.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] }, ...(onlyTenants ? { id: { in: onlyTenants } } : {}) }, select: { id: true } });
  let made = 0;
  for (const t of tenants) {
    const due = await withTenant(db, t.id, (tx) => tx.reportSchedule.findMany({ where: { active: true } }));
    for (const s of due) {
      const w = windowFor(s.frequency, now);
      if (s.lastRunAt && new Date(s.lastRunAt.getTime() + 19_800_000).toISOString().slice(0, 10) >= w.key) continue;
      const r = await buildReport(db, t.id, s.report as ReportName, w.from, w.to);
      await withTenant(db, t.id, async (tx) => {
        await tx.reportRun.create({ data: { tenantId: t.id, scheduleId: s.id, report: s.report, fromDate: new Date(w.from), toDate: new Date(w.to), rows: r.rows.length, csv: toCsv(r.header, r.rows) } });
        await tx.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now } });
      });
      made++;
    }
  }
  return made;
}
