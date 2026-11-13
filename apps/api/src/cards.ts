import { randomInt } from "node:crypto";
import type { TenantTx } from "@hms/db";

type Channel = "IN_PERSON" | "TELE";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no look-alike characters

/** e.g. SRH-HC-7K3F9Q. Random, so no counter race; the unique key still guards against a collision. */
export function newCardNo(prefix: string): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return `${prefix}-HC-${s}`;
}

export const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
};

export interface Coverage {
  cardId: string;
  cardNo: string;
  planName: string;
  subscriptionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Remaining covered visits for this patient in the running period. */
  remaining: { inPerson: number; tele: number };
  limits: { inPerson: number; tele: number };
}

/** Coverage of one patient at a moment in time, or null when the patient has no card. */
export async function coverageFor(tx: TenantTx, tenantId: string, patientId: string, at = new Date()): Promise<Coverage | null> {
  const member = await tx.healthCardMember.findUnique({ where: { tenantId_patientId: { tenantId, patientId } }, include: { card: { include: { plan: true } } } });
  if (!member || member.card.status !== "ACTIVE") return null;
  const sub = await tx.cardSubscription.findFirst({
    where: { cardId: member.cardId, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { endsAt: "desc" },
  });
  const base = { cardId: member.cardId, cardNo: member.card.cardNo, planName: member.card.plan.name };
  if (!sub) return { ...base, subscriptionId: null, startsAt: null, endsAt: null, remaining: { inPerson: 0, tele: 0 }, limits: { inPerson: 0, tele: 0 } };
  const used = await tx.benefitUsage.groupBy({ by: ["channel"], where: { subscriptionId: sub.id, patientId }, _count: { _all: true } });
  const count = (c: Channel) => used.find((u) => u.channel === c)?._count._all ?? 0;
  return {
    ...base,
    subscriptionId: sub.id,
    startsAt: sub.startsAt,
    endsAt: sub.endsAt,
    remaining: { inPerson: Math.max(0, sub.inPersonLimit - count("IN_PERSON")), tele: Math.max(0, sub.teleLimit - count("TELE")) },
    limits: { inPerson: sub.inPersonLimit, tele: sub.teleLimit },
  };
}

export const canCover = (c: Coverage | null, channel: Channel) => !!c?.subscriptionId && (channel === "TELE" ? c.remaining.tele : c.remaining.inPerson) > 0;

/** Applies card coverage to a visit when the patient checks in. Returns true when the fee was waived. */
export async function applyCoverage(tx: TenantTx, appt: { id: string; tenantId: string; patientId: string; channel: Channel }): Promise<boolean> {
  const cov = await coverageFor(tx, appt.tenantId, appt.patientId);
  if (!cov || !canCover(cov, appt.channel)) return false;
  await tx.benefitUsage.create({
    data: { tenantId: appt.tenantId, subscriptionId: cov.subscriptionId!, patientId: appt.patientId, appointmentId: appt.id, channel: appt.channel },
  });
  return true;
}

export async function releaseCoverage(tx: TenantTx, appointmentId: string): Promise<void> {
  await tx.benefitUsage.deleteMany({ where: { appointmentId } });
}
