import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { hasPermission, inScope } from "../authz";
import { featureGate } from "../gates";
import { staff, staffGuard, startOfDay, todayIst } from "../guards";
import { istDay } from "../billing";
import { doctorStatement } from "../payouts";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The people side: who is on duty, who turned up, who is on leave, and what each doctor is owed. Gated as the "workforce" feature. */
export default async function workforceRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "workforce");
  const self = { preHandler: [gate, staffGuard("patients:read")] };
  const read = { preHandler: [gate, staffGuard("roster:read")] };
  const manage = { preHandler: [gate, staffGuard("roster:manage")] };
  const pRead = { preHandler: [gate, staffGuard("payouts:read")] };
  const pManage = { preHandler: [gate, staffGuard("payouts:manage")] };
  const names = async (ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
  const isMember = async (tenantId: string, identityId: string) => (await db.tenantMembership.count({ where: { tenantId, identityId } })) > 0;

  // ── roster ──
  app.get("/roster", read, async (req) => {
    const q = z.object({ from: ymd.optional(), days: z.coerce.number().int().min(1).max(31).default(7) }).parse(req.query);
    const from = q.from ?? todayIst();
    const tenantId = staff(req).tid;
    const shifts = await withTenant(db, tenantId, (tx) => tx.shift.findMany({ where: { ...inScope(req), date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(from, q.days)}T00:00:00Z`) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }));
    const leave = await withTenant(db, tenantId, (tx) => tx.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lt: new Date(`${addDays(from, q.days)}T00:00:00Z`) }, toDate: { gte: new Date(`${from}T00:00:00Z`) } } }));
    const team = await db.tenantMembership.findMany({ where: { tenantId }, include: { identity: { select: { id: true, fullName: true } } } });
    const people = [...new Map(team.map((m) => [m.identityId, { id: m.identityId, name: m.identity.fullName, roles: team.filter((x) => x.identityId === m.identityId).map((x) => x.role) }])).values()];
    return { from, days: q.days, people, shifts: shifts.map((s) => ({ id: s.id, identityId: s.identityId, date: s.date.toISOString().slice(0, 10), startTime: s.startTime, endTime: s.endTime, kind: s.kind })), leave: leave.map((l) => ({ identityId: l.identityId, from: l.fromDate.toISOString().slice(0, 10), to: l.toDate.toISOString().slice(0, 10), kind: l.kind })) };
  });

  app.post("/roster/shifts", manage, async (req, reply) => {
    const i = z.object({ identityId: z.string().uuid(), date: ymd, startTime: hhmm, endTime: hhmm, kind: z.enum(["DAY", "EVENING", "NIGHT", "ON_CALL"]).default("DAY") }).parse(req.body);
    const tenantId = staff(req).tid;
    if (!(await isMember(tenantId, i.identityId))) throw httpError(404, "That person is not on the staff");
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      const d = new Date(`${i.date}T00:00:00Z`);
      if (await tx.leaveRequest.findFirst({ where: { identityId: i.identityId, status: "APPROVED", fromDate: { lte: d }, toDate: { gte: d } } })) throw httpError(409, "They are on approved leave that day");
      return tx.shift.create({ data: { tenantId, branchId: req.access!.branchId, identityId: i.identityId, date: d, startTime: i.startTime, endTime: i.endTime, kind: i.kind, createdBy: staff(req).sub } })
        .catch((e) => { if ((e as { code?: string }).code === "P2002") throw httpError(409, "They already have a shift starting then"); throw e; });
    }));
  });
  app.delete("/roster/shifts/:id", manage, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => { if (!(await tx.shift.findFirst({ where: { id, ...inScope(req) } }))) throw httpError(404, "Shift not found"); await tx.shift.delete({ where: { id } }); return { removed: true }; });
  });

  // ── attendance ──
  const today = () => new Date(`${todayIst()}T00:00:00Z`);
  app.get("/attendance/me", self, async (req) => withTenant(db, staff(req).tid, async (tx) => {
    const a = await tx.attendance.findUnique({ where: { tenantId_identityId_date: { tenantId: staff(req).tid, identityId: staff(req).sub, date: today() } } });
    return { checkedIn: !!a && !a.checkOutAt, checkInAt: a?.checkInAt ?? null, checkOutAt: a?.checkOutAt ?? null };
  }));
  app.post("/attendance/punch", self, async (req) => {
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx: TenantTx) => {
      const where = { tenantId_identityId_date: { tenantId, identityId: staff(req).sub, date: today() } };
      const a = await tx.attendance.findUnique({ where });
      const now = new Date();
      if (!a) { await tx.attendance.create({ data: { tenantId, branchId: req.access!.branchId, identityId: staff(req).sub, date: today(), checkInAt: now } }); return { checkedIn: true, at: now }; }
      if (a.checkOutAt) throw httpError(409, "You have already signed out for today");
      await tx.attendance.update({ where, data: { checkOutAt: now } });
      return { checkedIn: false, at: now };
    });
  });
  // Rostered against turned up: who is absent, who is late.
  app.get("/attendance", read, async (req) => {
    const date = z.object({ date: ymd.default(todayIst()) }).parse(req.query).date;
    const d = new Date(`${date}T00:00:00Z`);
    const { shifts, marks, leave } = await withTenant(db, staff(req).tid, async (tx) => ({ shifts: await tx.shift.findMany({ where: { ...inScope(req), date: d } }), marks: await tx.attendance.findMany({ where: { ...inScope(req), date: d } }), leave: await tx.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: d }, toDate: { gte: d } } }) }));
    const who = await names([...shifts.map((s) => s.identityId), ...marks.map((m) => m.identityId)]);
    const rows = new Map<string, { identityId: string; name: string | null; shift: string | null; checkInAt: Date | null; checkOutAt: Date | null; state: string; lateMinutes: number }>();
    for (const s of shifts) {
      const m = marks.find((x) => x.identityId === s.identityId);
      const due = new Date(`${date}T${s.startTime}:00+05:30`);
      const late = m ? Math.max(0, Math.round((m.checkInAt.getTime() - due.getTime()) / 60_000)) : 0;
      const onLeave = leave.some((l) => l.identityId === s.identityId);
      const state = onLeave ? "LEAVE" : m ? (late > 15 ? "LATE" : "PRESENT") : Date.now() > due.getTime() + 15 * 60_000 ? "ABSENT" : "EXPECTED";
      rows.set(s.identityId, { identityId: s.identityId, name: who.get(s.identityId) ?? null, shift: `${s.startTime}-${s.endTime}`, checkInAt: m?.checkInAt ?? null, checkOutAt: m?.checkOutAt ?? null, state, lateMinutes: late });
    }
    for (const m of marks) if (!rows.has(m.identityId)) rows.set(m.identityId, { identityId: m.identityId, name: who.get(m.identityId) ?? null, shift: null, checkInAt: m.checkInAt, checkOutAt: m.checkOutAt, state: "UNROSTERED", lateMinutes: 0 });
    const list = [...rows.values()];
    return { date, summary: Object.fromEntries(["PRESENT", "LATE", "ABSENT", "EXPECTED", "LEAVE", "UNROSTERED"].map((k) => [k, list.filter((r) => r.state === k).length])), rows: list };
  });

  // ── leave ──
  app.post("/leave", self, async (req, reply) => {
    const i = z.object({ fromDate: ymd, toDate: ymd, kind: z.enum(["CASUAL", "SICK", "EARNED", "OTHER"]), reason: z.string().trim().max(300).optional() }).parse(req.body);
    if (i.toDate < i.fromDate) throw httpError(400, "The last day cannot be before the first");
    const tenantId = staff(req).tid;
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      const d = { gte: new Date(`${i.fromDate}T00:00:00Z`), lte: new Date(`${i.toDate}T00:00:00Z`) };
      if (await tx.leaveRequest.findFirst({ where: { identityId: staff(req).sub, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: d.lte }, toDate: { gte: d.gte } } })) throw httpError(409, "You already have leave in those days");
      return tx.leaveRequest.create({ data: { tenantId, identityId: staff(req).sub, fromDate: d.gte, toDate: d.lte, kind: i.kind, reason: i.reason } });
    }));
  });
  app.get("/leave", self, async (req) => {
    const q = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(), mine: z.coerce.boolean().optional() }).parse(req.query);
    const all = hasPermission(req, "roster:read") && !q.mine;
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.leaveRequest.findMany({ where: { ...(all ? {} : { identityId: staff(req).sub }), ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }));
    const who = await names(rows.map((r) => r.identityId));
    return rows.map((r) => ({ ...r, name: who.get(r.identityId) ?? null }));
  });
  app.post("/leave/:id/decide", manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const l = await tx.leaveRequest.findUnique({ where: { id } });
      if (!l) throw httpError(404, "Leave request not found");
      if (l.status !== "PENDING") throw httpError(409, `This request is already ${l.status.toLowerCase()}`);
      if (l.identityId === staff(req).sub) throw httpError(403, "You cannot decide your own leave");
      return tx.leaveRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedBy: staff(req).sub, decidedAt: new Date() } });
    });
  });
  app.post("/leave/:id/cancel", self, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const l = await tx.leaveRequest.findFirst({ where: { id, identityId: staff(req).sub } });
      if (!l) throw httpError(404, "Leave request not found");
      if (!["PENDING", "APPROVED"].includes(l.status)) throw httpError(409, "Nothing to cancel");
      return tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    });
  });

  // ── doctor revenue share ──
  app.get("/payouts/shares", pRead, async (req) => {
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.doctorShare.findMany({ orderBy: [{ doctorId: "asc" }, { source: "asc" }, { effectiveFrom: "desc" }] }));
    const who = await names(rows.map((r) => r.doctorId));
    return rows.map((r) => ({ id: r.id, doctorId: r.doctorId, doctor: who.get(r.doctorId) ?? null, source: r.source, percent: r.basisPoints / 100, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10) }));
  });
  // A new rate is a new row from a date; earlier statements keep the rate that applied then.
  app.put("/payouts/shares", pManage, async (req) => {
    const i = z.object({ doctorId: z.string().uuid(), source: z.enum(["CONSULTATION", "IPD"]), percent: z.number().min(0).max(100), effectiveFrom: ymd }).parse(req.body);
    const tenantId = staff(req).tid;
    if ((await db.tenantMembership.count({ where: { tenantId, identityId: i.doctorId, role: "DOCTOR" } })) === 0) throw httpError(400, "Choose a doctor from this hospital");
    const data = { basisPoints: Math.round(i.percent * 100), createdBy: staff(req).sub };
    return withTenant(db, tenantId, (tx) => tx.doctorShare.upsert({ where: { tenantId_doctorId_source_effectiveFrom: { tenantId, doctorId: i.doctorId, source: i.source, effectiveFrom: new Date(i.effectiveFrom) } }, create: { tenantId, doctorId: i.doctorId, source: i.source, effectiveFrom: new Date(i.effectiveFrom), ...data }, update: data }));
  });

  app.get("/payouts/statement", pRead, async (req) => {
    const { period: p } = z.object({ period: period.default(todayIst().slice(0, 7)) }).parse(req.query);
    const tenantId = staff(req).tid;
    const approved = await withTenant(db, tenantId, (tx) => tx.doctorPayout.findMany({ where: { period: p } }));
    return { period: p, doctors: (await doctorStatement(db, tenantId, p)).map((s) => ({ ...s, payout: (() => { const a = approved.find((x) => x.doctorId === s.doctorId); return a ? { id: a.id, status: a.status, sharePaise: a.sharePaise, paidAt: a.paidAt, reference: a.reference } : null; })() })) };
  });
  app.post("/payouts/approve", pManage, async (req, reply) => {
    const i = z.object({ period, doctorId: z.string().uuid() }).parse(req.body);
    const tenantId = staff(req).tid;
    if (i.period >= todayIst().slice(0, 7)) throw httpError(409, "A month can be approved once it has ended");
    const s = (await doctorStatement(db, tenantId, i.period)).find((x) => x.doctorId === i.doctorId);
    if (!s) throw httpError(404, "That doctor has no earnings in that month");
    return reply.code(201).send(await withTenant(db, tenantId, (tx) => tx.doctorPayout.create({ data: { tenantId, doctorId: i.doctorId, period: i.period, grossPaise: s.grossPaise, sharePaise: s.sharePaise, lines: s.lines as never, approvedBy: staff(req).sub } }).catch((e) => { if ((e as { code?: string }).code === "P2002") throw httpError(409, "This month is already approved for that doctor"); throw e; })));
  });
  app.post("/payouts/:id/pay", pManage, async (req) => {
    const { id } = idParam.parse(req.params);
    const { reference } = z.object({ reference: z.string().trim().min(2).max(80) }).parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => {
      const p = await tx.doctorPayout.findUnique({ where: { id } });
      if (!p) throw httpError(404, "Payout not found");
      if (p.status === "PAID") throw httpError(409, "Already paid");
      return tx.doctorPayout.update({ where: { id }, data: { status: "PAID", paidAt: new Date(), reference } });
    });
  });
}
