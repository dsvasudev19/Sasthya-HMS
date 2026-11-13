import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addMemberInput, createAppointmentInput, createPatientInput, issueCardInput, renewCardInput, updateAppointmentStatusInput,
} from "@hms/contracts";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { securityState } from "../security";
import { httpError } from "../util";
import { checkIn } from "../appointments";
import { assertBookable, nextToken } from "../booking";
import { branchesFor, hasPermission, inScope, permissionsFor } from "../authz";
import { consultationInvoice, createInvoice, voidIfUnpaid } from "../billing";
import { addMonths, applyCoverage, coverageFor, newCardNo, releaseCoverage } from "../cards";
import { dayRange, staff, staffGuard, todayIst } from "../guards";
import { confirmAppointment } from "../notify";
import { featuresOf, tenantInfo } from "../gates";
import { tenantView } from "./auth";
import { patientPatchInput } from "@hms/contracts";

const appointmentInclude = {
  branch: { select: { id: true, code: true, name: true } },
  patient: true,
  doctor: { select: { id: true, fullName: true } },
  invoice: { select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true } },
} as const;

const TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
};


async function cardView(tx: TenantTx, tenantId: string, cardId: string) {
  const card = await tx.healthCard.findUniqueOrThrow({
    where: { id: cardId },
    include: { plan: true, owner: true, members: { include: { patient: true } }, subscriptions: { orderBy: { endsAt: "desc" } } },
  });
  const members = await Promise.all(
    card.members.map(async (m) => ({ patient: m.patient, coverage: await coverageFor(tx, tenantId, m.patientId) })),
  );
  const now = new Date();
  const current = card.subscriptions.find((s) => s.startsAt <= now && s.endsAt > now) ?? null;
  return { ...card, members, activeSubscription: current };
}

