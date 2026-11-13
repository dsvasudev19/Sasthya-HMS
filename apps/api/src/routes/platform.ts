import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLANS, monthOf } from "@hms/billing-core";
import { enforceInput, generateInvoicesInput, payPlatformInvoiceInput, platformTenantPatch } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { enforceBilling, generateInvoices, tenantUsage } from "@hms/db/platform-billing";
import { clearTenantCache } from "../gates";
import { platformGuard } from "../guards";
import { platformInvoicePdf } from "../pdf";
import { settlePlatformInvoice } from "../platformPay";
import { httpError } from "../util";
import { operatorAudit } from "./platformOps";

const idParam = z.object({ id: z.string().uuid() });

/** Operator screens: every call is limited to Swasthya's own staff (platform tokens). */
export default async function platformRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", platformGuard);

  const patientCount = (tenantId: string) => withTenant(db, tenantId, (tx) => tx.patient.count());

  app.get("/platform/overview", async () => {
    const tenants = await db.tenant.findMany();
    const month = monthOf(new Date()).label;
    const by = (s: string) => tenants.filter((t) => t.status === s).length;
    const paying = tenants.filter((t) => t.status === "ACTIVE");
    const mrr = paying.reduce((s, t) => s + PLANS[t.planCode].monthlyPaise, 0);
    const [patients, usage] = await Promise.all([
      Promise.all(tenants.map((t) => patientCount(t.id))).then((a) => a.reduce((x, y) => x + y, 0)),
      Promise.all(tenants.map((t) => tenantUsage(db, t.id, month))),
    ]);
    const due = await db.platformInvoice.findMany({ where: { status: "DUE" } });
    const today = new Date();
    return {
      tenants: { total: tenants.length, trial: by("TRIAL"), active: by("ACTIVE"), suspended: by("SUSPENDED"), closed: by("CLOSED") },
      byPlan: { PAY_PER_PATIENT: paying.filter((t) => t.planCode === "PAY_PER_PATIENT").length, STARTER: paying.filter((t) => t.planCode === "STARTER").length, UNLIMITED: paying.filter((t) => t.planCode === "UNLIMITED").length },
      mrrPaise: mrr,
      patients,
      month,
      patientsAddedThisMonth: usage.reduce((s, u) => s + u.patientsAdded, 0),
      messagesThisMonth: usage.reduce((s, u) => s + u.messagesSent, 0),
      outstanding: { count: due.length, paise: due.reduce((s, i) => s + i.totalPaise, 0), overdue: due.filter((i) => i.dueDate < today).length },
      trialsEndingSoon: tenants.filter((t) => t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt.getTime() - today.getTime() < 7 * 86_400_000).map((t) => ({ id: t.id, name: t.name, trialEndsAt: t.trialEndsAt })),
    };
  });

  app.get("/platform/tenants", async (req) => {
    const { q, status } = z.object({ q: z.string().trim().max(60).optional(), status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"]).optional() }).parse(req.query);
    const tenants = await db.tenant.findMany({
      where: { ...(status ? { status } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
      include: { memberships: { select: { identityId: true } }, platformInvoices: { orderBy: { periodStart: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return Promise.all(tenants.map(async (t) => ({
      id: t.id, name: t.name, slug: t.slug, kind: t.kind, status: t.status, planCode: t.planCode, trialEndsAt: t.trialEndsAt, createdAt: t.createdAt, suspendedReason: t.suspendedReason,
      staff: new Set(t.memberships.map((m) => m.identityId)).size, patients: await patientCount(t.id), lastInvoice: t.platformInvoices[0] ? { status: t.platformInvoices[0].status, totalPaise: t.platformInvoices[0].totalPaise, dueDate: t.platformInvoices[0].dueDate } : null,
    })));
  });

  app.get("/platform/tenants/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const t = await db.tenant.findUnique({ where: { id }, include: { platformInvoices: { orderBy: { periodStart: "desc" }, take: 24 }, memberships: { include: { identity: true } } } });
    if (!t) throw httpError(404, "Hospital not found");
    const month = monthOf(new Date()).label;
    return { ...t, patients: await patientCount(id), usage: { month, ...(await tenantUsage(db, id, month)) }, memberships: t.memberships.map((m) => ({ id: m.id, role: m.role, name: m.identity.fullName, phone: m.identity.phone })) };
  });

  app.patch("/platform/tenants/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { extendTrialDays, suspendedReason, ...rest } = platformTenantPatch.parse(req.body);
    const t = await db.tenant.findUnique({ where: { id } });
    if (!t) throw httpError(404, "Hospital not found");
    const data: Record<string, unknown> = { ...rest };
    if (extendTrialDays) {
      const from = t.trialEndsAt && t.trialEndsAt > new Date() ? t.trialEndsAt : new Date();
      data["trialEndsAt"] = new Date(from.getTime() + extendTrialDays * 86_400_000);
      if (t.status !== "SUSPENDED" && t.status !== "CLOSED") data["status"] = "TRIAL";
    }
    if (rest.status === "SUSPENDED") data["suspendedReason"] = suspendedReason ?? "operator";
    if (rest.status && rest.status !== "SUSPENDED") data["suspendedReason"] = null;
    const updated = await db.tenant.update({ where: { id }, data });
    clearTenantCache(id);
    await operatorAudit(db, req, "tenant.update", { tenantId: id, type: "tenant", id, meta: { before: { status: t.status, plan: t.planCode, trialEndsAt: t.trialEndsAt }, after: { status: updated.status, plan: updated.planCode, trialEndsAt: updated.trialEndsAt }, extendTrialDays: extendTrialDays ?? null, reason: suspendedReason ?? null } });
    return updated;
  });

  // ── Swasthya's invoices to hospitals ──
  app.get("/platform/invoices", async (req) => {
    const { status } = z.object({ status: z.enum(["DUE", "PAID", "VOID"]).optional() }).parse(req.query);
    return db.platformInvoice.findMany({ where: status ? { status } : {}, include: { tenant: { select: { id: true, name: true } } }, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 200 });
  });

  app.post("/platform/invoices/generate", async (req) => {
    const { month, tenantIds } = generateInvoicesInput.parse(req.body);
    const r = await generateInvoices(db, month, new Date(), tenantIds);
    await operatorAudit(db, req, "invoices.generate", { meta: { month, hospitals: tenantIds?.length ?? "all" } });
    return r;
  });

  app.post("/platform/enforce", async (req) => {
    const { tenantIds } = enforceInput.parse(req.body ?? {});
    const r = await enforceBilling(db, new Date(), tenantIds);
    clearTenantCache();
    await operatorAudit(db, req, "billing.enforce", { meta: { hospitals: tenantIds?.length ?? "all" } });
    return r;
  });

  app.post("/platform/invoices/:id/pay", async (req) => {
    const { id } = idParam.parse(req.params);
    const { paymentRef } = payPlatformInvoiceInput.parse(req.body);
    if (!(await db.platformInvoice.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, "Invoice not found");
    const r = await settlePlatformInvoice(db, id, paymentRef);
    if (r.outcome === "already") throw httpError(409, "Invoice is not due");
    await operatorAudit(db, req, "invoice.mark_paid", { type: "platform_invoice", id, meta: { paymentRef } });
    return { paid: true, ...r };
  });

  app.get("/platform/invoices/:id/pdf", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const inv = await db.platformInvoice.findUnique({ where: { id }, include: { tenant: { select: { name: true } } } });
    if (!inv) throw httpError(404, "Invoice not found");
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${inv.invoiceNo}.pdf"`).send(await platformInvoicePdf(inv, inv.tenant));
  });

  app.post("/platform/invoices/:id/void", async (req) => {
    const { id } = idParam.parse(req.params);
    const inv = await db.platformInvoice.findUnique({ where: { id } });
    const done = await db.platformInvoice.updateMany({ where: { id, status: "DUE" }, data: { status: "VOID" } });
    if (done.count === 0 || !inv) throw httpError(409, "Only due invoices can be voided");
    await enforceBilling(db, new Date(), [inv.tenantId]);
    clearTenantCache();
    await operatorAudit(db, req, "invoice.void", { tenantId: inv.tenantId, type: "platform_invoice", id });
    return { voided: true };
  });
}
