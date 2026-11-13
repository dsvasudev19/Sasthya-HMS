import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { taskInput, taskPatch } from "@hms/contracts";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { effectivePlan, readOnlyReason } from "@hms/billing-core";
import { hasPermission, inScope } from "../authz";
import { featureGate, tenantInfo } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const DAY = 86_400_000;
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export interface Suggestion { key: string; kind: string; title: string; detail: string; href: string; patientId?: string; priority: "NORMAL" | "HIGH" | "URGENT" }

/** Things that need doing, found in the data itself: follow-ups, unpaid bills, slow lab results, expiring cards, missed visits. */
async function findSuggestions(tx: TenantTx, branchIds: string[], can: (p: string) => boolean): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const now = new Date();
  if (can("clinical:read")) {
    const from = new Date(now.getTime() - 7 * DAY), to = new Date(now.getTime() + 3 * DAY);
    const due = await tx.consultation.findMany({ where: { completedAt: { not: null }, followUpOn: { gte: from, lte: to }, appointment: { branchId: { in: branchIds } } }, include: { patient: { select: { id: true, fullName: true, phone: true } } }, take: 30 });
    for (const c of due) {
      if (await tx.appointment.count({ where: { patientId: c.patientId, scheduledAt: { gt: c.completedAt! }, status: { in: ["SCHEDULED", "CHECKED_IN", "IN_PROGRESS"] } } })) continue;
      out.push({ key: `followup:${c.id}`, kind: "FOLLOW_UP", title: `Follow-up due: ${c.patient.fullName}`, detail: `Doctor asked for a visit on ${c.followUpOn!.toISOString().slice(0, 10)}${c.patient.phone ? `. Call ${c.patient.phone}.` : ""}`, href: `/patients/${c.patientId}`, patientId: c.patientId, priority: "NORMAL" });
    }
    const missed = await tx.appointment.findMany({ where: { branchId: { in: branchIds }, status: "NO_SHOW", scheduledAt: { gte: new Date(now.getTime() - 3 * DAY) } }, include: { patient: { select: { id: true, fullName: true, phone: true } } }, take: 20 });
    for (const a of missed) out.push({ key: `noshow:${a.id}`, kind: "NO_SHOW", title: `Missed visit: ${a.patient.fullName}`, detail: `Did not come on ${a.scheduledAt.toISOString().slice(0, 10)}. Offer a new slot.`, href: `/patients/${a.patientId}`, patientId: a.patientId, priority: "NORMAL" });
  }
  if (can("billing:read")) {
    const unpaid = await tx.invoice.findMany({ where: { branchId: { in: branchIds }, status: { in: ["UNPAID", "PARTIAL"] }, patientId: { not: null }, createdAt: { lt: new Date(now.getTime() - 3 * DAY) } }, include: { patient: { select: { id: true, fullName: true, phone: true } } }, orderBy: { totalPaise: "desc" }, take: 15 });
    for (const i of unpaid) out.push({ key: `bill:${i.id}`, kind: "COLLECT", title: `Collect ${rupees(i.totalPaise - i.paidPaise)} from ${i.patient?.fullName ?? "customer"}`, detail: `Bill ${i.invoiceNo} has been open for ${Math.floor((now.getTime() - i.createdAt.getTime()) / DAY)} days.`, href: `/billing`, patientId: i.patientId ?? undefined, priority: i.totalPaise - i.paidPaise >= 500_000 ? "HIGH" : "NORMAL" });
  }
  if (can("lab:read")) {
    const slow = await tx.labOrder.findMany({ where: { branchId: { in: branchIds }, status: { in: ["ORDERED", "COLLECTED"] }, createdAt: { lt: new Date(now.getTime() - DAY) } }, include: { patient: { select: { fullName: true } } }, take: 15 });
    for (const o of slow) out.push({ key: `lab:${o.id}`, kind: "LAB", title: `Lab result pending: ${o.orderNo}`, detail: `${o.patient.fullName}'s order is over a day old and not resulted.`, href: `/lab`, patientId: o.patientId, priority: "HIGH" });
  }
  if (can("cards:read")) {
    const ending = await tx.cardSubscription.findMany({ where: { endsAt: { gt: now, lt: new Date(now.getTime() + 14 * DAY) } }, include: { card: { include: { owner: { select: { id: true, fullName: true, phone: true } } } } }, take: 20 });
    for (const s of ending) {
      if (await tx.cardSubscription.count({ where: { cardId: s.cardId, endsAt: { gt: s.endsAt } } })) continue; // already renewed
      out.push({ key: `card:${s.id}`, kind: "RENEWAL", title: `Health card renewal: ${s.card.owner.fullName}`, detail: `Plan ends ${s.endsAt.toISOString().slice(0, 10)}. Renewals are free of the card fee.`, href: `/cards`, patientId: s.card.owner.id, priority: "NORMAL" });
    }
  }
  return out;
}

