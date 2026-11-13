import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { enqueueManual } from "@hms/notifications";
import { randomBytes } from "node:crypto";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { inScope } from "../authz";
import { createInvoice } from "../billing";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { dischargeSummaryPdf } from "../pdf";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const HOUR = 3_600_000;
const KINDS = ["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU", "NICU", "MATERNITY", "EMERGENCY", "DAY_CARE"] as const;
const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/** Days to charge for one stay: 24-hour blocks, a two-hour grace so a quick bed change is not billed twice, and at least one day. */
export const stayDays = (from: Date, to: Date) => Math.max(1, Math.ceil(((to.getTime() - from.getTime()) / HOUR - 2) / 24));

const vitals = z.object({
  temperatureC: z.number().min(30).max(45).optional(), pulse: z.number().int().min(20).max(250).optional(), systolic: z.number().int().min(40).max(300).optional(),
  diastolic: z.number().int().min(20).max(200).optional(), spo2: z.number().int().min(50).max(100).optional(), respRate: z.number().int().min(4).max(80).optional(), painScore: z.number().int().min(0).max(10).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), "Enter at least one reading");
const summary = z.object({
  diagnosis: z.string().trim().min(3).max(300), course: z.string().trim().max(3000).optional(), treatment: z.string().trim().max(3000).optional(),
  condition: z.string().trim().max(300).optional(), advice: z.string().trim().max(2000).optional(), medicines: z.string().trim().max(2000).optional(), followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Wards, beds and the people in them: admit, nurse, transfer, discharge and bill. Gated as the "ipd" feature. */
export default async function ipdRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "ipd");
  const read = { preHandler: [gate, staffGuard("ipd:read")] };
  const write = { preHandler: [gate, staffGuard("ipd:write")] };
  const manage = { preHandler: [gate, staffGuard("ipd:manage")] };
  const names = async (ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
  const audit = (tx: TenantTx, tenantId: string, actor: string, action: string, id: string, meta?: object) => tx.auditLog.create({ data: { tenantId, actorIdentityId: actor, action, entity: "admission", entityId: id, meta } });
  const conflict = (e: unknown, message: string): never => { if ((e as { code?: string }).code === "P2002") throw httpError(409, message); throw e; };

  // ── the bed board ──
  app.get("/ipd/overview", read, async (req) => {
    const tenantId = staff(req).tid;
    const start = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");
    const { wards, today } = await withTenant(db, tenantId, async (tx) => ({
      wards: await tx.ward.findMany({ where: { ...inScope(req) }, orderBy: [{ name: "asc" }], include: { beds: { orderBy: { code: "asc" } } } }),
      today: { admissions: await tx.admission.count({ where: { ...inScope(req), admittedAt: { gte: start } } }), discharges: await tx.admission.count({ where: { ...inScope(req), dischargedAt: { gte: start } } }) },
    }));
    const occupied = await withTenant(db, tenantId, (tx) => tx.admission.findMany({ where: { ...inScope(req), status: "ADMITTED" }, include: { patient: { select: { fullName: true, patientNo: true } } } }));
    const who = await names(occupied.map((a) => a.doctorId));
    const byBed = new Map(occupied.map((a) => [a.bedId, a]));
    const out = wards.map((w) => ({
      id: w.id, name: w.name, kind: w.kind, dailyRatePaise: w.dailyRatePaise, active: w.active, branchId: w.branchId,
      beds: w.beds.map((b) => { const a = byBed.get(b.id); return { id: b.id, code: b.code, status: b.status, active: b.active, admission: a ? { id: a.id, admissionNo: a.admissionNo, patientName: a.patient.fullName, patientNo: a.patient.patientNo, admittedAt: a.admittedAt, expectedDischargeOn: a.expectedDischargeOn, doctorName: who.get(a.doctorId) ?? null } : null }; }),
    }));
    const beds = out.filter((w) => w.active).flatMap((w) => w.beds.filter((b) => b.active));
    const n = (s: string) => beds.filter((b) => b.status === s).length;
    const usable = beds.length - n("MAINTENANCE");
    return { wards: out, totals: { beds: beds.length, occupied: n("OCCUPIED"), available: n("AVAILABLE"), cleaning: n("CLEANING"), maintenance: n("MAINTENANCE"), occupancyPct: usable ? Math.round((n("OCCUPIED") / usable) * 1000) / 10 : 0 }, today };
  });

  // ── wards and beds ──
  app.post("/ipd/wards", manage, async (req, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(KINDS), dailyRatePaise: z.number().int().min(0).max(10_000_000), bedCount: z.number().int().min(0).max(300).default(0), bedPrefix: z.string().trim().min(1).max(6).optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = (input.bedPrefix ?? input.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3)).toUpperCase();
    const ward = await withTenant(db, tenantId, async (tx) => {
      const w = await tx.ward.create({ data: { tenantId, branchId: req.access!.branchId, name: clean(input.name), kind: input.kind, dailyRatePaise: input.dailyRatePaise } }).catch((e) => conflict(e, "This branch already has a ward with that name"));
      if (input.bedCount) await tx.bed.createMany({ data: Array.from({ length: input.bedCount }, (_, i) => ({ tenantId, wardId: w.id, code: `${prefix}-${String(i + 1).padStart(2, "0")}` })) });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "ipd.ward.create", entity: "ward", entityId: w.id, meta: { name: w.name, beds: input.bedCount } } });
      return w;
    });
    return reply.code(201).send(ward);
  });

  app.patch("/ipd/wards/:id", manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ name: z.string().trim().min(2).max(60).optional(), kind: z.enum(KINDS).optional(), dailyRatePaise: z.number().int().min(0).max(10_000_000).optional(), active: z.boolean().optional() }).parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const w = await tx.ward.findFirst({ where: { id, ...inScope(req) }, include: { beds: true } });
      if (!w) throw httpError(404, "Ward not found");
      if (input.active === false && w.beds.some((b) => b.status === "OCCUPIED")) throw httpError(409, "There are patients in this ward. Transfer or discharge them first");
      // Changing the rate affects patients admitted from now on; those already in a bed keep the rate recorded on their stay.
      return tx.ward.update({ where: { id }, data: { ...input, ...(input.name ? { name: clean(input.name) } : {}) } }).catch((e) => conflict(e, "This branch already has a ward with that name"));
    });
  });

  app.post("/ipd/wards/:id/beds", manage, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { count } = z.object({ count: z.number().int().min(1).max(100) }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const w = await tx.ward.findFirst({ where: { id, ...inScope(req) }, include: { beds: { select: { code: true } } } });
      if (!w) throw httpError(404, "Ward not found");
      const prefix = w.beds[0]?.code.split("-")[0] ?? w.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
      const have = new Set(w.beds.map((b) => b.code));
      const codes: string[] = [];
      for (let n = w.beds.length + 1; codes.length < count; n++) { const c = `${prefix}-${String(n).padStart(2, "0")}`; if (!have.has(c)) codes.push(c); }
      await tx.bed.createMany({ data: codes.map((code) => ({ tenantId, wardId: id, code })) });
      return reply.code(201).send({ added: codes });
    });
  });

  // A bed cannot be marked occupied by hand: only an admission does that. Cleaners and nurses free it; managers retire it.
  app.patch("/ipd/beds/:id", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ status: z.enum(["AVAILABLE", "CLEANING", "MAINTENANCE"]).optional(), active: z.boolean().optional() }).parse(req.body);
    if (input.active !== undefined && !(await import("../authz")).hasPermission(req, "ipd:manage")) throw httpError(403, "Only someone who sets up wards can retire a bed");
    return withTenant(db, staff(req).tid, async (tx) => {
      const b = await tx.bed.findFirst({ where: { id, ward: { ...inScope(req) } } });
      if (!b) throw httpError(404, "Bed not found");
      if (b.status === "OCCUPIED") throw httpError(409, "A patient is in this bed");
      return tx.bed.update({ where: { id }, data: input });
    });
  });

  // ── admissions ──
  app.get("/ipd/admissions", read, async (req) => {
    const q = z.object({ status: z.enum(["ADMITTED", "DISCHARGED", "CANCELLED"]).default("ADMITTED"), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(80), patientId: z.string().uuid().optional() }).parse(req.query);
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.admission.findMany({
      where: { ...inScope(req), status: q.status, ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.q ? { OR: [{ admissionNo: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }, { patient: { patientNo: { contains: q.q, mode: "insensitive" } } }] } : {}) },
      include: { patient: { select: { id: true, fullName: true, patientNo: true, gender: true, dateOfBirth: true } }, bed: { include: { ward: { select: { name: true } } } } },
      orderBy: q.status === "ADMITTED" ? { admittedAt: "asc" } : { dischargedAt: "desc" }, take: q.limit,
    }));
    const who = await names(rows.map((r) => r.doctorId));
    return rows.map((r) => ({ id: r.id, admissionNo: r.admissionNo, status: r.status, admittedAt: r.admittedAt, dischargedAt: r.dischargedAt, dischargeType: r.dischargeType, reason: r.reason, expectedDischargeOn: r.expectedDischargeOn, patient: r.patient, doctorName: who.get(r.doctorId) ?? null, ward: r.bed?.ward.name ?? null, bedCode: r.bed?.code ?? null }));
  });

  app.post("/ipd/admissions", write, async (req, reply) => {
    const input = z.object({ patientId: z.string().uuid(), bedId: z.string().uuid(), doctorId: z.string().uuid(), reason: z.string().trim().min(3).max(300), provisionalDiagnosis: z.string().trim().max(300).optional(), expectedDischargeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    if ((await db.tenantMembership.count({ where: { tenantId, identityId: input.doctorId, role: "DOCTOR" } })) === 0) throw httpError(400, "Choose a doctor from this hospital");
    const a = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      const bed = await tx.bed.findFirst({ where: { id: input.bedId, active: true, ward: { ...inScope(req), active: true } }, include: { ward: true } });
      if (!bed) throw httpError(404, "Bed not found");
      if (bed.status !== "AVAILABLE") throw httpError(409, `Bed ${bed.code} is ${bed.status.toLowerCase()}`);
      const claimed = await tx.bed.updateMany({ where: { id: bed.id, status: "AVAILABLE" }, data: { status: "OCCUPIED" } });
      if (claimed.count !== 1) throw httpError(409, "Someone else has just taken that bed");
      const year = new Date().getFullYear();
      const seq = await nextSeq(tx, tenantId, `admission:${year}`);
      const adm = await tx.admission.create({ data: { tenantId, branchId: bed.ward.branchId, patientId: input.patientId, bedId: bed.id, doctorId: input.doctorId, admissionNo: `ADM-${year}-${String(seq).padStart(5, "0")}`, reason: input.reason, provisionalDiagnosis: input.provisionalDiagnosis, expectedDischargeOn: input.expectedDischargeOn ? new Date(input.expectedDischargeOn) : undefined, createdBy: staff(req).sub } })
        .catch((e) => conflict(e, "This patient is already admitted"));
      await tx.bedStay.create({ data: { tenantId, admissionId: adm.id, bedId: bed.id, wardName: bed.ward.name, bedCode: bed.code, dailyRatePaise: bed.ward.dailyRatePaise } });
      await audit(tx, tenantId, staff(req).sub, "ipd.admit", adm.id, { admissionNo: adm.admissionNo, bed: bed.code });
      return adm;
    });
    return reply.code(201).send(a);
  });

  const load = async (tx: TenantTx, id: string, req: Parameters<typeof inScope>[0]) => {
    const a = await tx.admission.findFirst({ where: { id, ...inScope(req) }, include: { patient: true, bed: { include: { ward: true } }, stays: { orderBy: { fromAt: "asc" } }, notes: { orderBy: { createdAt: "desc" }, take: 300 } } });
    if (!a) throw httpError(404, "Admission not found");
    return a;
  };

  app.get("/ipd/admissions/:id", read, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = await withTenant(db, staff(req).tid, (tx) => load(tx, id, req));
    const who = await names([a.doctorId, a.dischargedBy, ...a.notes.map((n) => n.authorId)]);
    const end = a.dischargedAt ?? new Date();
    const stays = a.stays.map((s) => { const days = stayDays(s.fromAt, s.toAt ?? end); return { id: s.id, ward: s.wardName, bed: s.bedCode, dailyRatePaise: s.dailyRatePaise, fromAt: s.fromAt, toAt: s.toAt, days, amountPaise: days * s.dailyRatePaise }; });
    return {
      id: a.id, admissionNo: a.admissionNo, status: a.status, admittedAt: a.admittedAt, dischargedAt: a.dischargedAt, dischargeType: a.dischargeType, reason: a.reason, provisionalDiagnosis: a.provisionalDiagnosis, expectedDischargeOn: a.expectedDischargeOn,
      summary: a.summary, invoiceId: a.invoiceId, doctorId: a.doctorId, doctorName: who.get(a.doctorId) ?? null,
      patient: { id: a.patient.id, fullName: a.patient.fullName, patientNo: a.patient.patientNo, gender: a.patient.gender, dateOfBirth: a.patient.dateOfBirth, phone: a.patient.phone, allergies: a.patient.allergies },
      bed: a.bed ? { id: a.bed.id, code: a.bed.code, ward: a.bed.ward.name } : null, stays, bedChargesPaise: stays.reduce((x, s) => x + s.amountPaise, 0),
      notes: a.notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text, vitals: n.vitals, createdAt: n.createdAt, author: who.get(n.authorId) ?? null })),
    };
  });

  app.post("/ipd/admissions/:id/notes", write, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ kind: z.enum(["NOTE", "VITALS", "ROUND", "ORDER"]), text: z.string().trim().min(1).max(2000).optional(), vitals: vitals.optional() }).parse(req.body);
    if (input.kind === "VITALS" ? !input.vitals : !input.text) throw httpError(400, input.kind === "VITALS" ? "Enter at least one reading" : "Write the note");
    const tenantId = staff(req).tid;
    const note = await withTenant(db, tenantId, async (tx) => {
      const a = await tx.admission.findFirst({ where: { id, ...inScope(req) } });
      if (!a) throw httpError(404, "Admission not found");
      if (a.status !== "ADMITTED") throw httpError(409, "This admission is closed");
      return tx.admissionNote.create({ data: { tenantId, admissionId: id, kind: input.kind, text: input.text, vitals: input.vitals as never, authorId: staff(req).sub } });
    });
    return reply.code(201).send(note);
  });

  app.post("/ipd/admissions/:id/transfer", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ bedId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const a = await tx.admission.findFirst({ where: { id, ...inScope(req) } });
      if (!a) throw httpError(404, "Admission not found");
      if (a.status !== "ADMITTED") throw httpError(409, "This admission is closed");
      if (a.bedId === input.bedId) throw httpError(400, "The patient is already in that bed");
      const bed = await tx.bed.findFirst({ where: { id: input.bedId, active: true, ward: { ...inScope(req), active: true } }, include: { ward: true } });
      if (!bed) throw httpError(404, "Bed not found");
      if (bed.status !== "AVAILABLE") throw httpError(409, `Bed ${bed.code} is ${bed.status.toLowerCase()}`);
      if ((await tx.bed.updateMany({ where: { id: bed.id, status: "AVAILABLE" }, data: { status: "OCCUPIED" } })).count !== 1) throw httpError(409, "Someone else has just taken that bed");
      const now = new Date();
      await tx.bedStay.updateMany({ where: { admissionId: id, toAt: null }, data: { toAt: now } });
      if (a.bedId) await tx.bed.update({ where: { id: a.bedId }, data: { status: "CLEANING" } });
      await tx.bedStay.create({ data: { tenantId, admissionId: id, bedId: bed.id, wardName: bed.ward.name, bedCode: bed.code, dailyRatePaise: bed.ward.dailyRatePaise, fromAt: now } });
      await tx.admissionNote.create({ data: { tenantId, admissionId: id, kind: "NOTE", text: `Moved to ${bed.ward.name}, bed ${bed.code}. ${input.reason}`, authorId: staff(req).sub } });
      await audit(tx, tenantId, staff(req).sub, "ipd.transfer", id, { to: bed.code, reason: input.reason });
      return tx.admission.update({ where: { id }, data: { bedId: bed.id } });
    });
  });

  // Closes the stay: frees the bed, writes the discharge summary and raises the bill for the days stayed plus anything extra.
  app.post("/ipd/admissions/:id/discharge", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({
      type: z.enum(["RECOVERED", "REFERRED", "LAMA", "ABSCONDED", "DEATH"]), summary,
      extraCharges: z.array(z.object({ description: z.string().trim().min(2).max(120), amountPaise: z.number().int().min(1).max(100_000_000) })).max(20).default([]),
      discountPaise: z.number().int().min(0).default(0), payment: z.object({ method: z.enum(["CASH", "UPI", "CARD"]), amountPaise: z.number().int().min(1).optional(), reference: z.string().trim().max(60).optional() }).optional(),
    }).parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true, name: true } });
    return withTenant(db, tenantId, async (tx) => {
      const a = await tx.admission.findFirst({ where: { id, ...inScope(req) }, include: { stays: true, branch: { select: { id: true, code: true } } } });
      if (!a) throw httpError(404, "Admission not found");
      if (a.status !== "ADMITTED") throw httpError(409, "This patient has already been discharged");
      const now = new Date();
      await tx.bedStay.updateMany({ where: { admissionId: id, toAt: null }, data: { toAt: now } });
      const lines = a.stays.map((s) => ({ s, days: stayDays(s.fromAt, s.toAt ?? now) })).map(({ s, days }) => ({ kind: "SERVICE" as const, description: `${s.wardName}, bed ${s.bedCode}: ${days} day${days > 1 ? "s" : ""}`, quantity: days, unitPaise: s.dailyRatePaise }))
        .filter((l) => l.unitPaise > 0).concat(input.extraCharges.map((c) => ({ kind: "SERVICE" as const, description: c.description, quantity: 1, unitPaise: c.amountPaise })));
      const invoice = lines.length ? await createInvoice(tx, { tenantId, tenantPrefix: tenant.slug.slice(0, 3).toUpperCase(), branch: a.branch, patientId: a.patientId, source: "IPD", lines, discountPaise: input.discountPaise, note: `Inpatient stay ${a.admissionNo}`, createdBy: staff(req).sub, payment: input.payment }) : null;
      if (a.bedId) await tx.bed.update({ where: { id: a.bedId }, data: { status: "CLEANING" } });
      const done = await tx.admission.update({ where: { id }, data: { status: "DISCHARGED", dischargedAt: now, dischargeType: input.type, dischargedBy: staff(req).sub, summary: input.summary as never, invoiceId: invoice?.id } });
      await audit(tx, tenantId, staff(req).sub, "ipd.discharge", id, { type: input.type, billedPaise: invoice?.totalPaise ?? 0 });
      // Ask how it went, a day later in spirit: the link is sent now and works whenever they open it.
      if (input.type !== "DEATH") {
        const token = randomBytes(12).toString("base64url");
        await tx.feedback.create({ data: { tenantId, branchId: a.branchId, patientId: a.patientId, token, context: "ADMISSION", doctorId: a.doctorId } });
        const base = (process.env["PUBLIC_WEB_URL"] ?? "http://localhost:5173").replace(/\/$/, "");
        await enqueueManual(tx, { tenantId, patientId: a.patientId, text: `We hope you are recovering well. Please tell us how your stay at ${tenant.name} was: ${base}/f/${tenantId}/${token}` });
      }
      const open = await tx.invoice.aggregate({ where: { patientId: a.patientId, status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { totalPaise: true, paidPaise: true } });
      return { admission: done, invoice, outstandingPaise: (open._sum.totalPaise ?? 0) - (open._sum.paidPaise ?? 0) };
    });
  });

  app.get("/ipd/admissions/:id/summary.pdf", read, async (req, reply: FastifyReply) => {
    const { id } = idParam.parse(req.params);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid }, select: { name: true } });
    const a = await withTenant(db, staff(req).tid, (tx) => load(tx, id, req));
    if (a.status !== "DISCHARGED" || !a.summary) throw httpError(409, "The discharge summary is ready once the patient is discharged");
    const who = await names([a.doctorId, a.dischargedBy]);
    const s = a.summary as z.infer<typeof summary>;
    const bytes = await dischargeSummaryPdf({
      hospital: tenant.name, patient: { name: a.patient.fullName, patientNo: a.patient.patientNo, gender: a.patient.gender, dob: a.patient.dateOfBirth, phone: a.patient.phone, allergies: a.patient.allergies },
      admissionNo: a.admissionNo, admittedAt: a.admittedAt, dischargedAt: a.dischargedAt!, type: a.dischargeType!, doctor: who.get(a.doctorId) ?? "", ward: a.stays.map((x) => `${x.wardName} ${x.bedCode}`).join(" → "), reason: a.reason, summary: s,
    });
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${a.admissionNo}-discharge.pdf"`).send(bytes);
  });
}
