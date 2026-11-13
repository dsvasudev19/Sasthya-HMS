import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { prescriptionPdf } from "../pdf";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const publicUrl = () => (process.env["PUBLIC_WEB_URL"] ?? "http://localhost:5173").replace(/\/$/, "");

/** Builds the prescription PDF for a consultation. Shared by staff and by the patient's own app. */
export async function buildPrescription(db: PrismaClient, tenantId: string, tx: TenantTx, consultationId: string, opts: { completedOnly: boolean }): Promise<{ bytes: Buffer; name: string }> {
  const c = await tx.consultation.findFirst({
    where: { id: consultationId, ...(opts.completedOnly ? { completedAt: { not: null } } : {}) },
    include: { items: true, patient: true, appointment: { select: { channel: true, scheduledAt: true, branch: { select: { name: true, address: true, phone: true } } } } },
  });
  if (!c) throw httpError(404, "Prescription not found");
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const profileRow = await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "profile" } } });
  const profile = (profileRow?.value as { legalName?: string; address?: string; phone?: string } | undefined) ?? {};
  const identity = c.doctorId ? await db.identity.findUnique({ where: { id: c.doctorId }, select: { fullName: true } }) : null;
  const dp = c.doctorId ? await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId, identityId: c.doctorId } } }) : null;
  const dob = c.patient.dateOfBirth;
  const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 86_400_000)) : null;
  const signed = !!c.completedAt && !!c.rxCode;
  const qrPng = signed ? await QRCode.toBuffer(`${publicUrl()}/verify/${tenantId}/${c.rxCode}`, { margin: 0, width: 160 }) : undefined;
  const bytes = await prescriptionPdf({
    hospital: { name: profile.legalName || tenant.name, branch: c.appointment.branch.name, address: profile.address || c.appointment.branch.address, phone: profile.phone || c.appointment.branch.phone },
    doctor: identity ? { name: `Dr ${(dp?.displayName ?? identity.fullName ?? "").replace(/^Dr\.?\s+/i, "")}`, specialty: dp?.specialty, qualification: dp?.qualification, registrationNo: dp?.registrationNo } : null,
    patient: { fullName: c.patient.fullName, patientNo: c.patient.patientNo, phone: c.patient.phone, gender: c.patient.gender, ageYears: age, allergies: c.patient.allergies, bloodGroup: c.patient.bloodGroup },
    date: c.completedAt ?? c.appointment.scheduledAt, rxNo: c.rxNo, signed, channel: c.appointment.channel, vitals: (c.vitals as Record<string, number> | null) ?? null,
    complaints: c.complaints, diagnosis: c.diagnosis, advice: c.advice, followUpOn: c.followUpOn, items: c.items, qrPng, verifyCode: c.rxCode,
  });
  return { bytes, name: c.rxNo ?? `draft-${c.id.slice(0, 8)}` };
}

export default async function rxRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/consultations/:id/prescription.pdf", { preHandler: staffGuard("clinical:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const out = await withTenant(db, tenantId, async (tx) => {
      const r = await buildPrescription(db, tenantId, tx, id, { completedOnly: false });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "prescription.print", entity: "consultation", entityId: id } });
      return r;
    });
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${out.name}.pdf"`).header("cache-control", "private, no-store").send(out.bytes);
  });

  // Anyone holding a printout can check it is real. Only what a pharmacist needs is revealed: no diagnosis, no contact details.
  app.get("/public/rx/:tenantId/:code", async (req) => {
    const { tenantId, code } = z.object({ tenantId: z.string().uuid(), code: z.string().regex(/^[0-9A-F]{12}$/) }).parse(req.params);
    const c = await withTenant(db, tenantId, (tx) => tx.consultation.findUnique({ where: { rxCode: code }, include: { tenant: { select: { name: true } }, doctor: { select: { fullName: true } }, patient: { select: { fullName: true } }, items: { select: { name: true, dose: true, frequency: true, durationDays: true, quantity: true } } } }));
    if (!c || !c.completedAt || c.tenantId !== tenantId) return { valid: false };
    const initials = c.patient.fullName.split(" ").filter(Boolean).map((p) => p[0]!.toUpperCase() + "***").join(" ");
    return { valid: true, rxNo: c.rxNo, hospital: c.tenant.name, doctor: c.doctor?.fullName ?? null, issuedAt: c.completedAt, patient: initials, items: c.items };
  });
}