export default async function taskRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "tasks"));
  const can = (req: Parameters<typeof hasPermission>[0]) => (p: string) => hasPermission(req, p);

  // People a task can be handed to: everyone on the staff, shown by name and role.
  app.get("/staff-directory", { preHandler: staffGuard("patients:read") }, async (req) => {
    const rows = await db.tenantMembership.findMany({ where: { tenantId: staff(req).tid }, include: { identity: { select: { id: true, fullName: true } } } });
    const by = new Map<string, { id: string; name: string | null; roles: string[] }>();
    for (const r of rows) { const e = by.get(r.identityId) ?? { id: r.identityId, name: r.identity.fullName, roles: [] }; e.roles.push(r.role); by.set(r.identityId, e); }
    return [...by.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  });

  app.get("/tasks", { preHandler: staffGuard("patients:read") }, async (req) => {
    const q = z.object({ scope: z.enum(["mine", "all", "created"]).default("mine"), status: z.enum(["OPEN", "DONE", "CANCELLED", "ALL"]).default("OPEN"), patientId: z.string().uuid().optional() }).parse(req.query);
    if (q.scope === "all" && !hasPermission(req, "tasks:manage")) throw httpError(403, "Only people who manage tasks can see everyone's");
    const me = staff(req).sub;
    const rows = await withTenant(db, staff(req).tid, (tx) =>
      tx.task.findMany({
        where: { ...(q.status === "ALL" ? {} : { status: q.status }), ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.scope === "mine" ? { assignedTo: me } : q.scope === "created" ? { createdBy: me } : {}), OR: [{ branchId: null }, { branchId: { in: req.access!.branchIds } }] },
        include: { patient: { select: { id: true, fullName: true, patientNo: true } } },
        orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 200,
      }),
    );
    const names = new Map((await db.identity.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.assignedTo, r.createdBy]).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
    return rows.map((r) => ({ ...r, assigneeName: r.assignedTo ? names.get(r.assignedTo) ?? null : null, creatorName: names.get(r.createdBy) ?? null, overdue: r.status === "OPEN" && !!r.dueAt && r.dueAt < new Date() }));
  });

  app.post("/tasks", { preHandler: staffGuard("patients:read") }, async (req, reply) => {
    const input = taskInput.parse(req.body);
    const tenantId = staff(req).tid;
    const t = await tenantInfo(db, tenantId);
    const why = readOnlyReason(t, t.suspendedReason);
    if (why) throw httpError(402, why);
    const assignee = input.assignedTo === undefined ? staff(req).sub : input.assignedTo;
    if (assignee !== staff(req).sub && !hasPermission(req, "tasks:manage")) throw httpError(403, "You can create tasks for yourself. Assigning to others needs the task manager permission.");
    const task = await withTenant(db, tenantId, async (tx) => {
      if (assignee && (await db.tenantMembership.count({ where: { tenantId, identityId: assignee } })) === 0) throw httpError(404, "That person is not on your staff");
      if (input.patientId && !(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      return tx.task.create({ data: { tenantId, branchId: req.access!.branchId, title: input.title, details: input.details, priority: input.priority, dueAt: input.dueAt ?? null, assignedTo: assignee, patientId: input.patientId ?? null, createdBy: staff(req).sub } });
    });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", { preHandler: staffGuard("patients:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = taskPatch.parse(req.body);
    const tenantId = staff(req).tid;
    const me = staff(req).sub;
    return withTenant(db, tenantId, async (tx) => {
      const t = await tx.task.findUnique({ where: { id } });
      if (!t) throw httpError(404, "Task not found");
      const manager = hasPermission(req, "tasks:manage");
      const mine = t.assignedTo === me || t.createdBy === me;
      if (!manager && !mine) throw httpError(403, "This task is not yours");
      const onlyStatus = Object.keys(input).every((k) => k === "status");
      if (!manager && !onlyStatus && t.createdBy !== me) throw httpError(403, "You can mark this task done, but only its creator or a task manager can edit it");
      if (input.assignedTo !== undefined && input.assignedTo !== t.assignedTo) {
        if (!manager && input.assignedTo !== me) throw httpError(403, "Assigning to others needs the task manager permission");
        if (input.assignedTo && (await db.tenantMembership.count({ where: { tenantId, identityId: input.assignedTo } })) === 0) throw httpError(404, "That person is not on your staff");
      }
      const done = input.status === "DONE" && t.status !== "DONE";
      const reopen = input.status === "OPEN" && t.status !== "OPEN";
      return tx.task.update({
        where: { id },
        data: { ...input, ...(done ? { completedAt: new Date(), completedBy: me } : {}), ...(reopen ? { completedAt: null, completedBy: null } : {}), ...(input.status === "CANCELLED" ? { completedAt: null, completedBy: null } : {}) },
      });
    });
  });

  app.get("/tasks/suggestions", { preHandler: staffGuard("tasks:manage") }, async (req) => {
    return withTenant(db, staff(req).tid, async (tx) => {
      const all = await findSuggestions(tx, req.access!.branchIds, can(req));
      const existing = await tx.task.findMany({ where: { createdAt: { gte: new Date(Date.now() - 14 * DAY) } }, select: { title: true, patientId: true } });
      return all.filter((s) => !existing.some((e) => e.title === s.title && e.patientId === (s.patientId ?? null)));
    });
  });

  // ── the bell: things that need attention right now, with how urgent they are ──
  app.get("/inbox", { preHandler: staffGuard("patients:read") }, async (req) => {
    const ids = req.access!.branchIds;
    const me = staff(req).sub;
    const tenantId = staff(req).tid;
    const alerts: { key: string; severity: "critical" | "warning" | "info"; title: string; detail: string; href: string; count?: number }[] = [];
    await withTenant(db, tenantId, async (tx) => {
      if (hasPermission(req, "appointments:read")) {
        const waiting = await tx.teleSession.count({ where: { status: "WAITING", patientJoinedAt: { not: null }, appointment: { branchId: { in: ids } } } });
        if (waiting) alerts.push({ key: "tele-waiting", severity: "critical", title: `${waiting} patient${waiting > 1 ? "s" : ""} waiting in the video room`, detail: "Open the tele-consultation desk to start the call.", href: "/consultations", count: waiting });
      }
      if (hasPermission(req, "lab:read")) {
        const crit = await tx.labOrderItem.count({ where: { flag: { in: ["CRITICAL_LOW", "CRITICAL_HIGH"] }, order: { branchId: { in: ids }, status: { in: ["RESULTED", "RELEASED"] }, createdAt: { gte: new Date(Date.now() - 2 * DAY) } } } });
        if (crit) alerts.push({ key: "lab-critical", severity: "critical", title: `${crit} critical lab result${crit > 1 ? "s" : ""}`, detail: "In the last two days. Make sure the doctor has seen them.", href: "/lab", count: crit });
      }
      if (hasPermission(req, "pharmacy:read")) {
        const [s] = await tx.$queryRaw<{ low: bigint; expired: bigint }[]>`
          SELECT (SELECT count(*) FROM hms.medicines m WHERE m.active AND COALESCE((SELECT sum(qty_on_hand) FROM hms.stock_batches b WHERE b.medicine_id = m.id AND b.branch_id = ANY(${ids}::uuid[]) AND b.expiry_date > CURRENT_DATE), 0) <= m.reorder_level) AS low,
                 (SELECT count(*) FROM hms.stock_batches WHERE branch_id = ANY(${ids}::uuid[]) AND qty_on_hand > 0 AND expiry_date <= CURRENT_DATE) AS expired`;
        if (Number(s?.expired)) alerts.push({ key: "stock-expired", severity: "critical", title: `${s!.expired} expired batch${Number(s!.expired) > 1 ? "es" : ""} still on the shelf`, detail: "Remove and write them off.", href: "/pharmacy/inventory?view=alerts", count: Number(s!.expired) });
        if (Number(s?.low)) alerts.push({ key: "stock-low", severity: "warning", title: `${s!.low} medicine${Number(s!.low) > 1 ? "s" : ""} low on stock`, detail: "At or below the reorder level.", href: "/pharmacy/purchases", count: Number(s!.low) });
      }
      const overdue = await tx.task.count({ where: { status: "OPEN", assignedTo: me, dueAt: { lt: new Date() } } });
      if (overdue) alerts.push({ key: "tasks-overdue", severity: "warning", title: `${overdue} overdue task${overdue > 1 ? "s" : ""}`, detail: "Assigned to you and past their due time.", href: "/tasks", count: overdue });
      const todo = await tx.task.count({ where: { status: "OPEN", assignedTo: me } });
      if (todo && !overdue) alerts.push({ key: "tasks-open", severity: "info", title: `${todo} open task${todo > 1 ? "s" : ""}`, detail: "Waiting for you.", href: "/tasks", count: todo });
      if (hasPermission(req, "billing:read")) {
        const [o] = await tx.$queryRaw<{ n: bigint; due: bigint }[]>`SELECT count(*) AS n, COALESCE(sum(total_paise - paid_paise), 0) AS due FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status IN ('UNPAID', 'PARTIAL') AND created_at < now() - interval '7 days'`;
        if (Number(o?.n)) alerts.push({ key: "bills-overdue", severity: "info", title: `${o!.n} bill${Number(o!.n) > 1 ? "s" : ""} unpaid for over a week`, detail: `${rupees(Number(o!.due))} outstanding.`, href: "/billing", count: Number(o!.n) });
      }
    });
    if (hasPermission(req, "subscription:manage") || hasPermission(req, "team:manage")) {
      const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const due = await db.platformInvoice.findFirst({ where: { tenantId, status: "DUE" }, orderBy: { dueDate: "asc" } });
      if (due) alerts.push({ key: "platform-due", severity: due.dueDate < new Date() ? "critical" : "warning", title: `Swasthya invoice ${due.invoiceNo} is due`, detail: `${rupees(due.totalPaise)} by ${due.dueDate.toISOString().slice(0, 10)}.`, href: "/settings?tab=subscription" });
      if (t.status === "TRIAL" && t.trialEndsAt) {
        const days = Math.ceil((t.trialEndsAt.getTime() - Date.now()) / DAY);
        if (days <= 7) alerts.push({ key: "trial", severity: days <= 2 ? "critical" : "warning", title: `Free trial ends in ${Math.max(0, days)} day${days === 1 ? "" : "s"}`, detail: `You will be on the ${effectivePlan({ ...t, status: "ACTIVE" })} plan afterwards.`, href: "/settings?tab=subscription" });
      }
    }
    const order = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    return { alerts, count: alerts.filter((a) => a.severity !== "info").length };
  });
}
