import type { FastifyInstance } from "fastify";
import type { PaymentGateway } from "@hms/billing-core";
import { PLANS, computePlatformInvoice, effectivePlan, monthOf, readOnlyReason, seatLimit } from "@hms/billing-core";
import { subscriptionPlanInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { tenantUsage } from "@hms/db/platform-billing";
import { clearTenantCache, featuresOf, tenantInfo } from "../gates";
import { staff, staffGuard } from "../guards";
import { platformInvoicePdf } from "../pdf";
import { httpError } from "../util";
import { z } from "zod";

export default async function accountRoutes(app: FastifyInstance, { db, gateway }: { db: PrismaClient; gateway: PaymentGateway | null }) {
  const idParam = z.object({ id: z.string().uuid() });
  // The hospital's own view of its plan, usage and Swasthya invoices.
  app.get("/subscription", { preHandler: staffGuard("team:manage") }, async (req) => {
    const tenantId = staff(req).tid;
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const eff = effectivePlan(t);
    const month = monthOf(new Date()).label;
    const usage = await tenantUsage(db, tenantId, month);
    const seatsUsed = new Set((await db.tenantMembership.findMany({ where: { tenantId } })).map((m) => m.identityId)).size;
    const invoices = await db.platformInvoice.findMany({ where: { tenantId }, orderBy: { periodStart: "desc" }, take: 12 });
    const plan = PLANS[t.planCode];
    return {
      plan: { code: plan.code, label: plan.label, monthlyPaise: plan.monthlyPaise, perPatientPaise: plan.perPatientPaise, seats: plan.seats, messageQuota: plan.messageQuota },
      status: t.status,
      trialEndsAt: t.trialEndsAt,
      trialDaysLeft: t.status === "TRIAL" && t.trialEndsAt ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null,
      effectivePlan: eff,
      features: featuresOf(await tenantInfo(db, tenantId)),
      readOnlyReason: readOnlyReason(t, t.suspendedReason),
      seats: { used: seatsUsed, limit: seatLimit(eff, (await tenantInfo(db, tenantId)).maxSeats) },
      usage: { month, ...usage, estimate: computePlatformInvoice({ plan: t.planCode, ...usage }) },
      invoices,
      onlinePayments: !!gateway,
      plans: Object.values(PLANS),
    };
  });

  app.post("/subscription/plan", { preHandler: staffGuard("subscription:manage") }, async (req) => {
    const { planCode } = subscriptionPlanInput.parse(req.body);
    const tenantId = staff(req).tid;
    const seatsUsed = new Set((await db.tenantMembership.findMany({ where: { tenantId } })).map((m) => m.identityId)).size;
    if (seatsUsed > PLANS[planCode].seats) throw httpError(409, `You have ${seatsUsed} staff accounts, more than the ${PLANS[planCode].label} plan allows (${PLANS[planCode].seats}). Remove some first.`);
    await withTenant(db, tenantId, (tx) => tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "plan.change", entity: "tenant", entityId: tenantId, meta: { planCode } } }));
    const t = await db.tenant.update({ where: { id: tenantId }, data: { planCode } });
    clearTenantCache(tenantId);
    void tenantInfo; // cache is rebuilt on the next request
    return { planCode: t.planCode };
  });

  // Pay a Swasthya invoice online: one Razorpay link per invoice, reused if the owner asks again.
  app.post("/subscription/invoices/:id/pay-link", { preHandler: staffGuard("subscription:manage") }, async (req) => {
    if (!gateway) throw httpError(503, "Online payment is not enabled yet. Ask Swasthya support for bank details.");
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const inv = await db.platformInvoice.findFirst({ where: { id, tenantId } });
    if (!inv) throw httpError(404, "Invoice not found");
    if (inv.status !== "DUE") throw httpError(409, "This invoice is not due");
    if (inv.paymentLinkUrl) return { url: inv.paymentLinkUrl };
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const link = await gateway.createPaymentLink({ amountPaise: inv.totalPaise, reference: inv.invoiceNo, description: `Swasthya subscription ${inv.invoiceNo}`, customerName: t.name, notes: { kind: "platform", platformInvoiceId: inv.id, tenantId } });
    await db.platformInvoice.update({ where: { id }, data: { gatewayRef: link.gatewayRef, paymentLinkUrl: link.url } });
    return { url: link.url };
  });

  app.get("/subscription/invoices/:id/pdf", { preHandler: staffGuard("team:manage") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const inv = await db.platformInvoice.findFirst({ where: { id, tenantId: staff(req).tid }, include: { tenant: { select: { name: true } } } });
    if (!inv) throw httpError(404, "Invoice not found");
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${inv.invoiceNo}.pdf"`).send(await platformInvoicePdf(inv, inv.tenant));
  });
}
