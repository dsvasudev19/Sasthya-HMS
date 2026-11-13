import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { joinHospitalInput, patientBookingInput } from "@hms/contracts";
import { nextSeq, withTenant, type PrismaClient } from "@hms/db";
import type { PaymentGateway } from "@hms/billing-core";
import { assertBookable, doctorSlots, nextToken } from "../booking";
import { listDoctors } from "../doctorList";
import { coverageFor } from "../cards";
import { dayRange, patient, patientGuard, todayIst } from "../guards";
import { confirmAppointment } from "../notify";
import { languageSchema } from "@hms/contracts";

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const bookable = ["ACTIVE", "TRIAL"] as const;

export default async function patientAppRoutes(app: FastifyInstance, { db, gateway }: { db: PrismaClient; gateway: PaymentGateway | null }) {
  // ── public directory (no login) ──
  app.get("/public/hospitals", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    return db.tenant.findMany({
      where: { status: { in: [...bookable] }, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
      take: 30,
    });
  });

  const openTenant = async (id: string) => {
    const t = await db.tenant.findFirst({ where: { id, status: { in: [...bookable] } } });
    if (!t) throw httpError(404, "Hospital not found");
    return t;
  };

  app.get("/public/hospitals/:id/branches", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await openTenant(id);
    return withTenant(db, id, (tx) => tx.branch.findMany({ where: { active: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, code: true, name: true, address: true, phone: true, isMain: true } }));
  });

  // Doctors a patient can book, with specialty and fee. Doctors with a schedule must work at the chosen branch.
  app.get("/public/hospitals/:id/doctors", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { branchId } = z.object({ branchId: z.string().uuid().optional() }).parse(req.query);
    await openTenant(id);
    const all = await listDoctors(db, id);
    return all.filter((d) => d.active && (!branchId || !d.hasProfile || d.branchIds.length === 0 || d.branchIds.includes(branchId)))
      .map((d) => ({ id: d.id, name: d.name, specialty: d.specialty, qualification: d.qualification, feeInPersonPaise: d.feeInPersonPaise, feeTelePaise: d.feeTelePaise, hasSchedule: d.hasProfile && d.branchIds.length > 0 }));
  });

  app.get("/public/hospitals/:id/doctors/:doctorId/slots", async (req) => {
    const { id, doctorId } = z.object({ id: z.string().uuid(), doctorId: z.string().uuid() }).parse(req.params);
    const { date, branchId } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.string().uuid() }).parse(req.query);
    await openTenant(id);
    const slots = await withTenant(db, id, (tx) => doctorSlots(tx, id, doctorId, branchId, date));
    return slots.map((s) => ({ time: s.time.toISOString(), available: s.available }));
  });

  // ── signed-in patient ──
  app.get("/patient/me", { preHandler: patientGuard }, async (req) => {
    const identity = await db.identity.findUniqueOrThrow({ where: { id: patient(req).sub }, include: { patientLinks: { include: { tenant: true } } } });
    return {
      identity: { id: identity.id, phone: identity.phone, name: identity.fullName },
      hospitals: identity.patientLinks.map((l) => ({ tenantId: l.tenantId, name: l.tenant.name, patientId: l.patientId })),
    };
  });

  // Register at a hospital, or connect to the record the front desk already created for this phone number.
  app.post("/patient/hospitals/:tenantId/join", { preHandler: patientGuard }, async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const input = joinHospitalInput.parse(req.body);
    const identity = await db.identity.findUniqueOrThrow({ where: { id: patient(req).sub } });
    const tenant = await db.tenant.findFirst({ where: { id: tenantId, status: { in: [...bookable] } } });
    if (!tenant) throw httpError(404, "Hospital not found");
    const prefix = tenant.slug.slice(0, 3).toUpperCase();

    const rec = await withTenant(db, tenantId, async (tx) => {
      let p = await tx.patient.findFirst({ where: { OR: [{ identityId: identity.id }, { phone: identity.phone }] }, orderBy: { createdAt: "asc" } });
      if (!p) {
        if (!input.fullName) throw httpError(400, "fullName is required to register");
        const n = await nextSeq(tx, tenantId, "patient");
        p = await tx.patient.create({
          data: { tenantId, patientNo: `${prefix}-${String(n).padStart(6, "0")}`, identityId: identity.id, phone: identity.phone, fullName: input.fullName, gender: input.gender, dateOfBirth: input.dateOfBirth },
        });
      } else if (!p.identityId) {
        p = await tx.patient.update({ where: { id: p.id }, data: { identityId: identity.id } });
      }
      return p;
    });
    await db.patientLink.upsert({ where: { identityId_tenantId: { identityId: identity.id, tenantId } }, update: { patientId: rec.id }, create: { identityId: identity.id, tenantId, patientId: rec.id } });
    if (!identity.fullName) await db.identity.update({ where: { id: identity.id }, data: { fullName: rec.fullName } });
    return reply.code(201).send({ tenantId, patientId: rec.id, patientNo: rec.patientNo, fullName: rec.fullName });
  });

  app.get("/patient/appointments", { preHandler: patientGuard }, async (req) => {
    const links = await db.patientLink.findMany({ where: { identityId: patient(req).sub }, include: { tenant: true } });
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const today = dayRange(todayIst());
    const lists = await Promise.all(
      links.map((l) =>
        withTenant(db, l.tenantId, async (tx) => {
          const rows = await tx.appointment.findMany({ where: { patientId: l.patientId, scheduledAt: { gte: since } }, include: { doctor: { select: { id: true, fullName: true } } }, orderBy: { scheduledAt: "asc" } });
          return Promise.all(
            rows.map(async (a) => {
              // People ahead in today's queue with the same doctor (or anyone, when no doctor is assigned).
              const live = a.scheduledAt >= today.from && a.scheduledAt < today.to && ["SCHEDULED", "CHECKED_IN"].includes(a.status) && a.tokenNo !== null;
              const ahead = live
                ? await tx.appointment.count({ where: { scheduledAt: { gte: today.from, lt: today.to }, status: { in: ["CHECKED_IN", "IN_PROGRESS"] }, tokenNo: { lt: a.tokenNo! }, ...(a.doctorId ? { doctorId: a.doctorId } : {}) } })
                : null;
              return { ...a, ahead, hospital: { id: l.tenantId, name: l.tenant.name } };
            }),
          );
        }),
      ),
    );
    return lists.flat().sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  });

  app.post("/patient/appointments", { preHandler: patientGuard }, async (req, reply) => {
    const input = patientBookingInput.parse(req.body);
    if (input.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw httpError(400, "Choose a time in the future");
    const link = await db.patientLink.findUnique({ where: { identityId_tenantId: { identityId: patient(req).sub, tenantId: input.tenantId } } });
    if (!link) throw httpError(403, "Register with this hospital first");
    if (input.doctorId && !(await listDoctors(db, input.tenantId)).some((d) => d.id === input.doctorId && d.active)) throw httpError(404, "Doctor not found");
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
    const created = await withTenant(db, input.tenantId, async (tx) => {
      const branch = input.branchId ? await tx.branch.findFirst({ where: { id: input.branchId, active: true } }) : await tx.branch.findFirst({ where: { isMain: true } });
      if (!branch) throw httpError(404, "Branch not found");
      await assertBookable(tx, { tenantId: input.tenantId, doctorId: input.doctorId, branchId: branch.id, scheduledAt: input.scheduledAt, canOverride: false });
      const tokenNo = await nextToken(tx, input.tenantId, branch.code, input.scheduledAt);
      const a = await tx.appointment.create({
        data: { tenantId: input.tenantId, branchId: branch.id, patientId: link.patientId, doctorId: input.doctorId, scheduledAt: input.scheduledAt, channel: input.channel, reason: input.reason, tokenNo },
      });
      await confirmAppointment(tx, tenant, a);
      return a;
    });
    return reply.code(201).send(created);
  });

  app.post("/patient/appointments/:tenantId/:id/cancel", { preHandler: patientGuard }, async (req) => {
    const { tenantId, id } = z.object({ tenantId: z.string().uuid(), id: z.string().uuid() }).parse(req.params);
    const link = await db.patientLink.findUnique({ where: { identityId_tenantId: { identityId: patient(req).sub, tenantId } } });
    if (!link) throw httpError(403, "Not allowed");
    return withTenant(db, tenantId, async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, patientId: link.patientId } });
      if (!a) throw httpError(404, "Appointment not found");
      if (a.status !== "SCHEDULED") throw httpError(409, "Only scheduled appointments can be cancelled");
      return tx.appointment.update({ where: { id }, data: { status: "CANCELLED" } });
    });
  });

  // A patient pays their own bill online from the app.
  app.post("/patient/invoices/:tenantId/:id/payment-link", { preHandler: patientGuard }, async (req, reply) => {
    if (!gateway) throw httpError(503, "Online payments are not available at this hospital yet");
    const { tenantId, id } = z.object({ tenantId: z.string().uuid(), id: z.string().uuid() }).parse(req.params);
    const link = await db.patientLink.findUnique({ where: { identityId_tenantId: { identityId: patient(req).sub, tenantId } }, include: { tenant: true } });
    if (!link) throw httpError(403, "Not allowed");
    return withTenant(db, tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, patientId: link.patientId }, include: { patient: true } });
      if (!inv) throw httpError(404, "Bill not found");
      const due = inv.totalPaise - inv.paidPaise;
      if (inv.status === "VOID" || inv.status === "REFUNDED" || due <= 0) throw httpError(409, "Nothing is due on this bill");
      const pl = await gateway.createPaymentLink({
        amountPaise: due, reference: inv.id, description: `${link.tenant.name} bill ${inv.invoiceNo}`, customerName: inv.patient?.fullName,
        customerPhone: inv.patient?.phone ? `+91${inv.patient.phone}` : undefined, notes: { tenantId, invoiceId: inv.id },
      });
      await tx.paymentLink.create({ data: { tenantId, invoiceId: inv.id, gatewayRef: pl.gatewayRef, url: pl.url, amountPaise: due } });
      return reply.code(201).send({ url: pl.url, amountPaise: due });
    });
  });

  // Bills and receipts across all of the patient's hospitals.
  app.get("/patient/invoices", { preHandler: patientGuard }, async (req) => {
    const links = await db.patientLink.findMany({ where: { identityId: patient(req).sub }, include: { tenant: true } });
    const lists = await Promise.all(
      links.map((l) =>
        withTenant(db, l.tenantId, async (tx) => {
          const rows = await tx.invoice.findMany({ where: { patientId: l.patientId }, include: { lines: true, payments: true }, orderBy: { createdAt: "desc" }, take: 30 });
          return rows.map((i) => ({ ...i, hospital: { id: l.tenantId, name: l.tenant.name } }));
        }),
      ),
    );
    return lists.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });

  // Prescriptions from completed visits and released lab reports, across the patient's hospitals.
  app.get("/patient/records", { preHandler: patientGuard }, async (req) => {
    const links = await db.patientLink.findMany({ where: { identityId: patient(req).sub }, include: { tenant: true } });
    const parts = await Promise.all(
      links.map((l) =>
        withTenant(db, l.tenantId, async (tx) => {
          const hospital = { id: l.tenantId, name: l.tenant.name };
          const consultations = await tx.consultation.findMany({
            where: { patientId: l.patientId, completedAt: { not: null } },
            include: { items: true, doctor: { select: { fullName: true } } },
            orderBy: { completedAt: "desc" },
            take: 20,
          });
          const labReports = await tx.labOrder.findMany({
            where: { patientId: l.patientId, status: "RELEASED" },
            include: { items: { orderBy: { testName: "asc" } } },
            orderBy: { releasedAt: "desc" },
            take: 20,
          });
          return {
            consultations: consultations.map((c) => ({ id: c.id, date: c.completedAt, hospital, doctor: c.doctor?.fullName ?? null, diagnosis: c.diagnosis, advice: c.advice, followUpOn: c.followUpOn, vitals: c.vitals, items: c.items })),
            labReports: labReports.map((o) => ({ id: o.id, orderNo: o.orderNo, date: o.releasedAt, hospital, items: o.items })),
          };
        }),
      ),
    );
    return {
      consultations: parts.flatMap((p) => p.consultations).sort((a, b) => +new Date(b.date!) - +new Date(a.date!)),
      labReports: parts.flatMap((p) => p.labReports).sort((a, b) => +new Date(b.date!) - +new Date(a.date!)),
    };
  });

  // Language for automated messages, applied to the patient's record at every linked hospital.
  app.patch("/patient/language", { preHandler: patientGuard }, async (req) => {
    const { language } = z.object({ language: languageSchema }).parse(req.body);
    const links = await db.patientLink.findMany({ where: { identityId: patient(req).sub } });
    await Promise.all(links.map((l) => withTenant(db, l.tenantId, (tx) => tx.patient.update({ where: { id: l.patientId }, data: { language } }))));
    return { language };
  });

  app.get("/patient/cards", { preHandler: patientGuard }, async (req) => {
    const links = await db.patientLink.findMany({ where: { identityId: patient(req).sub }, include: { tenant: true } });
    const out = await Promise.all(
      links.map((l) =>
        withTenant(db, l.tenantId, async (tx) => {
          const m = await tx.healthCardMember.findUnique({ where: { tenantId_patientId: { tenantId: l.tenantId, patientId: l.patientId } }, include: { card: { include: { plan: true, members: { include: { patient: true } } } } } });
          if (!m) return null;
          const coverage = await coverageFor(tx, l.tenantId, l.patientId);
          return {
            hospital: { id: l.tenantId, name: l.tenant.name },
            cardNo: m.card.cardNo,
            planName: m.card.plan.name,
            type: m.card.plan.type,
            members: m.card.members.map((x) => x.patient.fullName),
            coverage,
          };
        }),
      ),
    );
    return out.filter(Boolean);
  });
}
