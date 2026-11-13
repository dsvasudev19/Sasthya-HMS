import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { platformGuard } from "../guards";
import { httpError } from "../util";

const DAY = 86_400_000;
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const days = z.object({ days: z.coerce.number().int().min(1).max(180).default(30) });
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const dayList = (n: number) => Array.from({ length: n }, (_, i) => ist(new Date(Date.now() - (n - 1 - i) * DAY)));

/** How each organisation is using the platform. Operator-only; every number is read inside that organisation's own tenant scope. */
export default async function platformAnalyticsRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", platformGuard);

  // ── one organisation ──
  app.get("/platform/tenants/:id/analytics", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { days: n } = days.parse(req.query);
    const tenant = await db.tenant.findUnique({ where: { id }, select: { id: true, name: true, kind: true, status: true, createdAt: true } });
    if (!tenant) throw httpError(404, "Organization not found");
    const since = new Date(Date.now() - n * DAY), weekAgo = new Date(Date.now() - 7 * DAY);
    const labels = dayList(n);
    const fill = <T extends { day: string }>(rows: T[], zero: Omit<T, "day">) => labels.map((d) => rows.find((r) => r.day === d) ?? ({ day: d, ...zero } as T));

    const h = await withTenant(db, id, async (tx) => {
      const [patients, newPatients, booked, completed, tele, docs, msgs, labOrders, openTasks, branches] = await Promise.all([
        tx.patient.count(), tx.patient.count({ where: { createdAt: { gte: since } } }),
        tx.appointment.count({ where: { scheduledAt: { gte: since }, status: { not: "CANCELLED" } } }), tx.appointment.count({ where: { scheduledAt: { gte: since }, status: "COMPLETED" } }),
        tx.teleSession.count({ where: { createdAt: { gte: since } } }), tx.patientDocument.count({ where: { createdAt: { gte: since } } }),
        tx.message.count({ where: { createdAt: { gte: since }, status: "SENT" } }), tx.labOrder.count({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" } } }),
        tx.task.count({ where: { status: "OPEN" } }), tx.branch.count(),
      ]);
      const [money] = await tx.$queryRaw<{ billed: bigint; pharmacy: bigint; bills: bigint }[]>`
        SELECT COALESCE(sum(total_paise), 0) AS billed, COALESCE(sum(total_paise) FILTER (WHERE source = 'PHARMACY'), 0) AS pharmacy, count(*) AS bills
        FROM hms.invoices WHERE status <> 'VOID' AND created_at >= ${since}`;
      const [coll] = await tx.$queryRaw<{ v: bigint }[]>`SELECT COALESCE(sum(amount_paise), 0) AS v FROM hms.payments WHERE received_at >= ${since}`;
      const visitsDay = await tx.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char((scheduled_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) AS n FROM hms.appointments WHERE scheduled_at >= ${since} AND status <> 'CANCELLED' GROUP BY 1`;
      const billedDay = await tx.$queryRaw<{ day: string; v: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(total_paise) AS v FROM hms.invoices WHERE status <> 'VOID' AND created_at >= ${since} GROUP BY 1`;
      const patientsDay = await tx.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) AS n FROM hms.patients WHERE created_at >= ${since} GROUP BY 1`;
      const activeDay = await tx.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(DISTINCT actor_identity_id) AS n FROM hms.audit_logs WHERE created_at >= ${since} AND actor_identity_id IS NOT NULL GROUP BY 1`;
      const topActions = await tx.$queryRaw<{ action: string; n: bigint }[]>`SELECT action, count(*) AS n FROM hms.audit_logs WHERE created_at >= ${since} GROUP BY 1 ORDER BY n DESC LIMIT 10`;
      const actors = await tx.$queryRaw<{ id: string; n: bigint; last: Date }[]>`SELECT actor_identity_id AS id, count(*) AS n, max(created_at) AS last FROM hms.audit_logs WHERE created_at >= ${since} AND actor_identity_id IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`;
      const [last] = await tx.$queryRaw<{ at: Date | null }[]>`SELECT max(created_at) AS at FROM hms.audit_logs`;
      const [active7] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT actor_identity_id) AS n FROM hms.audit_logs WHERE created_at >= ${weekAgo} AND actor_identity_id IS NOT NULL`;
      return { patients, newPatients, booked, completed, tele, docs, msgs, labOrders, openTasks, branches, money, coll, visitsDay, billedDay, patientsDay, activeDay, topActions, actors, last: last?.at ?? null, active7: num(active7?.n) };
    });

    const staffCount = new Set((await db.tenantMembership.findMany({ where: { tenantId: id }, select: { identityId: true } })).map((m) => m.identityId)).size;
    const names = new Map((await db.identity.findMany({ where: { id: { in: h.actors.map((a) => a.id) } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
    const signIns = await db.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*) AS n FROM platform.refresh_tokens WHERE tenant_id = ${id}::uuid AND kind = 'staff' AND used_at IS NULL AND created_at >= ${since} GROUP BY 1`;
    const logs = await db.systemLog.groupBy({ by: ["level"], where: { tenantId: id, createdAt: { gte: since } }, _count: { _all: true } });
    const overrides = await db.tenantFeatureOverride.findMany({ where: { tenantId: id }, select: { feature: true, enabled: true } });

    return {
      tenant, days: n, lastActivityAt: h.last,
      totals: { patients: h.patients, newPatients: h.newPatients, visitsBooked: h.booked, visitsCompleted: h.completed, billedPaise: num(h.money?.billed), collectedPaise: num(h.coll?.v), pharmacyBilledPaise: num(h.money?.pharmacy), bills: num(h.money?.bills), labOrders: h.labOrders, teleSessions: h.tele, documents: h.docs, messagesSent: h.msgs, openTasks: h.openTasks, branches: h.branches },
      staff: { accounts: staffCount, activeLast7d: h.active7, topActors: h.actors.map((a) => ({ id: a.id, name: names.get(a.id) ?? "Unknown", actions: num(a.n), lastAt: a.last })) },
      series: {
        visits: fill(h.visitsDay.map((r) => ({ day: r.day, n: num(r.n) })), { n: 0 }), billedPaise: fill(h.billedDay.map((r) => ({ day: r.day, v: num(r.v) })), { v: 0 }),
        newPatients: fill(h.patientsDay.map((r) => ({ day: r.day, n: num(r.n) })), { n: 0 }), activeStaff: fill(h.activeDay.map((r) => ({ day: r.day, n: num(r.n) })), { n: 0 }), signIns: fill(signIns.map((r) => ({ day: r.day, n: num(r.n) })), { n: 0 }),
      },
      topActions: h.topActions.map((a) => ({ action: a.action, n: num(a.n) })),
      logs: Object.fromEntries(logs.map((l) => [l.level, l._count._all])), overrides,
    };
  });

  // ── every organisation side by side ──
  app.get("/platform/analytics", async (req) => {
    const { days: n } = days.parse(req.query);
    const since = new Date(Date.now() - n * DAY), weekAgo = new Date(Date.now() - 7 * DAY), dayAgo = new Date(Date.now() - DAY);
    const tenants = await db.tenant.findMany({ orderBy: { createdAt: "desc" } });
    const errs = await db.systemLog.groupBy({ by: ["tenantId"], where: { level: "ERROR", createdAt: { gte: dayAgo }, tenantId: { not: null } }, _count: { _all: true } });
    const rows = await Promise.all(tenants.map(async (t) => {
      const s = await withTenant(db, t.id, async (tx) => {
        const [patients, visits] = await Promise.all([tx.patient.count(), tx.appointment.count({ where: { scheduledAt: { gte: since }, status: { not: "CANCELLED" } } })]);
        const [m] = await tx.$queryRaw<{ billed: bigint }[]>`SELECT COALESCE(sum(total_paise), 0) AS billed FROM hms.invoices WHERE status <> 'VOID' AND created_at >= ${since}`;
        const [a] = await tx.$queryRaw<{ active: bigint; last: Date | null }[]>`SELECT count(DISTINCT actor_identity_id) FILTER (WHERE created_at >= ${weekAgo}) AS active, max(created_at) AS last FROM hms.audit_logs`;
        return { patients, visits, billed: num(m?.billed), active: num(a?.active), last: a?.last ?? null };
      });
      const quiet = !s.last || s.last.getTime() < Date.now() - 14 * DAY;
      return { id: t.id, name: t.name, kind: t.kind, status: t.status, planCode: t.planCode, createdAt: t.createdAt, patients: s.patients, visits: s.visits, billedPaise: s.billed, activeStaff7d: s.active, lastActivityAt: s.last, errors24h: errs.find((e) => e.tenantId === t.id)?._count._all ?? 0, engagement: (t.status === "SUSPENDED" || t.status === "CLOSED" ? "INACTIVE" : quiet ? "DORMANT" : s.active >= 2 ? "ACTIVE" : "LOW") as "ACTIVE" | "LOW" | "DORMANT" | "INACTIVE" };
    }));
    const weeks = Array.from({ length: 12 }, (_, i) => { const end = Date.now() - (11 - i) * 7 * DAY; return { weekEnding: ist(new Date(end)), signups: tenants.filter((t) => t.createdAt.getTime() <= end && t.createdAt.getTime() > end - 7 * DAY).length }; });
    return { days: n, rows, signupsByWeek: weeks, byKind: Object.fromEntries(["HOSPITAL", "CLINIC", "PHARMACY"].map((k) => [k, tenants.filter((t) => t.kind === k).length])), dormant: rows.filter((r) => r.engagement === "DORMANT").length };
  });
}
