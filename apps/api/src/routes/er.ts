import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nextSeq, withTenant, type PrismaClient } from "@hms/db";
import { inScope } from "../authz";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const MIN = 60_000;
/** Longest a patient of each triage level should wait to be seen, in minutes. Level 1 is seen at once. */
export const TARGET_WAIT: Record<number, number> = { 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 };
const vitals = z.object({ temperatureC: z.number().min(30).max(45).optional(), pulse: z.number().int().min(0).max(300).optional(), systolic: z.number().int().min(0).max(320).optional(), diastolic: z.number().int().min(0).max(220).optional(), spo2: z.number().int().min(0).max(100).optional(), respRate: z.number().int().min(0).max(90).optional(), gcs: z.number().int().min(3).max(15).optional() });
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2); };

/** Casualty: register fast, triage, see in order of danger, and watch the waits. Gated as the "emergency" feature. */
export default async function erRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "emergency");
  const read = { preHandler: [gate, staffGuard("er:read")] };
  const write = { preHandler: [gate, staffGuard("er:write")] };
  const names = async (ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

  app.get("/er/board", read, async (req) => {
    const start = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");
    const { active, today } = await withTenant(db, staff(req).tid, async (tx) => ({
      active: await tx.erVisit.findMany({ where: { ...inScope(req), status: { in: ["WAITING", "IN_TREATMENT", "OBSERVATION"] } }, include: { patient: { select: { id: true, patientNo: true, allergies: true } } }, orderBy: [{ triage: "asc" }, { arrivedAt: "asc" }] }),
      today: await tx.erVisit.findMany({ where: { ...inScope(req), arrivedAt: { gte: start } }, select: { triage: true, arrivedAt: true, seenAt: true, status: true } }),
    }));
    const who = await names(active.map((a) => a.doctorId));
    const now = Date.now();
    const rows = active.map((v) => { const wait = Math.round(((v.seenAt?.getTime() ?? now) - v.arrivedAt.getTime()) / MIN); return { ...v, doctorName: v.doctorId ? who.get(v.doctorId) ?? null : null, waitMinutes: wait, breached: v.status === "WAITING" && wait > TARGET_WAIT[v.triage]! }; });
    const waiting = rows.filter((r) => r.status === "WAITING");
    const seen = today.filter((t) => t.seenAt).map((t) => (t.seenAt!.getTime() - t.arrivedAt.getTime()) / MIN);
    return {
      visits: rows,
      stats: { waiting: waiting.length, inTreatment: rows.filter((r) => r.status === "IN_TREATMENT").length, observation: rows.filter((r) => r.status === "OBSERVATION").length, breaches: rows.filter((r) => r.breached).length, arrivalsToday: today.length, medianDoorToDoctorMinutes: median(seen), lwbsToday: today.filter((t) => t.status === "LWBS").length, byTriage: Object.fromEntries([1, 2, 3, 4, 5].map((l) => [l, waiting.filter((r) => r.triage === l).length])) },
      targets: TARGET_WAIT,
    };
  });

  app.post("/er/visits", write, async (req, reply) => {
    const i = z.object({
      patientId: z.string().uuid().optional(), patientLabel: z.string().trim().min(2).max(120).optional(), complaint: z.string().trim().min(2).max(300), triage: z.number().int().min(1).max(5),
      arrivalMode: z.enum(["WALK_IN", "AMBULANCE", "POLICE", "REFERRED"]).default("WALK_IN"), vitals: vitals.optional(), notes: z.string().trim().max(1000).optional(),
    }).parse(req.body);
    if (!i.patientId && !i.patientLabel) throw httpError(400, "Give the patient's name, or describe them if they are unidentified");
    const tenantId = staff(req).tid;
    const v = await withTenant(db, tenantId, async (tx) => {
      let label = i.patientLabel ?? "";
      if (i.patientId) { const p = await tx.patient.findUnique({ where: { id: i.patientId } }); if (!p) throw httpError(404, "Patient not found"); label = p.fullName; if ((await tx.erVisit.count({ where: { patientId: p.id, status: { in: ["WAITING", "IN_TREATMENT", "OBSERVATION"] } } }))) throw httpError(409, "This patient is already in the emergency department"); }
      const year = new Date().getFullYear();
      const v = await tx.erVisit.create({ data: { tenantId, branchId: req.access!.branchId, arrivalNo: `ER-${year}-${String(await nextSeq(tx, tenantId, `er:${year}`)).padStart(5, "0")}`, patientId: i.patientId, patientLabel: label, complaint: i.complaint, triage: i.triage, arrivalMode: i.arrivalMode, vitals: i.vitals as never, notes: i.notes, createdBy: staff(req).sub } });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "er.register", entity: "er_visit", entityId: v.id, meta: { triage: i.triage } } });
      return v;
    });
    return reply.code(201).send(v);
  });

  app.patch("/er/visits/:id", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ triage: z.number().int().min(1).max(5).optional(), vitals: vitals.optional(), notes: z.string().trim().max(1000).optional(), patientId: z.string().uuid().optional(), doctorId: z.string().uuid().optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    if (i.doctorId && (await db.tenantMembership.count({ where: { tenantId, identityId: i.doctorId, role: "DOCTOR" } })) === 0) throw httpError(400, "Choose a doctor from this hospital");
    return withTenant(db, tenantId, async (tx) => {
      const v = await tx.erVisit.findFirst({ where: { id, ...inScope(req) } });
      if (!v) throw httpError(404, "Visit not found");
      if (["ADMITTED", "DISCHARGED", "REFERRED", "LWBS", "DEATH"].includes(v.status)) throw httpError(409, "This visit is closed");
      let label = v.patientLabel;
      if (i.patientId) { const p = await tx.patient.findUnique({ where: { id: i.patientId } }); if (!p) throw httpError(404, "Patient not found"); label = p.fullName; }
      return tx.erVisit.update({ where: { id }, data: { ...(i.triage ? { triage: i.triage } : {}), ...(i.vitals ? { vitals: i.vitals as never } : {}), ...(i.notes !== undefined ? { notes: i.notes } : {}), ...(i.patientId ? { patientId: i.patientId, patientLabel: label } : {}), ...(i.doctorId ? { doctorId: i.doctorId } : {}) } });
    });
  });

  app.post("/er/visits/:id/act", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ action: z.enum(["see", "observe", "discharge", "refer", "lwbs", "death", "admit"]), doctorId: z.string().uuid().optional(), admissionId: z.string().uuid().optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const v = await tx.erVisit.findFirst({ where: { id, ...inScope(req) } });
      if (!v) throw httpError(404, "Visit not found");
      const live = ["WAITING", "IN_TREATMENT", "OBSERVATION"].includes(v.status);
      if (!live) throw httpError(409, "This visit is closed");
      const now = new Date();
      const note = [v.notes, i.notes && `${i.action}: ${i.notes}`].filter(Boolean).join("\n") || undefined;
      let data: Record<string, unknown>;
      switch (i.action) {
        case "see": {
          if (v.status !== "WAITING") throw httpError(409, "This patient has already been seen");
          const doc = i.doctorId ?? staff(req).sub;
          if ((await db.tenantMembership.count({ where: { tenantId, identityId: doc, role: "DOCTOR" } })) === 0) throw httpError(400, "Choose the doctor who is seeing the patient");
          data = { status: "IN_TREATMENT", seenAt: now, doctorId: doc, notes: note }; break;
        }
        case "observe": data = { status: "OBSERVATION", seenAt: v.seenAt ?? now, notes: note }; break;
        case "admit": {
          if (!i.admissionId) throw httpError(400, "Admit the patient to a bed first, then link the admission");
          const a = await tx.admission.findFirst({ where: { id: i.admissionId, ...inScope(req) } });
          if (!a || (v.patientId && a.patientId !== v.patientId)) throw httpError(404, "Admission not found for this patient");
          data = { status: "ADMITTED", admissionId: a.id, patientId: v.patientId ?? a.patientId, seenAt: v.seenAt ?? now, closedAt: now, notes: note }; break;
        }
        case "discharge": if (v.status === "WAITING") throw httpError(409, "Nobody has seen this patient yet. Mark them as left without being seen if they have gone"); data = { status: "DISCHARGED", closedAt: now, notes: note }; break;
        case "refer": data = { status: "REFERRED", closedAt: now, seenAt: v.seenAt ?? now, notes: note }; break;
        case "lwbs": if (v.status !== "WAITING") throw httpError(409, "Only a patient who was never seen can be marked left without being seen"); data = { status: "LWBS", closedAt: now, notes: note }; break;
        case "death": data = { status: "DEATH", closedAt: now, seenAt: v.seenAt ?? now, notes: note }; break;
      }
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: `er.${i.action}`, entity: "er_visit", entityId: id } });
      return tx.erVisit.update({ where: { id }, data });
    });
  });

  app.get("/er/visits", read, async (req) => {
    const q = z.object({ q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(80) }).parse(req.query);
    return withTenant(db, staff(req).tid, (tx) => tx.erVisit.findMany({ where: { ...inScope(req), status: { notIn: ["WAITING", "IN_TREATMENT", "OBSERVATION"] }, ...(q.q ? { OR: [{ patientLabel: { contains: q.q, mode: "insensitive" } }, { arrivalNo: { contains: q.q, mode: "insensitive" } }] } : {}) }, orderBy: { arrivedAt: "desc" }, take: q.limit }));
  });

  app.get("/er/metrics", read, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }).parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.erVisit.findMany({ where: { ...inScope(req), arrivedAt: { gte: since } }, select: { triage: true, status: true, arrivalMode: true, arrivedAt: true, seenAt: true } }));
    const wait = (r: (typeof rows)[number]) => (r.seenAt!.getTime() - r.arrivedAt.getTime()) / MIN;
    const seen = rows.filter((r) => r.seenAt);
    const closed = rows.filter((r) => !["WAITING", "IN_TREATMENT", "OBSERVATION"].includes(r.status));
    return {
      days, visits: rows.length, medianDoorToDoctorMinutes: median(seen.map(wait)),
      withinTargetPct: seen.length ? Math.round((seen.filter((r) => wait(r) <= TARGET_WAIT[r.triage]!).length / seen.length) * 1000) / 10 : null,
      lwbsPct: rows.length ? Math.round((rows.filter((r) => r.status === "LWBS").length / rows.length) * 1000) / 10 : 0,
      admissionPct: closed.length ? Math.round((closed.filter((r) => r.status === "ADMITTED").length / closed.length) * 1000) / 10 : 0,
      byTriage: [1, 2, 3, 4, 5].map((l) => ({ level: l, visits: rows.filter((r) => r.triage === l).length, medianWaitMinutes: median(seen.filter((r) => r.triage === l).map(wait)) })),
      byMode: Object.fromEntries(["WALK_IN", "AMBULANCE", "POLICE", "REFERRED"].map((m) => [m, rows.filter((r) => r.arrivalMode === m).length])),
      byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: rows.filter((r) => Number(new Date(r.arrivedAt.getTime() + 19_800_000).toISOString().slice(11, 13)) === h).length })),
    };
  });
}
