import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clinicalProfileInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { hasPermission } from "../authz";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });

/** A patient's whole story in one place: visits, prescriptions, vitals over time, lab results, medicines bought and every file. */
export default async function historyRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/patients/:id/history", { preHandler: staffGuard("clinical:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { exclude } = z.object({ exclude: z.string().uuid().optional() }).parse(req.query); // the visit being written now
    const tenantId = staff(req).tid;
    const withDocs = hasPermission(req, "documents:read");
    const data = await withTenant(db, tenantId, async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id } });
      if (!patient) throw httpError(404, "Patient not found");
      const consultations = await tx.consultation.findMany({
        where: { patientId: id, ...(exclude ? { NOT: { appointmentId: exclude } } : {}) },
        include: { items: true, appointment: { select: { channel: true, scheduledAt: true, branch: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" }, take: 60,
      });
      const labs = await tx.labOrder.findMany({ where: { patientId: id, status: { not: "CANCELLED" } }, include: { items: { orderBy: { testName: "asc" } } }, orderBy: { createdAt: "desc" }, take: 40 });
      const dispenses = await tx.dispense.findMany({ where: { patientId: id }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 30 });
      const meds = dispenses.length ? await tx.medicine.findMany({ where: { id: { in: [...new Set(dispenses.flatMap((d) => d.lines.map((l) => l.medicineId)))] } }, select: { id: true, name: true, strength: true } }) : [];
      const docs = withDocs ? await tx.patientDocument.findMany({ where: { patientId: id, removedAt: null }, select: { id: true, kind: true, title: true, fileName: true, mimeType: true, sizeBytes: true, appointmentId: true, createdAt: true, uploadedBy: true }, orderBy: { createdAt: "desc" }, take: 100 }) : [];
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "history.view", entity: "patient", entityId: id } });
      return { patient, consultations, labs, dispenses, meds, docs };
    });
    const people = new Map((await db.identity.findMany({ where: { id: { in: [...new Set([...data.consultations.map((c) => c.doctorId), ...data.docs.map((d) => d.uploadedBy)].filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

    type Event = { type: "VISIT" | "LAB" | "DISPENSE" | "DOCUMENT"; at: Date; [k: string]: unknown };
    const events: Event[] = [
      ...data.consultations.map((c): Event => ({
        type: "VISIT", at: c.completedAt ?? c.createdAt, id: c.id, appointmentId: c.appointmentId, completed: !!c.completedAt, channel: c.appointment.channel, branch: c.appointment.branch.name,
        doctor: c.doctorId ? people.get(c.doctorId) ?? null : null, complaints: c.complaints, diagnosis: c.diagnosis, advice: c.advice, vitals: c.vitals, followUpOn: c.followUpOn, rxNo: c.rxNo,
        items: c.items.map((i) => ({ name: i.name, dose: i.dose, frequency: i.frequency, durationDays: i.durationDays, instructions: i.instructions, quantity: i.quantity })),
      })),
      ...data.labs.map((o): Event => ({ type: "LAB", at: o.releasedAt ?? o.createdAt, id: o.id, orderNo: o.orderNo, status: o.status, items: o.items.map((i) => ({ testName: i.testName, result: i.resultText ?? (i.resultValue === null ? null : String(i.resultValue)), unit: i.unit, refRange: i.refRange, flag: i.flag })) })),
      ...data.dispenses.map((d): Event => ({ type: "DISPENSE", at: d.createdAt, id: d.id, items: d.lines.map((l) => { const m = data.meds.find((x) => x.id === l.medicineId); return { name: m ? `${m.name}${m.strength ? ` ${m.strength}` : ""}` : "Medicine", qty: l.qty }; }) })),
      ...data.docs.map((d): Event => ({ type: "DOCUMENT", at: d.createdAt, ...d, uploadedByName: people.get(d.uploadedBy) ?? null })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    // Numbers worth charting across visits, oldest first.
    const vitals = data.consultations
      .filter((c) => c.vitals && typeof c.vitals === "object")
      .map((c) => ({ at: c.createdAt, ...(c.vitals as Record<string, number>) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    const p = data.patient;
    return {
      patient: { id: p.id, fullName: p.fullName, patientNo: p.patientNo, gender: p.gender, dateOfBirth: p.dateOfBirth, phone: p.phone, bloodGroup: p.bloodGroup, allergies: p.allergies, chronicConditions: p.chronicConditions, clinicalNotes: p.clinicalNotes, abhaNumber: p.abhaNumber, abhaAddress: p.abhaAddress },
      events, vitals,
      counts: { visits: data.consultations.filter((c) => c.completedAt).length, labs: data.labs.length, documents: data.docs.length },
    };
  });

  app.put("/patients/:id/clinical-profile", { preHandler: staffGuard("clinical:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = clinicalProfileInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id } }))) throw httpError(404, "Patient not found");
      const p = await tx.patient.update({ where: { id }, data: input, select: { id: true, bloodGroup: true, allergies: true, chronicConditions: true, clinicalNotes: true, abhaNumber: true, abhaAddress: true } }).catch((e) => { if ((e as { code?: string }).code === "P2002") throw httpError(409, "That ABHA number is already registered"); throw e; });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "clinical_profile.update", entity: "patient", entityId: id } });
      return p;
    });
  });
}
