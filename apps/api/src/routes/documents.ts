import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { documentFieldsInput, documentKindSchema } from "@hms/contracts";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { sniffMime, type FileStore } from "../storage";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const KIND_TITLE: Record<string, string> = { PRESCRIPTION_SCAN: "Scanned prescription", LAB_REPORT: "Lab report", IMAGING: "Imaging", DISCHARGE_SUMMARY: "Discharge summary", ID_PROOF: "ID proof", CONSENT: "Consent form", INSURANCE: "Insurance", OTHER: "Document" };

const listSelect = { id: true, patientId: true, appointmentId: true, consultationId: true, kind: true, title: true, note: true, fileName: true, mimeType: true, sizeBytes: true, visibleToPatient: true, uploadedBy: true, createdAt: true } as const;

export async function audit(tx: TenantTx, tenantId: string, actor: string, action: string, entityId: string, meta?: object) {
  await tx.auditLog.create({ data: { tenantId, actorIdentityId: actor, action, entity: "document", entityId, meta } });
}

/** Scanned prescriptions, outside reports and other files in a patient's record. Bytes are encrypted at rest and only ever served through here. */
export default async function documentRoutes(app: FastifyInstance, { db, store }: { db: PrismaClient; store: FileStore }) {
  app.addHook("preHandler", featureGate(db, "documents"));
  await app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 8, fieldSize: 2000, parts: 12 } });

  const names = async (ids: string[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

  app.post("/patients/:id/documents", { preHandler: staffGuard("documents:write") }, async (req, reply) => {
    const { id: patientId } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const fields: Record<string, string> = {};
    let file: { name: string; bytes: Buffer } | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (file) throw httpError(400, "Upload one file at a time");
          file = { name: part.filename, bytes: await part.toBuffer() };
        } else fields[part.fieldname] = String(part.value);
      }
    } catch (e) {
      if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw httpError(413, "That file is larger than 10 MB. Use a smaller scan or photo.");
      throw e;
    }
    if (!file || file.bytes.length === 0) throw httpError(400, "Choose a file to upload");
    const input = documentFieldsInput.parse(fields);
    const mime = sniffMime(file.bytes);
    if (!mime) throw httpError(415, "Only PDF, JPEG, PNG or WebP files can be added");
    const sha = createHash("sha256").update(file.bytes).digest("hex");
    const safeName = file.name.replace(/[^\w.\- ()]/g, "_").slice(-100) || "document";

    const out = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: patientId } }))) throw httpError(404, "Patient not found");
      let consultationId: string | undefined;
      if (input.appointmentId) {
        const a = await tx.appointment.findFirst({ where: { id: input.appointmentId, patientId, branchId: { in: req.access!.branchIds } } });
        if (!a) throw httpError(404, "Appointment not found for this patient");
        consultationId = (await tx.consultation.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: a.id } } }))?.id;
      }
      // The same scan sent twice (a double tap, a retry) is stored once.
      const same = await tx.patientDocument.findFirst({ where: { patientId, sha256: sha, removedAt: null }, select: listSelect });
      if (same) return { doc: same, duplicate: true };
      const storageKey = await store.put(tenantId, file!.bytes);
      const doc = await tx.patientDocument.create({
        data: { tenantId, patientId, appointmentId: input.appointmentId, consultationId, kind: input.kind, title: input.title || KIND_TITLE[input.kind] || "Document", note: input.note, fileName: safeName, mimeType: mime, sizeBytes: file!.bytes.length, sha256: sha, storageKey, visibleToPatient: input.visibleToPatient === "true", uploadedBy: staff(req).sub },
        select: listSelect,
      });
      await audit(tx, tenantId, staff(req).sub, "document.upload", doc.id, { kind: doc.kind, patientId, bytes: doc.sizeBytes });
      return { doc, duplicate: false };
    });
    return reply.code(out.duplicate ? 200 : 201).send({ ...out.doc, duplicate: out.duplicate });
  });

  app.get("/patients/:id/documents", { preHandler: staffGuard("documents:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ kind: documentKindSchema.optional(), appointmentId: z.string().uuid().optional() }).parse(req.query);
    const rows = await withTenant(db, staff(req).tid, (tx) =>
      tx.patientDocument.findMany({ where: { patientId: id, removedAt: null, ...(q.kind ? { kind: q.kind } : {}), ...(q.appointmentId ? { appointmentId: q.appointmentId } : {}) }, select: listSelect, orderBy: { createdAt: "desc" }, take: 200 }),
    );
    const by = await names(rows.map((r) => r.uploadedBy));
    return rows.map((r) => ({ ...r, uploadedByName: by.get(r.uploadedBy) ?? null }));
  });

  // Recent documents across all patients, for the Documents page.
  app.get("/documents", { preHandler: staffGuard("documents:read") }, async (req) => {
    const q = z.object({ kind: documentKindSchema.optional(), q: z.string().trim().max(60).optional() }).parse(req.query);
    const rows = await withTenant(db, staff(req).tid, (tx) =>
      tx.patientDocument.findMany({
        where: { removedAt: null, ...(q.kind ? { kind: q.kind } : {}), ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { fileName: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }, { patient: { patientNo: { contains: q.q, mode: "insensitive" } } }] } : {}) },
        select: { ...listSelect, patient: { select: { id: true, fullName: true, patientNo: true } } },
        orderBy: { createdAt: "desc" }, take: 100,
      }),
    );
    const by = await names(rows.map((r) => r.uploadedBy));
    return rows.map((r) => ({ ...r, uploadedByName: by.get(r.uploadedBy) ?? null }));
  });

  app.get("/documents/:id/file", { preHandler: staffGuard("documents:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const doc = await withTenant(db, tenantId, async (tx) => {
      const d = await tx.patientDocument.findFirst({ where: { id, removedAt: null } });
      if (!d) throw httpError(404, "Document not found");
      await audit(tx, tenantId, staff(req).sub, "document.view", d.id, { patientId: d.patientId });
      return d;
    });
    const bytes = await store.get(doc.storageKey).catch(() => { throw httpError(410, "The stored file is missing or unreadable. Contact support."); });
    return reply.header("content-type", doc.mimeType).header("content-disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`).header("cache-control", "private, no-store").send(bytes);
  });

  app.patch("/documents/:id", { preHandler: staffGuard("documents:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = z.object({ title: z.string().trim().min(1).max(120).optional(), note: z.string().trim().max(500).nullable().optional(), kind: documentKindSchema.optional(), visibleToPatient: z.boolean().optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patientDocument.findFirst({ where: { id, removedAt: null } }))) throw httpError(404, "Document not found");
      const d = await tx.patientDocument.update({ where: { id }, data: input, select: listSelect });
      await audit(tx, tenantId, staff(req).sub, "document.update", id, input);
      return d;
    });
  });

  // Hides a document from the record. The file and the row stay (medical records are retained) and the action is audited.
  app.delete("/documents/:id", { preHandler: staffGuard("documents:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body ?? {});
    const tenantId = staff(req).tid;
    await withTenant(db, tenantId, async (tx) => {
      const done = await tx.patientDocument.updateMany({ where: { id, removedAt: null }, data: { removedAt: new Date(), removedBy: staff(req).sub } });
      if (done.count === 0) throw httpError(404, "Document not found");
      await audit(tx, tenantId, staff(req).sub, "document.remove", id, { reason });
    });
    return { removed: true };
  });
}
