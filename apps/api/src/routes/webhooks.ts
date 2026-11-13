import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PaymentGateway } from "@hms/billing-core";
import { withTenant, type PrismaClient } from "@hms/db";
import { recordPayment } from "../billing";
import { settlePlatformInvoice } from "../platformPay";

const uuid = z.string().uuid();

/** Payment gateway callbacks. The signature is checked against the exact bytes received, so JSON is parsed only afterwards. */
export default async function webhookRoutes(app: FastifyInstance, { db, gateway }: { db: PrismaClient; gateway: PaymentGateway | null }) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/razorpay", async (req, reply) => {
    if (!gateway) return reply.code(404).send({ error: "Not enabled" });
    const raw = req.body as string;
    if (!gateway.verifyWebhook(raw, req.headers["x-razorpay-signature"] as string | undefined)) return reply.code(401).send({ error: "Bad signature" });
    let event: { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: { kind?: string; tenantId?: string; invoiceId?: string; platformInvoiceId?: string } } }; payment?: { entity?: { id?: string; amount?: number; method?: string } } } };
    try { event = JSON.parse(raw); } catch { return reply.code(400).send({ error: "Bad JSON" }); }
    if (event.event !== "payment_link.paid") return { ignored: true };

    const link = event.payload?.payment_link?.entity;
    const pay = event.payload?.payment?.entity;
    // Swasthya's own subscription invoices share the endpoint; the link notes say which kind this is.
    if (link?.notes?.kind === "platform") {
      const id = uuid.safeParse(link.notes.platformInvoiceId);
      if (!id.success || !pay?.id) return { ignored: true };
      const inv = await db.platformInvoice.findUnique({ where: { id: id.data } });
      if (!inv || inv.gatewayRef !== link.id || (pay.amount ?? 0) < inv.totalPaise) return { ignored: true };
      return { outcome: (await settlePlatformInvoice(db, id.data, pay.id)).outcome };
    }
    const tenantId = uuid.safeParse(link?.notes?.tenantId);
    const invoiceId = uuid.safeParse(link?.notes?.invoiceId);
    if (!link?.id || !pay?.id || !pay.amount || !tenantId.success || !invoiceId.success) return { ignored: true };

    try {
      const outcome = await withTenant(db, tenantId.data, async (tx) => {
        const pl = await tx.paymentLink.findUnique({ where: { tenantId_gatewayRef: { tenantId: tenantId.data, gatewayRef: link.id! } } });
        if (!pl || pl.invoiceId !== invoiceId.data) return "unknown";
        if (await tx.payment.findUnique({ where: { tenantId_externalId: { tenantId: tenantId.data, externalId: pay.id! } } })) return "duplicate";
        const inv = await tx.invoice.findUnique({ where: { id: invoiceId.data } });
        if (!inv || pay.amount! > inv.totalPaise - inv.paidPaise || inv.status === "VOID" || inv.status === "REFUNDED") {
          // Money arrived that the invoice cannot absorb (paid twice, or voided meanwhile): keep it visible for a manual refund.
          await tx.auditLog.create({ data: { tenantId: tenantId.data, action: "payment.unmatched", entity: "invoice", entityId: invoiceId.data, meta: { gatewayPaymentId: pay.id, amountPaise: pay.amount } } });
          await tx.paymentLink.update({ where: { id: pl.id }, data: { status: "PAID" } });
          return "unmatched";
        }
        await recordPayment(tx, tenantId.data, invoiceId.data, { amountPaise: pay.amount!, method: pay.method === "card" ? "CARD" : "UPI", reference: pay.id, externalId: pay.id });
        await tx.paymentLink.update({ where: { id: pl.id }, data: { status: "PAID" } });
        return "recorded";
      });
      return { outcome };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return { outcome: "duplicate" }; // a simultaneous delivery won the race
      throw e;
    }
  });
}
