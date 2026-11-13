import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { barcodePng, slipCode } from "../codes";
import { patientCardPdf, sampleLabelsPdf, tokenSlipPdf } from "../pdf";
import { inScope } from "../authz";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const pdf = (reply: import("fastify").FastifyReply, name: string, bytes: Buffer) => reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${name}.pdf"`).header("cache-control", "private, no-store").send(bytes);

/** Slips, cards and labels whose barcodes the scanners in this product read back. */
export default async function printableRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/appointments/:id/slip.pdf", { preHandler: staffGuard("appointments:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    const a = await withTenant(db, tenant.id, (tx) => tx.appointment.findFirst({ where: { id, ...inScope(req) }, include: { patient: true, doctor: { select: { fullName: true } }, branch: { select: { name: true } } } }));
    if (!a) throw httpError(404, "Appointment not found");
    const code = slipCode(a.id);
    return pdf(reply, `token-${a.tokenNo ?? a.id.slice(-6)}`, await tokenSlipPdf({ hospital: tenant.name, branch: a.branch.name, token: a.tokenNo, patient: a.patient.fullName, patientNo: a.patient.patientNo, doctor: a.doctor?.fullName, when: a.scheduledAt, channel: a.channel, barcode: await barcodePng(code), code }));
  });

  app.get("/patients/:id/card.pdf", { preHandler: staffGuard("patients:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    const p = await withTenant(db, tenant.id, (tx) => tx.patient.findUnique({ where: { id } }));
    if (!p) throw httpError(404, "Patient not found");
    return pdf(reply, `card-${p.patientNo}`, await patientCardPdf({ hospital: tenant.name, name: p.fullName, patientNo: p.patientNo, phone: p.phone, bloodGroup: p.bloodGroup, barcode: await barcodePng(p.patientNo) }));
  });

  app.get("/lab/orders/:id/labels.pdf", { preHandler: staffGuard("lab:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { copies } = z.object({ copies: z.coerce.number().int().min(1).max(10).default(1) }).parse(req.query);
    const o = await withTenant(db, staff(req).tid, (tx) => tx.labOrder.findFirst({ where: { id, ...inScope(req) }, include: { patient: true, items: { select: { testName: true } } } }));
    if (!o) throw httpError(404, "Lab order not found");
    const age = o.patient.dateOfBirth ? `${Math.floor((Date.now() - o.patient.dateOfBirth.getTime()) / (365.25 * 86_400_000))}y${o.patient.gender ? ` ${o.patient.gender[0]}` : ""}` : undefined;
    const barcode = await barcodePng(o.orderNo, { height: 10 });
    return pdf(reply, o.orderNo, await sampleLabelsPdf(Array.from({ length: copies }, (_, i) => ({ patient: o.patient.fullName, age, orderNo: o.orderNo, tests: o.items.map((t) => t.testName).join(", "), when: o.createdAt, barcode, copy: i + 1, of: copies }))));
  });
}
