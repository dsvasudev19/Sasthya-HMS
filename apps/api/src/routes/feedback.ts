import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enqueueManual } from "@hms/notifications";
import { withTenant, type PrismaClient } from "@hms/db";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const publicUrl = () => (process.env["PUBLIC_WEB_URL"] ?? "http://localhost:5173").replace(/\/$/, "");
const nps = (scores: number[]) => (scores.length ? Math.round(((scores.filter((s) => s >= 9).length - scores.filter((s) => s <= 6).length) / scores.length) * 100) : null);

/** Asks patients how it went and tells the chairman. The patient's link needs no sign-in. Gated as the "feedback" feature. */
export default async function feedbackRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "feedback");

  app.post("/feedback/requests", { preHandler: [gate, staffGuard("patients:read")] }, async (req, reply) => {
    const i = z.object({ patientId: z.string().uuid(), context: z.enum(["VISIT", "ADMISSION", "OTHER"]).default("VISIT"), doctorId: z.string().uuid().optional(), send: z.boolean().default(true) }).parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: i.patientId } }))) throw httpError(404, "Patient not found");
      const token = randomBytes(12).toString("base64url");
      const f = await tx.feedback.create({ data: { tenantId, branchId: req.access!.branchId, patientId: i.patientId, token, context: i.context, doctorId: i.doctorId } });
      const url = `${publicUrl()}/f/${tenantId}/${token}`;
      const sent = i.send ? await enqueueManual(tx, { tenantId, patientId: i.patientId, text: `Thank you for visiting ${tenant.name}. Tell us how we did, it takes 10 seconds: ${url}` }) : false;
      return { id: f.id, url, sent };
    }));
  });

  // What the patient sees. No sign-in; the long random token is the key, and it works once.
  app.get("/public/feedback/:tenantId/:token", async (req) => {
    const { tenantId, token } = z.object({ tenantId: z.string().uuid(), token: z.string().min(8).max(40) }).parse(req.params);
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const f = t && (await withTenant(db, tenantId, (tx) => tx.feedback.findUnique({ where: { token } })));
    if (!t || !f) throw httpError(404, "This link is not valid");
    const doctor = f.doctorId ? (await db.identity.findUnique({ where: { id: f.doctorId }, select: { fullName: true } }))?.fullName ?? null : null;
    return { hospital: t.name, doctor, answered: !!f.answeredAt, context: f.context };
  });
  app.post("/public/feedback/:tenantId/:token", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { tenantId, token } = z.object({ tenantId: z.string().uuid(), token: z.string().min(8).max(40) }).parse(req.params);
    const i = z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(1000).optional() }).parse(req.body);
    return withTenant(db, tenantId, async (tx) => {
      const r = await tx.feedback.updateMany({ where: { token, answeredAt: null }, data: { score: i.score, comment: i.comment || null, answeredAt: new Date() } });
      if (r.count === 0) throw httpError(409, "Thank you. This feedback was already given, or the link is not valid");
      return { thanks: true };
    });
  });

  app.get("/feedback", { preHandler: [gate, staffGuard("feedback:read")] }, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.feedback.findMany({ where: { createdAt: { gte: since } }, include: { patient: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } }));
    const answered = rows.filter((r) => r.score !== null);
    const scores = answered.map((r) => r.score!);
    const who = new Map((await db.identity.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.doctorId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((x) => [x.id, x.fullName]));
    const weeks = Array.from({ length: 12 }, (_, i) => { const end = Date.now() - (11 - i) * 7 * 86_400_000; const w = answered.filter((r) => r.answeredAt!.getTime() <= end && r.answeredAt!.getTime() > end - 7 * 86_400_000).map((r) => r.score!); return { weekEnding: new Date(end + 19_800_000).toISOString().slice(0, 10), responses: w.length, nps: nps(w) }; });
    return {
      days, sent: rows.length, responses: answered.length, responseRatePct: rows.length ? Math.round((answered.length / rows.length) * 1000) / 10 : 0, nps: nps(scores), average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      promoters: scores.filter((s) => s >= 9).length, passives: scores.filter((s) => s >= 7 && s <= 8).length, detractors: scores.filter((s) => s <= 6).length, weeks,
      byDoctor: [...new Set(answered.map((r) => r.doctorId).filter(Boolean) as string[])].map((d) => { const s = answered.filter((r) => r.doctorId === d).map((r) => r.score!); return { doctorId: d, doctor: who.get(d) ?? null, responses: s.length, nps: nps(s), average: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 }; }).sort((a, b) => (b.nps ?? -101) - (a.nps ?? -101)),
      comments: answered.filter((r) => r.comment).sort((a, b) => a.score! - b.score!).slice(0, 15).map((r) => ({ id: r.id, score: r.score, comment: r.comment, patient: r.patient?.fullName ?? null, at: r.answeredAt, context: r.context })),
    };
  });
}
