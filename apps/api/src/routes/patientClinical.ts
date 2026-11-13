import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { patient, patientGuard } from "../guards";
import { audit } from "./documents";
import { buildPrescription } from "./rx";
import { ensureTeleSession } from "./tele";
import { joinWindow, teleJoinUrl } from "../tele";
import type { FileStore } from "../storage";
import { featuresOf, tenantInfo } from "../gates";
import type { Feature } from "@hms/billing-core";
import { httpError } from "../util";

const both = z.object({ tenantId: z.string().uuid(), id: z.string().uuid() });

/** What a patient can reach about their own care from the app: files, prescriptions, and their video room. */
export default async function patientClinicalRoutes(app: FastifyInstance, { db, store }: { db: PrismaClient; store: FileStore }) {
  const link = async (req: Parameters<typeof patient>[0], tenantId: string) => {
    const l = await db.patientLink.findUnique({ where: { identityId_tenantId: { identityId: patient(req).sub, tenantId } } });
    if (!l) throw httpError(403, "Not allowed");
    return l;
  };

  const needs = async (tenantId: string, f: Feature) => { if (!featuresOf(await tenantInfo(db, tenantId)).includes(f)) throw httpError(403, "This is not available at this hospital"); };
  const enabled = async (tenantId: string, f: Feature) => featuresOf(await tenantInfo(db, tenantId)).includes(f);

  app.get("/patient/documents", { preHandler: patientGuard }, async (req) => {
    const links = (await db.patientLink.findMany({ where: { identityId: patient(req).sub }, include: { tenant: true } }));
    const allowed = await Promise.all(links.map((l) => enabled(l.tenantId, "documents")));
    links.splice(0, links.length, ...links.filter((_, i) => allowed[i]));
    const lists = await Promise.all(links.map((l) => withTenant(db, l.tenantId, async (tx) => {
      const rows = await tx.patientDocument.findMany({ where: { patientId: l.patientId, removedAt: null, visibleToPatient: true }, select: { id: true, kind: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
      return rows.map((r) => ({ ...r, hospital: { id: l.tenantId, name: l.tenant.name } }));
    })));
    return lists.flat().sort((a, b) => +b.createdAt - +a.createdAt);
  });

  app.get("/patient/documents/:tenantId/:id/file", { preHandler: patientGuard }, async (req, reply) => {
    const { tenantId, id } = both.parse(req.params);
    const l = await link(req, tenantId);
    const doc = await withTenant(db, tenantId, async (tx) => {
      const d = await tx.patientDocument.findFirst({ where: { id, patientId: l.patientId, removedAt: null, visibleToPatient: true } });
      if (!d) throw httpError(404, "Document not found");
      await audit(tx, tenantId, patient(req).sub, "document.view.patient", d.id);
      return d;
    });
    const bytes = await store.get(doc.storageKey).catch(() => { throw httpError(410, "The stored file is missing"); });
    return reply.header("content-type", doc.mimeType).header("content-disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`).header("cache-control", "private, no-store").send(bytes);
  });

  app.get("/patient/prescriptions/:tenantId/:id/pdf", { preHandler: patientGuard }, async (req, reply) => {
    const { tenantId, id } = both.parse(req.params);
    const l = await link(req, tenantId);
    const out = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.consultation.findFirst({ where: { id, patientId: l.patientId, completedAt: { not: null } } }))) throw httpError(404, "Prescription not found");
      return buildPrescription(db, tenantId, tx, id, { completedOnly: true });
    });
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${out.name}.pdf"`).header("cache-control", "private, no-store").send(out.bytes);
  });

  // A phone cannot attach a login header to a PDF it hands to the system viewer, so the app asks for a link that works for two
  // minutes, for one file, for this person. The file itself is still served only after the same checks.
  const sign = (req: Parameters<typeof patient>[0], what: "rx" | "doc", tenantId: string, id: string) =>
    app.jwt.sign({ kind: "dl", what, tid: tenantId, rid: id, sub: patient(req).sub } as never, { expiresIn: "2m" });
  const base = (req: { headers: Record<string, unknown>; protocol: string }) => `${req.protocol}://${String(req.headers["host"])}`;

  app.post("/patient/prescriptions/:tenantId/:id/link", { preHandler: patientGuard }, async (req) => {
    const { tenantId, id } = both.parse(req.params);
    const l = await link(req, tenantId);
    await withTenant(db, tenantId, async (tx) => { if (!(await tx.consultation.findFirst({ where: { id, patientId: l.patientId, completedAt: { not: null } } }))) throw httpError(404, "Prescription not found"); });
    return { url: `${base(req)}/dl/${sign(req, "rx", tenantId, id)}` };
  });
  app.post("/patient/documents/:tenantId/:id/link", { preHandler: patientGuard }, async (req) => {
    const { tenantId, id } = both.parse(req.params);
    const l = await link(req, tenantId);
    await withTenant(db, tenantId, async (tx) => { if (!(await tx.patientDocument.findFirst({ where: { id, patientId: l.patientId, removedAt: null, visibleToPatient: true } }))) throw httpError(404, "Document not found"); });
    return { url: `${base(req)}/dl/${sign(req, "doc", tenantId, id)}` };
  });

  app.get("/dl/:token", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(2000) }).parse(req.params);
    let c: { kind?: string; what?: string; tid?: string; rid?: string; sub?: string };
    try { c = app.jwt.verify(token); } catch { throw httpError(410, "This link has expired. Open it again from the app."); }
    if (c.kind !== "dl" || !c.tid || !c.rid || !c.sub) throw httpError(403, "Not allowed");
    const l = await db.patientLink.findUnique({ where: { identityId_tenantId: { identityId: c.sub, tenantId: c.tid } } });
    if (!l) throw httpError(403, "Not allowed");
    if (c.what === "rx") {
      const out = await withTenant(db, c.tid, async (tx) => {
        if (!(await tx.consultation.findFirst({ where: { id: c.rid, patientId: l.patientId, completedAt: { not: null } } }))) throw httpError(404, "Prescription not found");
        return buildPrescription(db, c.tid!, tx, c.rid!, { completedOnly: true });
      });
      return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${out.name}.pdf"`).header("cache-control", "private, no-store").send(out.bytes);
    }
    const doc = await withTenant(db, c.tid, async (tx) => {
      const d = await tx.patientDocument.findFirst({ where: { id: c.rid, patientId: l.patientId, removedAt: null, visibleToPatient: true } });
      if (!d) throw httpError(404, "Document not found");
      await audit(tx, c.tid!, c.sub!, "document.view.patient", d.id);
      return d;
    });
    const bytes = await store.get(doc.storageKey).catch(() => { throw httpError(410, "The stored file is missing"); });
    return reply.header("content-type", doc.mimeType).header("content-disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`).header("cache-control", "private, no-store").send(bytes);
  });

  // The patient taps Join: they wait in the room (shown to the doctor as "waiting") until the doctor opens it.
  app.post("/patient/appointments/:tenantId/:id/tele/join", { preHandler: patientGuard }, async (req) => {
    const { tenantId, id } = both.parse(req.params);
    await needs(tenantId, "tele");
    const l = await link(req, tenantId);
    const me = await db.patientLink.findUniqueOrThrow({ where: { identityId_tenantId: { identityId: patient(req).sub, tenantId } }, include: { identity: true } });
    return withTenant(db, tenantId, async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, patientId: l.patientId }, include: { doctor: { select: { fullName: true } } } });
      if (!a) throw httpError(404, "Appointment not found");
      if (a.channel !== "TELE") throw httpError(409, "This is not a video appointment");
      if (!["SCHEDULED", "CHECKED_IN", "IN_PROGRESS"].includes(a.status)) throw httpError(409, "This appointment is no longer open");
      const w = joinWindow(a.scheduledAt);
      const now = new Date();
      if (now < w.from) throw httpError(409, `You can join from ${w.from.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}, 15 minutes before your appointment.`);
      if (now > w.to) throw httpError(410, "This appointment time has passed.");
      let s = await ensureTeleSession(tx, tenantId, id);
      if (!s.patientJoinedAt) s = await tx.teleSession.update({ where: { id: s.id }, data: { patientJoinedAt: now } });
      if (a.status === "SCHEDULED") await tx.appointment.update({ where: { id }, data: { status: "CHECKED_IN" } });
      return { url: teleJoinUrl({ room: s.room, name: me.identity.fullName ?? "Patient", moderator: false }), doctorPresent: s.status === "LIVE", doctor: a.doctor?.fullName ?? null };
    });
  });
}
