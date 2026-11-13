import { GRACE_DAYS, INVOICE_DUE_DAYS, PLANS, computePlatformInvoice, monthOf } from "@hms/billing-core";
import { withTenant, type PrismaClient } from "./index";

/** Usage for one hospital over an IST calendar month, read through that hospital's own row-level security. */
export async function tenantUsage(db: PrismaClient, tenantId: string, label: string): Promise<{ patientsAdded: number; messagesSent: number }> {
  const [y, m] = label.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3600_000);
  const to = new Date(Date.UTC(y, m, 1) - 5.5 * 3600_000);
  return withTenant(db, tenantId, async (tx) => ({
    patientsAdded: await tx.patient.count({ where: { createdAt: { gte: from, lt: to } } }),
    messagesSent: await tx.message.count({ where: { status: "SENT", sentAt: { gte: from, lt: to } } }),
  }));
}

/**
 * Creates the invoices for a month (YYYY-MM). Safe to run again: one invoice per hospital per month.
 * Hospitals still inside their free trial for the whole month are skipped, as are months with nothing to charge.
 */
export async function generateInvoices(db: PrismaClient, label: string, now = new Date(), onlyTenants?: string[]): Promise<{ created: number }> {
  const { start, end } = monthOf(new Date(`${label}-15T00:00:00Z`));
  const monthEnd = new Date(end.getTime() + 24 * 3600_000 - 5.5 * 3600_000);
  const tenants = await db.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL", "SUSPENDED"] }, ...(onlyTenants ? { id: { in: onlyTenants } } : {}) } });
  let created = 0;
  for (const t of tenants) {
    if (t.trialEndsAt && t.trialEndsAt >= monthEnd) continue; // trial covers the whole month
    if (t.createdAt >= monthEnd) continue;
    const usage = await tenantUsage(db, t.id, label);
    const inv = computePlatformInvoice({ plan: t.planCode, ...usage });
    if (inv.totalPaise === 0) continue;
    const due = new Date(now.getTime() + INVOICE_DUE_DAYS * 86_400_000);
    const res = await db.platformInvoice.createMany({
      data: [{
        tenantId: t.id, invoiceNo: `SWA-${label.replace("-", "")}-${t.id.slice(-6).toUpperCase()}`, periodStart: start, periodEnd: end, planCode: t.planCode,
        lines: inv.lines.map((l) => ({ ...l })), subtotalPaise: inv.subtotalPaise, gstPaise: inv.gstPaise, totalPaise: inv.totalPaise, dueDate: new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())),
      }],
      skipDuplicates: true,
    });
    created += res.count;
  }
  return { created };
}

/** Trial expiry, suspension for unpaid invoices and reactivation once they are paid. */
export async function enforceBilling(db: PrismaClient, now = new Date(), onlyTenants?: string[]): Promise<{ trialsEnded: number; suspended: number; reactivated: number }> {
  const scope = onlyTenants ? { id: { in: onlyTenants } } : {};
  const trials = await db.tenant.updateMany({ where: { status: "TRIAL", trialEndsAt: { lte: now }, ...scope }, data: { status: "ACTIVE" } });

  const cutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000);
  const overdue = await db.platformInvoice.findMany({ where: { status: "DUE", dueDate: { lt: cutoff }, ...(onlyTenants ? { tenantId: { in: onlyTenants } } : {}) }, select: { tenantId: true } });
  const overdueIds = [...new Set(overdue.map((o) => o.tenantId))];
  const sus = overdueIds.length ? await db.tenant.updateMany({ where: { id: { in: overdueIds }, status: "ACTIVE" }, data: { status: "SUSPENDED", suspendedReason: "unpaid_invoice" } }) : { count: 0 };

  const suspended = await db.tenant.findMany({ where: { status: "SUSPENDED", suspendedReason: "unpaid_invoice", ...scope }, select: { id: true } });
  const free = suspended.filter((s) => !overdueIds.includes(s.id)).map((s) => s.id);
  const back = free.length ? await db.tenant.updateMany({ where: { id: { in: free } }, data: { status: "ACTIVE", suspendedReason: null } }) : { count: 0 };
  return { trialsEnded: trials.count, suspended: sus.count, reactivated: back.count };
}

export const planLabel = (code: keyof typeof PLANS) => PLANS[code].label;