export default async function staffRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const tenantPrefix = async (tenantId: string) => (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug.slice(0, 3).toUpperCase();

  app.get("/me", { preHandler: staffGuard("patients:read") }, async (req) => {
    const identity = await db.identity.findUniqueOrThrow({ where: { id: staff(req).sub } });
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: staff(req).tid } });
    return {
      user: { id: identity.id, name: identity.fullName, role: staff(req).role, roles: staff(req).roles },
      tenant: tenantView(featuresOf(await tenantInfo(db, tenant.id)), tenant),
      permissions: await permissionsFor(tenant.id, staff(req).roles, staff(req).sub),
      branches: await branchesFor(staff(req)),
      mustChangePassword: identity.mustChangePassword,
      security: await securityState(tenant.id, identity.id),
    };
  });

  // ── patients ──
  app.get("/patients", { preHandler: staffGuard("patients:read") }, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.patient.findMany({
        where: q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { patientNo: { contains: q, mode: "insensitive" } }] } : {},
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  });

  // Everything the front desk and doctor need about one patient.
  app.get("/patients/:id", { preHandler: staffGuard("patients:read") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const p = await tx.patient.findUnique({ where: { id } });
      if (!p) throw httpError(404, "Patient not found");
      const [coverage, appointments, invoices] = await Promise.all([
        coverageFor(tx, tenantId, id),
        tx.appointment.findMany({ where: { patientId: id }, include: appointmentInclude, orderBy: { scheduledAt: "desc" }, take: 30 }),
        tx.invoice.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, invoiceNo: true, status: true, totalPaise: true, paidPaise: true, createdAt: true } }),
      ]);
      const owed = invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").reduce((a, i) => a + i.totalPaise - i.paidPaise, 0);
      return { ...p, coverage, appointments, invoices, outstandingPaise: owed };
    });
  });

  app.patch("/patients/:id", { preHandler: staffGuard("patients:write") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = patientPatchInput.parse(req.body);
    return withTenant(db, staff(req).tid, (tx) => tx.patient.update({ where: { id }, data: input }));
  });

  app.post("/patients", { preHandler: staffGuard("patients:write") }, async (req, reply) => {
    const input = createPatientInput.parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const patient = await withTenant(db, tenantId, async (tx) => {
      const n = await nextSeq(tx, tenantId, "patient");
      return tx.patient.create({ data: { tenantId, patientNo: `${prefix}-${String(n).padStart(6, "0")}`, ...input } });
    });
    return reply.code(201).send(patient);
  });

  // ── appointments ──
  app.get("/appointments", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayIst()) }).parse(req.query);
    const { from, to } = dayRange(date);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.appointment.findMany({ where: { scheduledAt: { gte: from, lt: to }, ...inScope(req) }, include: appointmentInclude, orderBy: { scheduledAt: "asc" } }),
    );
  });

  app.post("/appointments", { preHandler: staffGuard("appointments:write") }, async (req, reply) => {
    const input = createAppointmentInput.parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const created = await withTenant(db, tenantId, async (tx) => {
      const { branchId, branchCode } = req.access!;
      await assertBookable(tx, { tenantId, doctorId: input.doctorId, branchId, scheduledAt: input.scheduledAt, canOverride: hasPermission(req, "appointments:override_slot") });
      const a = await tx.appointment.create({ data: { tenantId, branchId, tokenNo: await nextToken(tx, tenantId, branchCode, input.scheduledAt), ...input }, include: appointmentInclude });
      await confirmAppointment(tx, tenant, a);
      return a;
    });
    return reply.code(201).send(created);
  });

  app.patch("/appointments/:id", { preHandler: staffGuard("appointments:write") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = updateAppointmentStatusInput.parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = await tenantPrefix(tenantId);
    return withTenant(db, tenantId, async (tx) => {
      const appt = await tx.appointment.findFirst({ where: { id, ...inScope(req) } });
      if (!appt) throw httpError(404, "Appointment not found");
      if (!TRANSITIONS[appt.status]?.includes(status)) throw httpError(409, `Cannot move from ${appt.status} to ${status}`);
      let feeWaived = appt.feeWaived;
      if (status === "CHECKED_IN") return checkIn(tx, appt, { tenantPrefix: prefix, branch: req.access!.allowed.find((b) => b.id === appt.branchId)!, createdBy: staff(req).sub }).then(async (r) => tx.appointment.findUniqueOrThrow({ where: { id: r.id }, include: appointmentInclude }));
      if (status === "CANCELLED" || status === "NO_SHOW") {
        await releaseCoverage(tx, appt.id);
        feeWaived = false;
        // An invoice with money already taken stays open for a manual refund; an unpaid one is voided.
        await voidIfUnpaid(tx, { appointmentId: appt.id });
      }
      return tx.appointment.update({ where: { id }, data: { status, feeWaived }, include: appointmentInclude });
    });
  });

  app.get("/dashboard/today", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const { from, to } = dayRange(todayIst());
    const list = await withTenant(db, staff(req).tid, (tx) =>
      tx.appointment.findMany({ where: { scheduledAt: { gte: from, lt: to }, ...inScope(req) }, include: appointmentInclude, orderBy: { scheduledAt: "asc" } }),
    );
    return { total: list.length, completed: list.filter((a) => a.status === "COMPLETED").length, appointments: list };
  });

  // ── health cards ──
  app.get("/card-plans", { preHandler: staffGuard("cards:read") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.healthCardPlan.findMany({ where: { active: true }, orderBy: { planPricePaise: "asc" } })),
  );

  app.get("/cards", { preHandler: staffGuard("cards:read") }, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const cards = await tx.healthCard.findMany({
        where: q ? { OR: [{ cardNo: { contains: q, mode: "insensitive" } }, { owner: { fullName: { contains: q, mode: "insensitive" } } }, { owner: { phone: { contains: q } } }] } : {},
        include: { plan: true, owner: true, members: true, subscriptions: { orderBy: { endsAt: "desc" }, take: 1 } },
        orderBy: { issuedAt: "desc" },
        take: 50,
      });
      return cards.map((c) => ({ ...c, planEndsAt: c.subscriptions[0]?.endsAt ?? null }));
    });
  });

  // Desk lookup by card number (QR payload) or by patient.
  app.get("/cards/lookup", { preHandler: staffGuard("cards:read") }, async (req, reply) => {
    const { cardNo, patientId } = z.object({ cardNo: z.string().trim().optional(), patientId: z.string().uuid().optional() }).parse(req.query);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      let pid = patientId;
      if (!pid && cardNo) {
        const card = await tx.healthCard.findUnique({ where: { tenantId_cardNo: { tenantId, cardNo: cardNo.toUpperCase() } }, include: { owner: true } });
        if (!card) return reply.code(404).send({ error: "Card not found" });
        return cardView(tx, tenantId, card.id);
      }
      if (!pid) return reply.code(400).send({ error: "cardNo or patientId required" });
      const member = await tx.healthCardMember.findUnique({ where: { tenantId_patientId: { tenantId, patientId: pid } } });
      if (!member) return reply.code(404).send({ error: "Patient has no health card" });
      return cardView(tx, tenantId, member.cardId);
    });
  });

  app.get("/cards/:id", { preHandler: staffGuard("cards:read") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(db, staff(req).tid, (tx) => cardView(tx, staff(req).tid, id));
  });

  app.post("/cards", { preHandler: staffGuard("cards:write") }, async (req, reply) => {
    const input = issueCardInput.parse(req.body);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const memberIds = [...new Set([input.ownerPatientId, ...input.memberPatientIds])];
    const view = await withTenant(db, tenantId, async (tx) => {
      const plan = await tx.healthCardPlan.findFirst({ where: { id: input.planId, active: true } });
      if (!plan) throw httpError(404, "Plan not found");
      if (memberIds.length > plan.maxMembers) throw httpError(400, `This plan covers at most ${plan.maxMembers} member(s)`);
      const patients = await tx.patient.findMany({ where: { id: { in: memberIds } } });
      if (patients.length !== memberIds.length) throw httpError(404, "Patient not found");
      const already = await tx.healthCardMember.findFirst({ where: { patientId: { in: memberIds } }, include: { patient: true } });
      if (already) throw httpError(409, `${already.patient.fullName} already has a health card`);

      const now = new Date();
      const card = await tx.healthCard.create({
        data: { tenantId, cardNo: newCardNo(tenant.slug.slice(0, 3).toUpperCase()), planId: plan.id, ownerPatientId: input.ownerPatientId, issueFeePaise: plan.issueFeePaise },
      });
      await tx.healthCardMember.createMany({ data: memberIds.map((patientId) => ({ tenantId, cardId: card.id, patientId })) });
      await tx.cardSubscription.create({
        data: { tenantId, cardId: card.id, startsAt: now, endsAt: addMonths(now, plan.durationMonths), pricePaise: plan.planPricePaise, paymentMethod: input.paymentMethod, inPersonLimit: plan.inPersonVisits, teleLimit: plan.teleVisits },
      });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "card.issue", entity: "health_card", entityId: card.id, meta: { totalPaise: plan.issueFeePaise + plan.planPricePaise, paymentMethod: input.paymentMethod } } });
      const invoice = await createInvoice(tx, {
        tenantId, tenantPrefix: tenant.slug.slice(0, 3).toUpperCase(), branch: { id: req.access!.branchId, code: req.access!.branchCode }, patientId: input.ownerPatientId, source: "HEALTH_CARD", createdBy: staff(req).sub,
        lines: [
          { kind: "CARD_ISSUE", description: `${plan.name}: card fee`, quantity: 1, unitPaise: plan.issueFeePaise },
          { kind: "CARD_PLAN", description: `${plan.name}: ${plan.durationMonths}-month care plan`, quantity: 1, unitPaise: plan.planPricePaise },
        ],
        payment: { method: input.paymentMethod },
      });
      return { ...(await cardView(tx, tenantId, card.id)), amountDuePaise: plan.issueFeePaise + plan.planPricePaise, invoiceId: invoice.id };
    });
    return reply.code(201).send(view);
  });

  // Renewal: no card fee again, only the plan price. The new period starts when the current one ends.
  app.post("/cards/:id/renew", { preHandler: staffGuard("cards:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { paymentMethod } = renewCardInput.parse(req.body);
    const tenantId = staff(req).tid;
    const view = await withTenant(db, tenantId, async (tx) => {
      const card = await tx.healthCard.findUnique({ where: { id }, include: { plan: true, subscriptions: { orderBy: { endsAt: "desc" }, take: 1 } } });
      if (!card) throw httpError(404, "Card not found");
      if (card.status !== "ACTIVE") throw httpError(409, "Card is blocked");
      const now = new Date();
      const last = card.subscriptions[0]?.endsAt;
      const startsAt = last && last > now ? last : now;
      await tx.cardSubscription.create({
        data: { tenantId, cardId: id, startsAt, endsAt: addMonths(startsAt, card.plan.durationMonths), pricePaise: card.plan.planPricePaise, paymentMethod, inPersonLimit: card.plan.inPersonVisits, teleLimit: card.plan.teleVisits },
      });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "card.renew", entity: "health_card", entityId: id, meta: { pricePaise: card.plan.planPricePaise, paymentMethod } } });
      const invoice = await createInvoice(tx, {
        tenantId, tenantPrefix: await tenantPrefix(tenantId), branch: { id: req.access!.branchId, code: req.access!.branchCode }, patientId: card.ownerPatientId, source: "HEALTH_CARD", createdBy: staff(req).sub,
        lines: [{ kind: "CARD_PLAN", description: `${card.plan.name}: ${card.plan.durationMonths}-month renewal`, quantity: 1, unitPaise: card.plan.planPricePaise }],
        payment: { method: paymentMethod },
      });
      return { ...(await cardView(tx, tenantId, id)), amountDuePaise: card.plan.planPricePaise, invoiceId: invoice.id };
    });
    return reply.code(201).send(view);
  });

  app.post("/cards/:id/members", { preHandler: staffGuard("cards:write") }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { patientId } = addMemberInput.parse(req.body);
    const tenantId = staff(req).tid;
    const view = await withTenant(db, tenantId, async (tx) => {
      const card = await tx.healthCard.findUnique({ where: { id }, include: { plan: true, members: true } });
      if (!card) throw httpError(404, "Card not found");
      if (card.members.length >= card.plan.maxMembers) throw httpError(409, `This card already has ${card.plan.maxMembers} member(s)`);
      if (await tx.healthCardMember.findUnique({ where: { tenantId_patientId: { tenantId, patientId } } })) throw httpError(409, "Patient already has a health card");
      if (!(await tx.patient.findUnique({ where: { id: patientId } }))) throw httpError(404, "Patient not found");
      await tx.healthCardMember.create({ data: { tenantId, cardId: id, patientId } });
      return cardView(tx, tenantId, id);
    });
    return reply.code(201).send(view);
  });
}
