import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { inScope } from "../authz";
import { featureGate } from "../gates";
import { staff, staffGuard, startOfDay } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const HOUR = 3_600_000;
const when = z.coerce.date();

/** The operation theatre schedule: bookings that cannot clash, and the record of what was done. Gated as the "ot" feature. */
export default async function otRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "ot");
  const read = { preHandler: [gate, staffGuard("ot:read")] };
  const write = { preHandler: [gate, staffGuard("ot:write")] };
  const manage = { preHandler: [gate, staffGuard("ot:manage")] };
  const names = async (ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

  app.get("/ot/theatres", read, async (req) => withTenant(db, staff(req).tid, (tx) => tx.theatre.findMany({ where: { ...inScope(req) }, orderBy: { name: "asc" } })));
  app.post("/ot/theatres", manage, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    const tenantId = staff(req).tid;
    return reply.code(201).send(await withTenant(db, tenantId, (tx) => tx.theatre.create({ data: { tenantId, branchId: req.access!.branchId, name: name.replace(/\s+/g, " ") } }).catch((e) => { if ((e as { code?: string }).code === "P2002") throw httpError(409, "This branch already has a theatre with that name"); throw e; })));
  });
  app.patch("/ot/theatres/:id", manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ name: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() }).parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const t = await tx.theatre.findFirst({ where: { id, ...inScope(req) } });
      if (!t) throw httpError(404, "Theatre not found");
      if (i.active === false && (await tx.surgery.count({ where: { theatreId: id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, scheduledEnd: { gt: new Date() } } }))) throw httpError(409, "There are upcoming surgeries in this theatre. Move them first");
      return tx.theatre.update({ where: { id }, data: i });
    });
  });

  /** Refuses a booking that overlaps another in the same theatre, or that double-books the surgeon or anaesthetist. Serialised per hospital so two bookers cannot both pass. */
  const checkClash = async (tx: TenantTx, tenantId: string, s: { theatreId: string; surgeonId: string; anaesthetistId?: string | null; start: Date; end: Date; except?: string }) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ot:${tenantId}`}))`;
    const clash = await tx.surgery.findFirst({
      where: { id: s.except ? { not: s.except } : undefined, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, scheduledStart: { lt: s.end }, scheduledEnd: { gt: s.start }, OR: [{ theatreId: s.theatreId }, { surgeonId: s.surgeonId }, ...(s.anaesthetistId ? [{ anaesthetistId: s.anaesthetistId }, { surgeonId: s.anaesthetistId }] : [])] },
      include: { theatre: { select: { name: true } } },
    });
    if (!clash) return;
    const t = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const why = clash.theatreId === s.theatreId ? `${clash.theatre.name} is already booked` : clash.surgeonId === s.surgeonId ? "The surgeon is already operating" : "The anaesthetist is already booked";
    throw httpError(409, `${why} from ${t(clash.scheduledStart)} to ${t(clash.scheduledEnd)}`);
  };

  const input = z.object({
    theatreId: z.string().uuid(), patientId: z.string().uuid(), admissionId: z.string().uuid().optional(), procedure: z.string().trim().min(3).max(200), surgeonId: z.string().uuid(), anaesthetistId: z.string().uuid().optional(),
    start: when, end: when, notes: z.string().trim().max(1000).optional(),
  });
  const check = async (tenantId: string, i: z.infer<typeof input>) => {
    if (i.end <= i.start) throw httpError(400, "The end must be after the start");
    if (i.end.getTime() - i.start.getTime() > 16 * HOUR) throw httpError(400, "A single booking can be at most 16 hours");
    const doctors = [i.surgeonId, ...(i.anaesthetistId ? [i.anaesthetistId] : [])];
    if ((await db.tenantMembership.count({ where: { tenantId, identityId: { in: doctors }, role: "DOCTOR" } })) < new Set(doctors).size) throw httpError(400, "The surgeon and anaesthetist must be doctors in this hospital");
  };

  app.get("/ot/schedule", read, async (req) => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.coerce.number().int().min(1).max(14).default(1) }).parse(req.query);
    const from = startOfDay(q.date ?? new Date(Date.now() + 19_800_000).toISOString().slice(0, 10));
    const to = new Date(from.getTime() + q.days * 24 * HOUR);
    const { theatres, rows } = await withTenant(db, staff(req).tid, async (tx) => ({
      theatres: await tx.theatre.findMany({ where: { ...inScope(req), active: true }, orderBy: { name: "asc" } }),
      rows: await tx.surgery.findMany({ where: { ...inScope(req), scheduledStart: { gte: from, lt: to } }, include: { patient: { select: { id: true, fullName: true, patientNo: true } } }, orderBy: { scheduledStart: "asc" } }),
    }));
    const who = await names(rows.flatMap((r) => [r.surgeonId, r.anaesthetistId]));
    return { from, to, theatres, surgeries: rows.map((r) => ({ ...r, surgeon: who.get(r.surgeonId) ?? null, anaesthetist: r.anaesthetistId ? who.get(r.anaesthetistId) ?? null : null })) };
  });

  app.post("/ot/surgeries", write, async (req, reply) => {
    const i = input.parse(req.body);
    const tenantId = staff(req).tid;
    await check(tenantId, i);
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      const theatre = await tx.theatre.findFirst({ where: { id: i.theatreId, active: true, ...inScope(req) } });
      if (!theatre) throw httpError(404, "Theatre not found");
      if (!(await tx.patient.findUnique({ where: { id: i.patientId } }))) throw httpError(404, "Patient not found");
      if (i.admissionId && !(await tx.admission.findFirst({ where: { id: i.admissionId, patientId: i.patientId, status: "ADMITTED" } }))) throw httpError(409, "That patient is not currently admitted under that admission");
      await checkClash(tx, tenantId, { theatreId: i.theatreId, surgeonId: i.surgeonId, anaesthetistId: i.anaesthetistId, start: i.start, end: i.end });
      const s = await tx.surgery.create({ data: { tenantId, branchId: theatre.branchId, theatreId: i.theatreId, patientId: i.patientId, admissionId: i.admissionId, procedure: i.procedure, surgeonId: i.surgeonId, anaesthetistId: i.anaesthetistId, scheduledStart: i.start, scheduledEnd: i.end, notes: i.notes, createdBy: staff(req).sub } });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "ot.book", entity: "surgery", entityId: s.id, meta: { procedure: i.procedure } } });
      return s;
    }));
  });

  app.patch("/ot/surgeries/:id", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = input.pick({ theatreId: true, surgeonId: true, anaesthetistId: true, start: true, end: true, procedure: true, notes: true }).partial().parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const s = await tx.surgery.findFirst({ where: { id, ...inScope(req) } });
      if (!s) throw httpError(404, "Surgery not found");
      if (!["SCHEDULED", "POSTPONED"].includes(s.status)) throw httpError(409, "Only a surgery that has not started can be changed");
      const merged = { theatreId: i.theatreId ?? s.theatreId, surgeonId: i.surgeonId ?? s.surgeonId, anaesthetistId: i.anaesthetistId ?? s.anaesthetistId, start: i.start ?? s.scheduledStart, end: i.end ?? s.scheduledEnd };
      if (merged.end <= merged.start) throw httpError(400, "The end must be after the start");
      await checkClash(tx, tenantId, { ...merged, except: id });
      return tx.surgery.update({ where: { id }, data: { theatreId: merged.theatreId, surgeonId: merged.surgeonId, anaesthetistId: merged.anaesthetistId, scheduledStart: merged.start, scheduledEnd: merged.end, status: "SCHEDULED", ...(i.procedure ? { procedure: i.procedure } : {}), ...(i.notes !== undefined ? { notes: i.notes } : {}) } });
    });
  });

  app.post("/ot/surgeries/:id/act", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ action: z.enum(["start", "complete", "cancel", "postpone"]), anaesthesia: z.string().trim().max(200).optional(), outcome: z.string().trim().max(2000).optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const s = await tx.surgery.findFirst({ where: { id, ...inScope(req) } });
      if (!s) throw httpError(404, "Surgery not found");
      const now = new Date();
      const to = (status: string, extra: object = {}) => tx.surgery.update({ where: { id }, data: { status, ...extra } });
      const must = (ok: boolean, m: string) => { if (!ok) throw httpError(409, m); };
      let out;
      switch (i.action) {
        case "start": must(s.status === "SCHEDULED", "Only a scheduled surgery can be started"); out = await to("IN_PROGRESS", { startedAt: now, ...(i.anaesthesia ? { anaesthesia: i.anaesthesia } : {}) }); break;
        case "complete":
          must(s.status === "IN_PROGRESS", "Start the surgery before completing it");
          if (!i.outcome) throw httpError(400, "Record the outcome");
          out = await to("COMPLETED", { endedAt: now, outcome: i.outcome, ...(i.anaesthesia ? { anaesthesia: i.anaesthesia } : {}) }); break;
        case "cancel": case "postpone":
          must(["SCHEDULED", "POSTPONED"].includes(s.status), "Only a surgery that has not started can be cancelled or postponed");
          if (!i.notes) throw httpError(400, "Give a reason");
          out = await to(i.action === "cancel" ? "CANCELLED" : "POSTPONED", { notes: [s.notes, `${i.action}: ${i.notes}`].filter(Boolean).join("\n") }); break;
      }
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: `ot.${i.action}`, entity: "surgery", entityId: id } });
      return out;
    });
  });

  // How well the theatres are used: for the chairman and the OT manager.
  app.get("/ot/utilisation", read, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }).parse(req.query);
    const since = new Date(Date.now() - q.days * 24 * HOUR);
    const { theatres, rows } = await withTenant(db, staff(req).tid, async (tx) => ({
      theatres: await tx.theatre.findMany({ where: { ...inScope(req), active: true } }),
      rows: await tx.surgery.findMany({ where: { ...inScope(req), scheduledStart: { gte: since, lte: new Date() } } }),
    }));
    const done = rows.filter((r) => r.status === "COMPLETED" && r.startedAt && r.endedAt);
    const hours = (r: { startedAt: Date | null; endedAt: Date | null }) => (r.endedAt!.getTime() - r.startedAt!.getTime()) / HOUR;
    const byTheatre = theatres.map((t) => {
      const mine = done.filter((r) => r.theatreId === t.id);
      return { id: t.id, name: t.name, surgeries: mine.length, hoursUsed: Math.round(mine.reduce((a, r) => a + hours(r), 0) * 10) / 10, utilisationPct: Math.min(100, Math.round((mine.reduce((a, r) => a + hours(r), 0) / (q.days * 10)) * 1000) / 10) };
    });
    const late = done.map((r) => (r.startedAt!.getTime() - r.scheduledStart.getTime()) / 60_000);
    return { days: q.days, completed: done.length, cancelled: rows.filter((r) => r.status === "CANCELLED").length, postponed: rows.filter((r) => r.status === "POSTPONED").length, avgDurationHours: done.length ? Math.round((done.reduce((a, r) => a + hours(r), 0) / done.length) * 10) / 10 : null, avgStartDelayMinutes: late.length ? Math.round(late.reduce((a, b) => a + b, 0) / late.length) : null, onTimeStartPct: late.length ? Math.round((late.filter((m) => m <= 15).length / late.length) * 1000) / 10 : null, byTheatre };
  });
}
