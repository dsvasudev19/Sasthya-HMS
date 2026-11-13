import { effectivePlan, hasFeature } from "@hms/billing-core";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { ProviderError, toE164India, type MessageProvider } from "./provider";
import { fmtDate, fmtTime, OPT_OUT_APPLIES, render, type TemplateName } from "./templates";


export interface MessagingSettings {
  appointmentConfirmed: boolean;
  appointmentReminder: boolean;
  followUpReminder: boolean;
  cardExpiry: boolean;
  reportReady: boolean;
}
export const DEFAULT_SETTINGS: MessagingSettings = { appointmentConfirmed: true, appointmentReminder: true, followUpReminder: true, cardExpiry: true, reportReady: true };

export async function getSettings(tx: TenantTx, tenantId: string): Promise<MessagingSettings> {
  const row = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "messaging" } } });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<MessagingSettings> | undefined) ?? {}) };
}

export async function saveSettings(tx: TenantTx, tenantId: string, s: MessagingSettings): Promise<void> {
  await tx.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: "messaging" } }, update: { value: { ...s } }, create: { tenantId, key: "messaging", value: { ...s } } });
}

type Auto = Exclude<TemplateName, "MANUAL" | "OTP">;

/**
 * Queues a message in the caller's transaction. Returns false when nothing was queued: no phone number, the patient opted out
 * of reminders, or the same message (same dedupe key) is already queued. Never throws on duplicates.
 */
export async function enqueue(tx: TenantTx, o: { tenantId: string; patientId: string; template: Auto; vars: (language: string) => Record<string, string | number>; dedupeKey: string; sendAfter?: Date }): Promise<boolean> {
  const p = await tx.patient.findUnique({ where: { id: o.patientId } });
  if (!p?.phone) return false;
  if (OPT_OUT_APPLIES.includes(o.template) && p.reminderOptOut) return false;
  const name = p.fullName.split(" ")[0] ?? p.fullName;
  const body = render(o.template, p.language, { name, ...o.vars(p.language) });
  const res = await tx.message.createMany({
    data: [{ tenantId: o.tenantId, patientId: p.id, toPhone: p.phone, template: o.template, language: p.language, body, dedupeKey: o.dedupeKey, nextAttemptAt: o.sendAfter ?? new Date() }],
    skipDuplicates: true,
  });
  return res.count === 1;
}

export async function enqueueManual(tx: TenantTx, o: { tenantId: string; patientId: string; text: string }): Promise<boolean> {
  const p = await tx.patient.findUnique({ where: { id: o.patientId } });
  if (!p?.phone) return false;
  await tx.message.create({ data: { tenantId: o.tenantId, patientId: p.id, toPhone: p.phone, template: "MANUAL", language: p.language, body: o.text, dedupeKey: `manual:${crypto.randomUUID()}` } });
  return true;
}

// ───────────── scheduling ─────────────

const HOUR = 3600_000;
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);

