import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { hasPermission, inScope } from "../authz";
import { effectivePlan, seatLimit } from "@hms/billing-core";
import { featureGate, featuresOf, tenantInfo } from "../gates";
import { dayRange, staff, staffGuard, todayIst } from "../guards";
import { istDay } from "../billing";
import { httpError } from "../util";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Numbers for the dashboard and the reports page. Money is only included for people who may see billing. */
export default async function analyticsRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  // ── the dashboard: today at a glance ──
  app.get("/analytics/overview", { preHandler: staffGuard("patients:read") }, async (req) => {
    const ids = req.access!.branchIds;
    const today = todayIst();
    const t = dayRange(today), y = dayRange(addDays(today, -1));
    const money = hasPermission(req, "billing:read");
    const clinical = hasPermission(req, "appointments:read");
    const pharmacy = hasPermission(req, "pharmacy:read");
    const lab = hasPermission(req, "lab:read");
    return withTenant(db, staff(req).tid, async (tx) => {
      const out: Record<string, unknown> = { date: today, branchViewing: req.access!.viewingAll ? "all" : req.access!.branchCode };

      if (clinical) {
        const rows = await tx.appointment.groupBy({ by: ["status", "channel"], where: { ...inScope(req), scheduledAt: { gte: t.from, lt: t.to } }, _count: { _all: true } });
        const by = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r._count._all, 0);
        const yest = await tx.appointment.count({ where: { ...inScope(req), scheduledAt: { gte: y.from, lt: y.to }, status: { not: "CANCELLED" } } });
        const live = await tx.appointment.findMany({
          where: { ...inScope(req), scheduledAt: { gte: t.from, lt: t.to }, status: { in: ["SCHEDULED", "CHECKED_IN", "IN_PROGRESS"] } },
          include: { patient: { select: { id: true, fullName: true, patientNo: true, dateOfBirth: true } }, doctor: { select: { id: true, fullName: true } }, tele: { select: { status: true, patientJoinedAt: true } } },
          orderBy: [{ scheduledAt: "asc" }], take: 60,
        });
        out["visits"] = {
          total: by(() => true), cancelled: by((r) => r.status === "CANCELLED" || r.status === "NO_SHOW"), completed: by((r) => r.status === "COMPLETED"),
          waiting: by((r) => r.status === "CHECKED_IN"), inConsultation: by((r) => r.status === "IN_PROGRESS"), scheduled: by((r) => r.status === "SCHEDULED"),
          tele: by((r) => r.channel === "TELE" && r.status !== "CANCELLED"), yesterday: yest,
          teleWaiting: live.filter((a) => a.channel === "TELE" && a.tele?.patientJoinedAt && a.tele.status === "WAITING").length,
        };
        out["queue"] = live;
        const week = await tx.$queryRaw<{ day: string; n: bigint }[]>`
          SELECT to_char((scheduled_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) AS n FROM hms.appointments
          WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'CANCELLED' AND scheduled_at >= ${istDay(addDays(today, -6)).from} AND scheduled_at < ${t.to} GROUP BY 1 ORDER BY 1`;
        out["visitsWeek"] = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { day: d, n: num(week.find((w) => w.day === d)?.n) }; });
        out["newPatientsToday"] = await tx.patient.count({ where: { createdAt: { gte: t.from, lt: t.to } } });
        out["totalPatients"] = await tx.patient.count();
      }

      if (money) {
        const [c] = await tx.$queryRaw<{ today: bigint; yday: bigint }[]>`
          SELECT COALESCE(sum(p.amount_paise) FILTER (WHERE p.received_at >= ${t.from} AND p.received_at < ${t.to}), 0) AS today,
                 COALESCE(sum(p.amount_paise) FILTER (WHERE p.received_at >= ${y.from} AND p.received_at < ${y.to}), 0) AS yday
          FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${y.from}`;
        const [b] = await tx.$queryRaw<{ billed: bigint; n: bigint }[]>`SELECT COALESCE(sum(total_paise), 0) AS billed, count(*) AS n FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'VOID' AND created_at >= ${t.from} AND created_at < ${t.to}`;
        const [o] = await tx.$queryRaw<{ due: bigint; n: bigint }[]>`SELECT COALESCE(sum(total_paise - paid_paise), 0) AS due, count(*) AS n FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status IN ('UNPAID', 'PARTIAL')`;
        const days = await tx.$queryRaw<{ day: string; v: bigint }[]>`
          SELECT to_char((p.received_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(p.amount_paise) AS v FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id
          WHERE i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${istDay(addDays(today, -6)).from} AND p.received_at < ${t.to} GROUP BY 1 ORDER BY 1`;
        out["money"] = { collectedPaise: num(c?.today), collectedYesterdayPaise: num(c?.yday), billedPaise: num(b?.billed), bills: num(b?.n), outstandingPaise: num(o?.due), unpaidBills: num(o?.n) };
        out["collectionsWeek"] = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { day: d, paise: num(days.find((w) => w.day === d)?.v) }; });
      }

      const attention: Record<string, number> = {};
      if (lab) {
        attention["labAwaitingResult"] = await tx.labOrder.count({ where: { ...inScope(req), status: { in: ["ORDERED", "COLLECTED"] } } });
        attention["labToRelease"] = await tx.labOrder.count({ where: { ...inScope(req), status: "RESULTED" } });
        attention["criticalResults"] = await tx.labOrderItem.count({ where: { flag: { in: ["CRITICAL_LOW", "CRITICAL_HIGH"] }, order: { ...inScope(req), status: { in: ["RESULTED", "RELEASED"] }, createdAt: { gte: new Date(Date.now() - 2 * DAY) } } } });
      }
      if (pharmacy) {
        const [s] = await tx.$queryRaw<{ low: bigint; soon: bigint; expired: bigint }[]>`
          SELECT (SELECT count(*) FROM hms.medicines m WHERE m.active AND COALESCE((SELECT sum(qty_on_hand) FROM hms.stock_batches b WHERE b.medicine_id = m.id AND b.branch_id = ANY(${ids}::uuid[]) AND b.expiry_date > CURRENT_DATE), 0) <= m.reorder_level) AS low,
                 (SELECT count(*) FROM hms.stock_batches WHERE branch_id = ANY(${ids}::uuid[]) AND qty_on_hand > 0 AND expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + 60) AS soon,
                 (SELECT count(*) FROM hms.stock_batches WHERE branch_id = ANY(${ids}::uuid[]) AND qty_on_hand > 0 AND expiry_date <= CURRENT_DATE) AS expired`;
        attention["lowStock"] = num(s?.low); attention["expiringSoon"] = num(s?.soon); attention["expiredStock"] = num(s?.expired);
      }
      attention["openTasks"] = await tx.task.count({ where: { status: "OPEN", assignedTo: staff(req).sub } });
      attention["overdueTasks"] = await tx.task.count({ where: { status: "OPEN", assignedTo: staff(req).sub, dueAt: { lt: new Date() } } });
      out["attention"] = attention;
      return out;
    });
  });

  // ── the organization admin's own view: people, access and how the organization is doing ──
  app.get("/analytics/organization", { preHandler: staffGuard("team:manage") }, async (req) => {
    const tid = staff(req).tid;
    const week = new Date(Date.now() - 7 * DAY), month = new Date(Date.now() - 30 * DAY);
    const members = await db.tenantMembership.findMany({ where: { tenantId: tid }, include: { identity: { select: { id: true, fullName: true, phone: true } } } });
    const people = [...new Set(members.map((m) => m.identityId))];
    const sessions = await db.refreshToken.groupBy({ by: ["identityId"], where: { tenantId: tid, kind: "staff", identityId: { in: people } }, _max: { createdAt: true } });
    const lastIn = new Map(sessions.map((x) => [x.identityId, x._max.createdAt]));
    const t = await tenantInfo(db, tid);
    const fails = await db.systemLog.count({ where: { tenantId: tid, level: "SECURITY", createdAt: { gte: week } } });
    const roles = await db.tenantRole.findMany({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } });
    const policies = await db.tenantPolicy.findMany({ where: { tenantId: tid }, select: { enabled: true } });
    const out = await withTenant(db, tid, async (tx) => {
      const changes = await tx.auditLog.findMany({ where: { entity: "access", createdAt: { gte: month } }, orderBy: { createdAt: "desc" }, take: 8 });
      const branchRows = await tx.$queryRaw<{ code: string; name: string; visits: bigint; billed: bigint }[]>`
        SELECT b.code, b.name, (SELECT count(*) FROM hms.appointments a WHERE a.branch_id = b.id AND a.status <> 'CANCELLED' AND a.scheduled_at >= ${month}) AS visits,
               (SELECT COALESCE(sum(i.total_paise), 0) FROM hms.invoices i WHERE i.branch_id = b.id AND i.status <> 'VOID' AND i.created_at >= ${month}) AS billed FROM hms.branches b ORDER BY b.code`;
      const [active] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT actor_identity_id) AS n FROM hms.audit_logs WHERE created_at >= ${week} AND actor_identity_id IS NOT NULL`;
      return { changes, branchRows, active: num(active?.n) };
    });
    const who = new Map((await db.identity.findMany({ where: { id: { in: out.changes.map((c) => c.actorIdentityId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
    const byRole = roles.map((r) => ({ key: r.key, name: r.name, system: r.isSystem, permissions: r.permissions.includes("*") ? "all" : r.permissions.length, people: members.filter((m) => m.role === r.key).length }));
    const idle = people.filter((id) => { const l = lastIn.get(id); return !l || l < month; });
    return {
      seats: { used: people.length, limit: seatLimit(effectivePlan(t), t.maxSeats) },
      people: { total: people.length, activeLast7d: out.active, neverSignedIn: people.filter((id) => !lastIn.has(id)).length, idle30d: idle.length,
        idleList: idle.slice(0, 8).map((id) => { const m = members.find((x) => x.identityId === id)!; return { id, name: m.identity.fullName, phone: `••••${m.identity.phone.slice(-4)}`, lastSignIn: lastIn.get(id) ?? null, roles: members.filter((x) => x.identityId === id).map((x) => x.role) }; }) },
      access: { roles: byRole, customRoles: roles.filter((r) => !r.isSystem).length, policies: policies.length, policiesOn: policies.filter((p) => p.enabled).length },
      security: { eventsLast7d: fails },
      recentAccessChanges: out.changes.map((c) => ({ id: c.id, action: c.action, by: c.actorIdentityId ? who.get(c.actorIdentityId) ?? null : null, at: c.createdAt })),
      branches: out.branchRows.map((b) => ({ code: b.code, name: b.name, visits30d: num(b.visits), billed30dPaise: num(b.billed) })),
      modules: featuresOf(t),
    };
  });

  // ── the reports page ──
  app.get("/analytics/report", { preHandler: [featureGate(db, "reports"), staffGuard("reports:read")] }, async (req) => {
    const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query);
    const to = q.to ?? todayIst();
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw httpError(400, "The start date must not be after the end date");
    if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY > 400) throw httpError(400, "Choose a range of up to 13 months");
    const ids = req.access!.branchIds;
    const A = istDay(from).from, Z = istDay(to).to;
    const money = hasPermission(req, "billing:read");
    return withTenant(db, staff(req).tid, async (tx) => {
      const days: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const fill = <T extends { day: string }>(rows: T[], zero: Omit<T, "day">) => days.map((d) => rows.find((r) => r.day === d) ?? ({ day: d, ...zero } as T));
      const out: Record<string, unknown> = { from, to, days: days.length, branches: req.access!.viewingAll ? req.access!.allowed.map((b) => b.code) : [req.access!.branchCode] };

      // visits
      const status = await tx.appointment.groupBy({ by: ["status"], where: { branchId: { in: ids }, scheduledAt: { gte: A, lt: Z } }, _count: { _all: true } });
      const channel = await tx.appointment.groupBy({ by: ["channel"], where: { branchId: { in: ids }, scheduledAt: { gte: A, lt: Z }, status: { not: "CANCELLED" } }, _count: { _all: true } });
      const perDay = await tx.$queryRaw<{ day: string; booked: bigint; completed: bigint }[]>`
        SELECT to_char((scheduled_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) FILTER (WHERE status <> 'CANCELLED') AS booked, count(*) FILTER (WHERE status = 'COMPLETED') AS completed
        FROM hms.appointments WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} GROUP BY 1 ORDER BY 1`;
      const byHour = await tx.$queryRaw<{ hour: number; n: bigint }[]>`
        SELECT extract(hour FROM scheduled_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, count(*) AS n FROM hms.appointments
        WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} AND status <> 'CANCELLED' GROUP BY 1 ORDER BY 1`;
      const byWeekday = await tx.$queryRaw<{ wd: number; n: bigint }[]>`
        SELECT extract(dow FROM scheduled_at AT TIME ZONE 'Asia/Kolkata')::int AS wd, count(*) AS n FROM hms.appointments
        WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} AND status <> 'CANCELLED' GROUP BY 1 ORDER BY 1`;
      const doctors = await tx.$queryRaw<{ doctor_id: string | null; total: bigint; completed: bigint; tele: bigint }[]>`
        SELECT doctor_id, count(*) FILTER (WHERE status <> 'CANCELLED') AS total, count(*) FILTER (WHERE status = 'COMPLETED') AS completed, count(*) FILTER (WHERE channel = 'TELE' AND status <> 'CANCELLED') AS tele
        FROM hms.appointments WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} GROUP BY 1 ORDER BY total DESC LIMIT 15`;
      const names = new Map((await db.identity.findMany({ where: { id: { in: doctors.map((d) => d.doctor_id).filter(Boolean) as string[] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
      const total = status.reduce((a, s) => a + s._count._all, 0);
      out["visits"] = {
        total, byStatus: Object.fromEntries(status.map((s) => [s.status, s._count._all])), byChannel: Object.fromEntries(channel.map((c) => [c.channel, c._count._all])),
        noShowRate: total ? Math.round(((status.find((s) => s.status === "NO_SHOW")?._count._all ?? 0) / total) * 1000) / 10 : 0,
        perDay: fill(perDay.map((r) => ({ day: r.day, booked: num(r.booked), completed: num(r.completed) })), { booked: 0, completed: 0 }),
        byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: num(byHour.find((r) => r.hour === h)?.n) })),
        byWeekday: Array.from({ length: 7 }, (_, d) => ({ weekday: d, n: num(byWeekday.find((r) => r.wd === d)?.n) })),
        byDoctor: doctors.map((d) => ({ doctorId: d.doctor_id, name: d.doctor_id ? names.get(d.doctor_id) ?? "Doctor" : "Unassigned", total: num(d.total), completed: num(d.completed), tele: num(d.tele) })),
      };

      // patients
      const newPerDay = await tx.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) AS n FROM hms.patients WHERE created_at >= ${A} AND created_at < ${Z} GROUP BY 1 ORDER BY 1`;
      const [rep] = await tx.$queryRaw<{ seen: bigint; returning: bigint }[]>`
        SELECT count(*) AS seen, count(*) FILTER (WHERE prior > 0) AS returning FROM (
          SELECT a.patient_id, (SELECT count(*) FROM hms.appointments x WHERE x.patient_id = a.patient_id AND x.status = 'COMPLETED' AND x.scheduled_at < ${A}) AS prior
          FROM hms.appointments a WHERE a.branch_id = ANY(${ids}::uuid[]) AND a.scheduled_at >= ${A} AND a.scheduled_at < ${Z} AND a.status = 'COMPLETED' GROUP BY a.patient_id) s`;
      const ageBands = await tx.$queryRaw<{ band: string; n: bigint }[]>`
        SELECT CASE WHEN date_of_birth IS NULL THEN 'Unknown' WHEN age(date_of_birth) < interval '5 years' THEN '0-4' WHEN age(date_of_birth) < interval '18 years' THEN '5-17'
               WHEN age(date_of_birth) < interval '40 years' THEN '18-39' WHEN age(date_of_birth) < interval '60 years' THEN '40-59' ELSE '60+' END AS band, count(*) AS n
        FROM hms.patients WHERE id IN (SELECT patient_id FROM hms.appointments WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} AND status <> 'CANCELLED') GROUP BY 1`;
      const gender = await tx.$queryRaw<{ g: string | null; n: bigint }[]>`SELECT gender::text AS g, count(*) AS n FROM hms.patients WHERE id IN (SELECT patient_id FROM hms.appointments WHERE branch_id = ANY(${ids}::uuid[]) AND scheduled_at >= ${A} AND scheduled_at < ${Z} AND status <> 'CANCELLED') GROUP BY 1`;
      out["patients"] = {
        total: await tx.patient.count(), newInRange: newPerDay.reduce((a, r) => a + num(r.n), 0), newPerDay: fill(newPerDay.map((r) => ({ day: r.day, n: num(r.n) })), { n: 0 }),
        seen: num(rep?.seen), returning: num(rep?.returning), returningRate: num(rep?.seen) ? Math.round((num(rep?.returning) / num(rep?.seen)) * 1000) / 10 : 0,
        ageBands: ["0-4", "5-17", "18-39", "40-59", "60+", "Unknown"].map((b) => ({ band: b, n: num(ageBands.find((r) => r.band === b)?.n) })),
        gender: gender.map((g) => ({ gender: g.g ?? "Not recorded", n: num(g.n) })),
      };

      // clinical
      const dx = await tx.$queryRaw<{ dx: string; n: bigint }[]>`
        SELECT initcap(lower(trim(c.diagnosis))) AS dx, count(*) AS n FROM hms.consultations c JOIN hms.appointments a ON a.id = c.appointment_id
        WHERE a.branch_id = ANY(${ids}::uuid[]) AND c.completed_at >= ${A} AND c.completed_at < ${Z} AND c.diagnosis IS NOT NULL AND trim(c.diagnosis) <> '' GROUP BY 1 ORDER BY n DESC LIMIT 12`;
      const meds = await tx.$queryRaw<{ name: string; n: bigint }[]>`
        SELECT pi.name, count(*) AS n FROM hms.prescription_items pi JOIN hms.consultations c ON c.id = pi.consultation_id JOIN hms.appointments a ON a.id = c.appointment_id
        WHERE a.branch_id = ANY(${ids}::uuid[]) AND c.completed_at >= ${A} AND c.completed_at < ${Z} GROUP BY 1 ORDER BY n DESC LIMIT 10`;
      out["clinical"] = { topDiagnoses: dx.map((d) => ({ name: d.dx, n: num(d.n) })), topMedicines: meds.map((m) => ({ name: m.name, n: num(m.n) })) };

      // lab
      const labStatus = await tx.labOrder.groupBy({ by: ["status"], where: { branchId: { in: ids }, createdAt: { gte: A, lt: Z } }, _count: { _all: true } });
      const topTests = await tx.$queryRaw<{ name: string; n: bigint; abnormal: bigint }[]>`
        SELECT i.test_name AS name, count(*) AS n, count(*) FILTER (WHERE i.flag IS NOT NULL AND i.flag <> 'NORMAL') AS abnormal FROM hms.lab_order_items i JOIN hms.lab_orders o ON o.id = i.order_id
        WHERE o.branch_id = ANY(${ids}::uuid[]) AND o.created_at >= ${A} AND o.created_at < ${Z} AND o.status <> 'CANCELLED' GROUP BY 1 ORDER BY n DESC LIMIT 10`;
      const [tat] = await tx.$queryRaw<{ hours: number | null }[]>`SELECT round((avg(extract(epoch FROM (released_at - created_at)) / 3600))::numeric, 1)::float AS hours FROM hms.lab_orders WHERE branch_id = ANY(${ids}::uuid[]) AND released_at >= ${A} AND released_at < ${Z}`;
      out["lab"] = { orders: labStatus.reduce((a, s) => a + s._count._all, 0), byStatus: Object.fromEntries(labStatus.map((s) => [s.status, s._count._all])), turnaroundHours: tat?.hours ?? null, topTests: topTests.map((t) => ({ name: t.name, n: num(t.n), abnormal: num(t.abnormal) })) };

      // money
      if (money) {
        const billed = await tx.$queryRaw<{ day: string; billed: bigint; collected: bigint }[]>`
          SELECT d.day, COALESCE(b.billed, 0) AS billed, COALESCE(c.collected, 0) AS collected FROM (SELECT to_char(g, 'YYYY-MM-DD') AS day FROM generate_series(${from}::date, ${to}::date, interval '1 day') g) d
          LEFT JOIN (SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(total_paise) AS billed FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'VOID' AND created_at >= ${A} AND created_at < ${Z} GROUP BY 1) b ON b.day = d.day
          LEFT JOIN (SELECT to_char((p.received_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(p.amount_paise) AS collected FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${A} AND p.received_at < ${Z} GROUP BY 1) c ON c.day = d.day ORDER BY d.day`;
        const bySource = await tx.$queryRaw<{ source: string; total: bigint; n: bigint }[]>`SELECT source::text AS source, sum(total_paise) AS total, count(*) AS n FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'VOID' AND created_at >= ${A} AND created_at < ${Z} GROUP BY 1 ORDER BY total DESC`;
        const byMethod = await tx.$queryRaw<{ method: string; total: bigint }[]>`SELECT p.method::text AS method, sum(p.amount_paise) AS total FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${A} AND p.received_at < ${Z} GROUP BY 1 ORDER BY total DESC`;
        const [ref] = await tx.$queryRaw<{ total: bigint | null }[]>`SELECT sum(r.amount_paise) AS total FROM hms.refunds r JOIN hms.invoices i ON i.id = r.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND r.created_at >= ${A} AND r.created_at < ${Z}`;
        const byBranch = await tx.$queryRaw<{ code: string; billed: bigint; n: bigint }[]>`SELECT b.code, COALESCE(sum(i.total_paise), 0) AS billed, count(i.id) AS n FROM hms.branches b LEFT JOIN hms.invoices i ON i.branch_id = b.id AND i.status <> 'VOID' AND i.created_at >= ${A} AND i.created_at < ${Z} WHERE b.id = ANY(${ids}::uuid[]) GROUP BY 1 ORDER BY billed DESC`;
        const [aging] = await tx.$queryRaw<{ d0: bigint; d7: bigint; d30: bigint }[]>`
          SELECT COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS d0, COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at < now() - interval '7 days' AND created_at >= now() - interval '30 days'), 0) AS d7,
                 COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at < now() - interval '30 days'), 0) AS d30 FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status IN ('UNPAID', 'PARTIAL')`;
        const series = billed.map((r) => ({ day: r.day, billed: num(r.billed), collected: num(r.collected) }));
        out["money"] = {
          billedPaise: series.reduce((a, r) => a + r.billed, 0), collectedPaise: series.reduce((a, r) => a + r.collected, 0), refundedPaise: num(ref?.total), series,
          bySource: bySource.map((s) => ({ source: s.source, totalPaise: num(s.total), bills: num(s.n) })), byMethod: byMethod.map((m) => ({ method: m.method, totalPaise: num(m.total) })),
          byBranch: byBranch.map((b) => ({ code: b.code, billedPaise: num(b.billed), bills: num(b.n) })), outstanding: { under7Paise: num(aging?.d0), under30Paise: num(aging?.d7), over30Paise: num(aging?.d30) },
        };
      }
      return out;
    });
  });
}
