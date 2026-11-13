import { randomUUID } from "node:crypto";

export interface OutgoingMessage {
  to: string; // E.164, e.g. +919876543210
  body: string;
  channel: "SMS" | "WHATSAPP";
  template: string;
  /** Our message id, so the provider can echo it back in delivery receipts. */
  reference: string;
}

export class ProviderError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export interface MessageProvider {
  readonly name: string;
  /** Resolves with the provider's message id; throws ProviderError (retryable or not). */
  send(m: OutgoingMessage): Promise<{ providerRef: string }>;
}

/** Development provider: prints the message and remembers it. Never use in production. */
export class ConsoleProvider implements MessageProvider {
  readonly name = "console";
  readonly sent: OutgoingMessage[] = [];
  async send(m: OutgoingMessage) {
    this.sent.push(m);
    if (process.env["NODE_ENV"] !== "test") console.log(`[sms:${m.channel}] to ${m.to}: ${m.body}`);
    return { providerRef: `console-${randomUUID()}` };
  }
}

/**
 * Posts every message as JSON to a gateway you control (an adapter for MSG91, Gupshup, Twilio and so on, which hold the DLT
 * template ids and credentials). A 429 or 5xx is retried later; any other error fails the message.
 */
export class WebhookProvider implements MessageProvider {
  readonly name = "webhook";
  constructor(private url: string, private token: string, private timeoutMs = 10_000) {}
  async send(m: OutgoingMessage) {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify(m),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ProviderError(`gateway unreachable: ${(e as Error).message}`, true);
    }
    if (!res.ok) throw new ProviderError(`gateway answered ${res.status}`, res.status === 429 || res.status >= 500);
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerRef: body.id ?? `webhook-${randomUUID()}` };
  }
}

export function createProvider(env: Record<string, string | undefined> = process.env): MessageProvider {
  const kind = env["MESSAGING_PROVIDER"] ?? "console";
  if (kind === "webhook") {
    const url = env["MESSAGING_WEBHOOK_URL"];
    const token = env["MESSAGING_WEBHOOK_TOKEN"];
    if (!url || !token) throw new Error("MESSAGING_WEBHOOK_URL and MESSAGING_WEBHOOK_TOKEN are required for the webhook provider");
    return new WebhookProvider(url, token);
  }
  if (env["NODE_ENV"] === "production") throw new Error("MESSAGING_PROVIDER=webhook is required in production (the console provider sends nothing)");
  return new ConsoleProvider();
}

/** Indian mobile numbers are stored as 10 digits; providers want +91. */
export const toE164India = (phone: string) => `+91${phone.replace(/\D/g, "").slice(-10)}`;
