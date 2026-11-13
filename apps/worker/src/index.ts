import { monthOf } from "@hms/billing-core";
import { createDb } from "@hms/db";
import { enforceBilling, generateInvoices } from "@hms/db/platform-billing";
import { createProvider, deliverDue, scheduleReminders } from "@hms/notifications";

// Background worker: queues due reminders and delivers the outbox. Both steps are idempotent, so several workers can run safely.
const db = createDb();
const provider = createProvider();
const EVERY_MS = Number(process.env["WORKER_INTERVAL_MS"] ?? 60_000);
let running = false;
let lastBilling = 0;
const BILLING_EVERY_MS = 60 * 60_000;

async function tick() {
  if (running) return;
  running = true;
  try {
    const { queued } = await scheduleReminders(db);
    const r = await deliverDue(db, provider);
    if (queued || r.sent || r.retried || r.failed) console.log(`[worker] queued ${queued}, sent ${r.sent}, retried ${r.retried}, failed ${r.failed}`);

    // Hourly: bill last month (idempotent), end trials, suspend hospitals with overdue invoices and reactivate paid ones.
    if (Date.now() - lastBilling > BILLING_EVERY_MS) {
      lastBilling = Date.now();
      const prev = monthOf(new Date(Date.now() - 20 * 86_400_000)).label; // a date safely inside the previous month on any day
      const month = monthOf(new Date()).label;
      const inv = month === prev ? { created: 0 } : await generateInvoices(db, prev);
      const b = await enforceBilling(db);
      if (inv.created || b.trialsEnded || b.suspended || b.reactivated) console.log(`[worker] billing: ${inv.created} invoices, ${b.trialsEnded} trials ended, ${b.suspended} suspended, ${b.reactivated} reactivated`);
    }
  } catch (e) {
    console.error("[worker] tick failed", e);
  } finally {
    running = false;
  }
}

console.log(`[worker] started with provider "${provider.name}", every ${EVERY_MS / 1000}s`);
await tick();
const timer = setInterval(tick, EVERY_MS);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => { clearInterval(timer); await db.$disconnect(); process.exit(0); });