/** Looks for reminders that are due across all active hospitals. Safe to run every minute: dedupe keys make it idempotent. */
export async function scheduleReminders(db: PrismaClient, now = new Date(), onlyTenants?: string[]): Promise<{ queued: number }> {
  const tenants = await db.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] }, ...(onlyTenants ? { id: { in: onlyTenants } } : {}) } });
  let queued = 0;
  for (const t of tenants) {
    if (!hasFeature(effectivePlan(t), "messaging")) continue;
    queued += await withTenant(db, t.id, async (tx) => {
      const s = await getSettings(tx, t.id);
      let n = 0;
      const count = (ok: boolean) => { if (ok) n++; };

      if (s.appointmentReminder) {
        const appts = await tx.appointment.findMany({ where: { status: "SCHEDULED", scheduledAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } } });
        for (const a of appts) {
          if (a.scheduledAt.getTime() - a.createdAt.getTime() <= 24 * HOUR) continue; // booked within a day: the confirmation is reminder enough
          count(await enqueue(tx, { tenantId: t.id, patientId: a.patientId, template: "APPOINTMENT_REMINDER", dedupeKey: `appt-r24:${a.id}`, vars: (l) => ({ hospital: t.name, date: fmtDate(a.scheduledAt, l), time: fmtTime(a.scheduledAt, l), token: a.tokenNo ?? "" }) }));
        }
      }
      if (s.followUpReminder) {
        const tomorrow = new Date(`${istDate(new Date(now.getTime() + 24 * HOUR))}T00:00:00Z`);
        const cons = await tx.consultation.findMany({ where: { followUpOn: tomorrow, completedAt: { not: null } } });
        for (const c of cons) {
          count(await enqueue(tx, { tenantId: t.id, patientId: c.patientId, template: "FOLLOWUP_REMINDER", dedupeKey: `followup:${c.id}`, vars: (l) => ({ hospital: t.name, date: fmtDate(tomorrow, l) }) }));
        }
      }
      if (s.cardExpiry) {
        const subs = await tx.cardSubscription.findMany({ where: { endsAt: { gt: now, lte: new Date(now.getTime() + 7 * 24 * HOUR) } }, include: { card: true } });
        for (const sub of subs) {
          if (await tx.cardSubscription.findFirst({ where: { cardId: sub.cardId, endsAt: { gt: sub.endsAt } } })) continue; // already renewed
          count(await enqueue(tx, { tenantId: t.id, patientId: sub.card.ownerPatientId, template: "CARD_EXPIRY", dedupeKey: `card7:${sub.id}`, vars: (l) => ({ hospital: t.name, cardNo: sub.card.cardNo, date: fmtDate(sub.endsAt, l) }) }));
        }
      }
      return n;
    });
  }
  return { queued };
}

// ───────────── delivery ─────────────

export const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const LEASE_MS = 2 * 60_000;

interface Claimed { id: string; to_phone: string; body: string; channel: "SMS" | "WHATSAPP"; attempts: number; template: string }

/**
 * Sends queued messages. Each message is leased first (its next attempt is pushed 2 minutes out) in a short transaction, so several
 * workers never send the same message, and no database transaction is held open during the network call.
 */
export async function deliverDue(db: PrismaClient, provider: MessageProvider, now = new Date(), batch = 50, onlyTenants?: string[]): Promise<{ sent: number; retried: number; failed: number }> {
  const out = { sent: 0, retried: 0, failed: 0 };
  const tenants = await db.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] }, ...(onlyTenants ? { id: { in: onlyTenants } } : {}) } });
  for (const t of tenants) {
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await withTenant(db, t.id, (tx) => tx.$queryRaw<Claimed[]>`
      UPDATE hms.messages SET next_attempt_at = ${lease}
      WHERE id IN (SELECT id FROM hms.messages WHERE status = 'QUEUED' AND next_attempt_at <= ${now} ORDER BY next_attempt_at LIMIT ${batch} FOR UPDATE SKIP LOCKED)
      RETURNING id, to_phone, body, channel, attempts, template`);
    for (const m of claimed) {
      try {
        const r = await provider.send({ to: toE164India(m.to_phone), body: m.body, channel: m.channel, template: m.template, reference: m.id });
        await withTenant(db, t.id, (tx) => tx.message.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date(), attempts: m.attempts + 1, providerRef: r.providerRef, error: null } }));
        out.sent++;
      } catch (e) {
        const retryable = e instanceof ProviderError ? e.retryable : true;
        const attempts = m.attempts + 1;
        const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
        await withTenant(db, t.id, (tx) => tx.message.update({
          where: { id: m.id },
          data: { attempts, error: (e as Error).message.slice(0, 300), status: giveUp ? "FAILED" : "QUEUED", nextAttemptAt: new Date(now.getTime() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS.at(-1)!)) },
        }));
        giveUp ? out.failed++ : out.retried++;
      }
    }
  }
  return out;
}
