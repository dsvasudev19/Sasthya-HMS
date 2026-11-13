import type { TenantTx } from "@hms/db";
import { nextSeq } from "@hms/db";
import { httpError } from "./util";

const DAY = 24 * 3600_000;
/** Midnight at the start of an IST calendar date. */
export const istMidnight = (date: string) => new Date(`${date}T00:00:00+05:30`);
export const istDateOf = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export interface Slot { time: Date; available: boolean }

/**
 * Free and taken slots for a doctor at a branch on one IST date: the weekly schedule, minus leave, minus appointments already
 * booked (at any branch, since a doctor is in one place at a time), minus times that have passed.
 */
export async function doctorSlots(tx: TenantTx, tenantId: string, identityId: string, branchId: string, date: string, now = new Date()): Promise<Slot[]> {
  const profile = await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId, identityId } } });
  if (!profile || !profile.active) return [];
  const day = new Date(`${date}T00:00:00Z`);
  if (await tx.doctorLeave.findFirst({ where: { doctorId: profile.id, fromDate: { lte: day }, toDate: { gte: day } } })) return [];
  const schedules = await tx.doctorSchedule.findMany({ where: { doctorId: profile.id, branchId, weekday: weekdayOf(date) }, orderBy: { startMinute: "asc" } });
  const start = istMidnight(date);
  const booked = await tx.appointment.findMany({
    where: { doctorId: identityId, scheduledAt: { gte: start, lt: new Date(start.getTime() + DAY) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    select: { scheduledAt: true },
  });
  const taken = new Set(booked.map((b) => b.scheduledAt.getTime()));
  const out: Slot[] = [];
  for (const s of schedules) {
    for (let m = s.startMinute; m + profile.slotMinutes <= s.endMinute; m += profile.slotMinutes) {
      const time = new Date(start.getTime() + m * 60_000);
      out.push({ time, available: time > now && !taken.has(time.getTime()) });
    }
  }
  return out;
}

/**
 * Checks that a doctor can take an appointment at that time. Doctors with a profile must be booked into a free slot of their
 * schedule (staff with the override permission may book outside it); doctors without a profile are not checked. The check runs
 * under a lock per doctor and day, so two people booking the same slot at once cannot both succeed.
 */
export async function assertBookable(tx: TenantTx, o: { tenantId: string; doctorId?: string | null; branchId: string; scheduledAt: Date; canOverride: boolean }): Promise<void> {
  if (!o.doctorId) return;
  const profile = await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId: o.tenantId, identityId: o.doctorId } } });
  if (!profile) return;
  const date = istDateOf(o.scheduledAt);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${o.doctorId}:${date}`}, 0))`;
  const slots = await doctorSlots(tx, o.tenantId, o.doctorId, o.branchId, date);
  const slot = slots.find((s) => s.time.getTime() === o.scheduledAt.getTime());
  if (slot) {
    if (!slot.available) throw httpError(409, "That slot is already taken or has passed. Pick another time.");
    return;
  }
  if (!o.canOverride) throw httpError(409, `${profile.displayName} does not see patients at that time. Choose one of the available slots.`);
  const clash = await tx.appointment.findFirst({ where: { doctorId: o.doctorId, scheduledAt: o.scheduledAt, status: { notIn: ["CANCELLED", "NO_SHOW"] } } });
  if (clash) throw httpError(409, "The doctor already has an appointment at that time");
}

/** Daily token number: one counter per branch per IST day (the main branch keeps the original key). */
export async function nextToken(tx: TenantTx, tenantId: string, branchCode: string, at: Date): Promise<number> {
  const day = istDateOf(at);
  return nextSeq(tx, tenantId, branchCode === "MAIN" ? `token:${day}` : `token:${branchCode}:${day}`);
}
