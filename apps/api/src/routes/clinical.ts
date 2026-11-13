import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consultationInput, vitalsSchema, labOrderInput } from "@hms/contracts";
import { randomBytes } from "node:crypto";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { createLabOrder } from "../lab";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError, prefixOf } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const consultInclude = { items: true, labOrders: { include: { items: true, invoice: { select: { id: true, invoiceNo: true, status: true } } } } } as const;

async function loadAppointment(tx: TenantTx, id: string, branchIds: string[]) {
  const a = await tx.appointment.findFirst({ where: { id, branchId: { in: branchIds } }, include: { patient: true, doctor: { select: { id: true, fullName: true } }, invoice: { select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true } } } });
  if (!a) throw httpError(404, "Appointment not found");
  return a;
}

/** The consultation can be edited while the patient is checked in or in the room, and until it is completed. */
function assertEditable(status: string, completedAt: Date | null | undefined) {
  if (!["CHECKED_IN", "IN_PROGRESS"].includes(status)) throw httpError(409, "The patient must be checked in");
  if (completedAt) throw httpError(409, "This consultation is already completed");
}

async function ensureConsultation(tx: TenantTx, tenantId: string, a: { id: string; patientId: string; status: string }, doctorId?: string) {
  const existing = await tx.consultation.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: a.id } } });
  if (existing) return existing;
  return tx.consultation.create({ data: { tenantId, appointmentId: a.id, patientId: a.patientId, doctorId } });
}

export default async function clinicalRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/appointments/:id/consultation", { preHandler: staffGuard("clinical:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const appointment = await loadAppointment(tx, id, req.access!.branchIds);
      const consultation = await tx.consultation.findUnique({ where: { tenantId_appointmentId: { tenantId: staff(req).tid, appointmentId: id } }, include: consultInclude });
      const history = await tx.consultation.findMany({
        where: { patientId: appointment.patientId, completedAt: { not: null }, NOT: { appointmentId: id } },
        include: { items: true }, orderBy: { completedAt: "desc" }, take: 5,
      });
      return { appointment, consultation, history };
    });
  });

  app.put("/appointments/:id/consultation", { preHandler: staffGuard("clinical:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = consultationInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const appt = await loadAppointment(tx, id, req.access!.branchIds);
      const current = await tx.consultation.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: id } } });
      assertEditable(appt.status, current?.completedAt);
      const c = current ?? (await ensureConsultation(tx, tenantId, appt, staff(req).sub));
      await tx.consultation.update({
        where: { id: c.id },
        data: {
          doctorId: staff(req).sub,
          complaints: input.complaints,
          vitals: input.vitals ? { ...((c.vitals as object | null) ?? {}), ...input.vitals } : undefined,
          diagnosis: input.diagnosis,
          advice: input.advice,
          followUpOn: input.followUpOn === undefined ? undefined : input.followUpOn ? new Date(`${input.followUpOn}T00:00:00Z`) : null,
        },
      });
      if (input.items) {
        const ids = input.items.map((i) => i.medicineId).filter(Boolean) as string[];
        const meds = ids.length ? await tx.medicine.findMany({ where: { id: { in: ids } } }) : [];
        if (new Set(ids).size !== meds.length) throw httpError(404, "Medicine not found");
        await tx.prescriptionItem.deleteMany({ where: { consultationId: c.id } });
        await tx.prescriptionItem.createMany({ data: input.items.map((i) => ({ tenantId, consultationId: c.id, ...i })) });
      }
      if (appt.status === "CHECKED_IN") await tx.appointment.update({ where: { id }, data: { status: "IN_PROGRESS" } });
      return tx.consultation.findUniqueOrThrow({ where: { id: c.id }, include: consultInclude });
    });
  });

  // Nurses record vitals before the doctor sees the patient.
  app.put("/appointments/:id/vitals", { preHandler: staffGuard("vitals:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const vitals = vitalsSchema.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const appt = await loadAppointment(tx, id, req.access!.branchIds);
      const c = await ensureConsultation(tx, tenantId, appt);
      assertEditable(appt.status, c.completedAt);
      return tx.consultation.update({ where: { id: c.id }, data: { vitals: { ...((c.vitals as object | null) ?? {}), ...vitals } }, include: consultInclude });
    });
  });

  app.post("/appointments/:id/consultation/complete", { preHandler: staffGuard("clinical:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const appt = await loadAppointment(tx, id, req.access!.branchIds);
      const c = await tx.consultation.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: id } } });
      if (!c) throw httpError(400, "Record the consultation first");
      assertEditable(appt.status, c.completedAt);
      if (!c.diagnosis?.trim()) throw httpError(400, "Add a diagnosis before completing the visit");
      // Signing off numbers the prescription and gives it a code anyone can verify. After this the record cannot be edited.
      const year = new Date().getFullYear();
      const branch = req.access!.allowed.find((b) => b.id === appt.branchId)!;
      const rxNo = `RX-${branch.code}-${year}-${String(await nextSeq(tx, tenantId, `rx:${year}`)).padStart(5, "0")}`;
      await tx.consultation.update({ where: { id: c.id }, data: { completedAt: new Date(), rxNo, rxCode: randomBytes(6).toString("hex").toUpperCase() } });
      await tx.appointment.update({ where: { id }, data: { status: "COMPLETED" } });
      return tx.consultation.findUniqueOrThrow({ where: { id: c.id }, include: consultInclude });
    });
  });

  // Doctors order tests during the visit; the bill is created at once.
  app.post("/appointments/:id/lab-orders", { preHandler: [featureGate(db, "lab"), staffGuard("lab:order")] }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { testIds } = labOrderInput.parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = await prefixOf(db, tenantId);
    const order = await withTenant(db, tenantId, async (tx) => {
      const appt = await loadAppointment(tx, id, req.access!.branchIds);
      const c = await ensureConsultation(tx, tenantId, appt, staff(req).sub);
      assertEditable(appt.status, c.completedAt);
      return createLabOrder(tx, { tenantId, prefix, branch: { id: appt.branchId, code: req.access!.allowed.find((b) => b.id === appt.branchId)!.code }, patientId: appt.patientId, consultationId: c.id, testIds, orderedBy: staff(req).sub });
    });
    return reply.code(201).send(order);
  });

  app.get("/patients/:id/consultations", { preHandler: staffGuard("clinical:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.consultation.findMany({ where: { patientId: id }, include: { items: true, doctor: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    );
  });
}
