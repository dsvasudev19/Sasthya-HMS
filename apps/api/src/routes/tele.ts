import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { effectivePlan, hasFeature } from "@hms/billing-core";
import { enqueue } from "@hms/notifications";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { joinWindow, newRoom, teleJoinUrl } from "../tele";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });

/** Finds or creates the room for a tele appointment. Safe against two people opening it at the same moment. */
export async function ensureTeleSession(tx: TenantTx, tenantId: string, appointmentId: string) {
  const found = await tx.teleSession.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId } } });
  if (found) return found;
  const made = await tx.teleSession.createMany({ data: [{ tenantId, appointmentId, room: newRoom() }], skipDuplicates: true });
  void made;
  return tx.teleSession.findUniqueOrThrow({ where: { tenantId_appointmentId: { tenantId, appointmentId } } });
}

export default async function teleRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "tele"));
  const loadTele = async (tx: TenantTx, id: string, branchIds: string[]) => {
    const a = await tx.appointment.findFirst({ where: { id, branchId: { in: branchIds } }, include: { patient: { select: { id: true, fullName: true } }, doctor: { select: { id: true, fullName: true } } } });
    if (!a) throw httpError(404, "Appointment not found");
    if (a.channel !== "TELE") throw httpError(409, "This is not a video appointment");
    if (["CANCELLED", "NO_SHOW", "COMPLETED"].includes(a.status)) throw httpError(409, `This appointment is ${a.status.toLowerCase().replace("_", " ")}`);
    return a;
  };

  // The doctor opens the room: marks them present, lets the patient in, and nudges the patient by SMS once.
  app.post("/appointments/:id/tele/start", { preHandler: staffGuard("tele:conduct") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const me = await db.identity.findUniqueOrThrow({ where: { id: staff(req).sub } });
    return withTenant(db, tenantId, async (tx) => {
      const a = await loadTele(tx, id, req.access!.branchIds);
      const w = joinWindow(a.scheduledAt);
      const now = new Date();
      if (now < w.from) throw httpError(409, "Too early. The room opens 15 minutes before the appointment.");
      let s = await ensureTeleSession(tx, tenantId, id);
      s = await tx.teleSession.update({ where: { id: s.id }, data: { doctorJoinedAt: s.doctorJoinedAt ?? now, startedAt: s.startedAt ?? now, status: "LIVE", endedAt: null } });
      if (a.status === "SCHEDULED") await tx.appointment.update({ where: { id }, data: { status: "CHECKED_IN" } });
      if (hasFeature(effectivePlan(tenant), "messaging")) {
        await enqueue(tx, { tenantId, patientId: a.patientId, template: "TELE_READY", dedupeKey: `tele-ready:${s.id}`, vars: () => ({ hospital: tenant.name, doctor: (a.doctor?.fullName ?? me.fullName ?? "the doctor").replace(/^Dr\.?\s+/i, "") }) });
      }
      return { sessionId: s.id, status: s.status, url: teleJoinUrl({ room: s.room, name: `Dr ${(me.fullName ?? "Doctor").replace(/^Dr\.?\s+/i, "")}`, moderator: true }), patientWaiting: !!s.patientJoinedAt };
    });
  });

  app.get("/appointments/:id/tele", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, branchId: { in: req.access!.branchIds } }, select: { id: true, channel: true, scheduledAt: true } });
      if (!a) throw httpError(404, "Appointment not found");
      const s = await tx.teleSession.findUnique({ where: { tenantId_appointmentId: { tenantId: staff(req).tid, appointmentId: id } }, select: { status: true, patientJoinedAt: true, doctorJoinedAt: true, startedAt: true, endedAt: true } });
      return { channel: a.channel, window: joinWindow(a.scheduledAt), session: s };
    });
  });

  app.post("/appointments/:id/tele/end", { preHandler: staffGuard("tele:conduct") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, branchId: { in: req.access!.branchIds }, channel: "TELE" } });
      if (!a) throw httpError(404, "Appointment not found");
      const s = await tx.teleSession.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: id } } });
      if (!s || s.status !== "LIVE") throw httpError(409, "The call is not live");
      const u = await tx.teleSession.update({ where: { id: s.id }, data: { status: "ENDED", endedAt: new Date() } });
      return { status: u.status, endedAt: u.endedAt, minutes: Math.max(1, Math.round((u.endedAt!.getTime() - (u.startedAt ?? u.endedAt!).getTime()) / 60_000)) };
    });
  });

  // The tele-consultation desk: today and the next week, with who is waiting.
  app.get("/tele/schedule", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const from = new Date(Date.now() - 3 * 3600_000);
    const to = new Date(Date.now() + 7 * 86_400_000);
    return withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.appointment.findMany({
        where: { channel: "TELE", branchId: { in: req.access!.branchIds }, scheduledAt: { gte: from, lte: to }, status: { in: ["SCHEDULED", "CHECKED_IN", "IN_PROGRESS"] } },
        include: { patient: { select: { id: true, fullName: true, patientNo: true, phone: true } }, doctor: { select: { id: true, fullName: true } }, tele: { select: { status: true, patientJoinedAt: true, doctorJoinedAt: true } } },
        orderBy: { scheduledAt: "asc" }, take: 100,
      });
      const now = Date.now();
      return rows.map((a) => { const w = joinWindow(a.scheduledAt); return { ...a, canJoin: now >= w.from.getTime() && now <= w.to.getTime() }; });
    });
  });
}
