import { createHmac, timingSafeEqual } from "node:crypto";

export interface PaymentLinkRequest {
  amountPaise: number;
  /** Our own id for this charge (the invoice id), echoed back by the gateway. */
  reference: string;
  description: string;
  customerName?: string;
  /** E.164, e.g. +919876543210 */
  customerPhone?: string;
  notes: Record<string, string>;
}
export interface PaymentLink { gatewayRef: string; url: string }

export interface PaymentGateway {
  readonly name: string;
  createPaymentLink(r: PaymentLinkRequest): Promise<PaymentLink>;
  /** True when the signature header matches the raw request body. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

export class GatewayError extends Error {}

/**
 * Razorpay Payment Links (https://razorpay.com/docs/api/payments/payment-links/). Built from the documented API:
 * check it against your Razorpay sandbox before going live.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay";
  constructor(private keyId: string, private keySecret: string, private webhookSecret: string, private baseUrl = "https://api.razorpay.com") {}

  async createPaymentLink(r: PaymentLinkRequest): Promise<PaymentLink> {
    const res = await fetch(`${this.baseUrl}/v1/payment_links`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}` },
      body: JSON.stringify({
        amount: r.amountPaise, currency: "INR", accept_partial: false, reference_id: r.reference, description: r.description,
        customer: { name: r.customerName, contact: r.customerPhone }, notify: { sms: false, email: false }, reminder_enable: false, notes: r.notes,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => { throw new GatewayError(`gateway unreachable: ${e.message}`); });
    if (!res.ok) throw new GatewayError(`gateway answered ${res.status}`);
    const body = (await res.json()) as { id?: string; short_url?: string };
    if (!body.id || !body.short_url) throw new GatewayError("gateway returned no link");
    return { gatewayRef: body.id, url: body.short_url };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    return verifyHmac(rawBody, signature, this.webhookSecret);
  }
}

export function verifyHmac(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const signHmac = (rawBody: string, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

export function createGateway(env: Record<string, string | undefined> = process.env): PaymentGateway | null {
  const [id, secret, hook] = [env["RAZORPAY_KEY_ID"], env["RAZORPAY_KEY_SECRET"], env["RAZORPAY_WEBHOOK_SECRET"]];
  return id && secret && hook ? new RazorpayGateway(id, secret, hook) : null;
}

/** A UPI deep link / QR payload that works with any UPI app, no gateway needed. The cashier confirms the payment by reference. */
export function upiUri(o: { vpa: string; payeeName: string; amountPaise: number; note: string }): string {
  const q = new URLSearchParams({ pa: o.vpa, pn: o.payeeName, am: (o.amountPaise / 100).toFixed(2), cu: "INR", tn: o.note });
  return `upi://pay?${q.toString()}`;
}
