import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { buildReport, REPORTS, REPORT_LABEL, runDueSchedules, toCsv, windowFor, type ReportName } from "../exports";
import { featureGate } from "../gates";
import { staff, staffGuard, todayIst } from "../guards";
import { addDays } from "../exports";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const report = z.enum(REPORTS);

/** Spreadsheet-ready downloads, and reports that are produced on a schedule and waiting when someone signs in. */
export default async function exportRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const pre = { preHandler: [featureGate(db, "reports"), staffGuard("exports:read")] };
  const csv = (reply: import("fastify").FastifyReply, name: string, body: string) => reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}.csv"`).send(body);

  app.get("/exports/reports", pre, async () => REPORTS.map((r) => ({ key: r, label: REPORT_LABEL[r] })));

  app.get("/exports/:report", pre, async (req, reply) => {
    const { report: name } = z.object({ report }).parse(req.params);
    const q = z.object({ from: ymd.default(addDays(todayIst(), -29)), to: ymd.default(todayIst()) }).parse(req.query);
    if (q.from > q.to) throw httpError(400, "The start date must not be after the end date");
    if (new Date(q.to).getTime() - new Date(q.from).getTime() > 400 * 86_400_000) throw httpError(400, "Choose a range of up to 13 months");
    const r = await buildReport(db, staff(req).tid, name as ReportName, q.from, q.to, req.access!.branchIds);
    await withTenant(db, staff(req).tid, (tx) => tx.auditLog.create({ data: { tenantId: staff(req).tid, actorIdentityId: staff(req).sub, action: "export.download", entity: "report", entityId: name, meta: { from: q.from, to: q.to, rows: r.rows.length } } }));
    return csv(reply, `${name.toLowerCase()}-${q.from}-to-${q.to}`, toCsv(r.header, r.rows));
  });

  app.get("/exports/schedules/list", pre, async (req) => withTenant(db, staff(req).tid, (tx) => tx.reportSchedule.findMany({ orderBy: { createdAt: "desc" } })));
  app.post("/exports/schedules", pre, async (req, reply) => {
    const i = z.object({ name: z.string().trim().min(2).max(80), report, frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]) }).parse(req.body);
    const tenantId = staff(req).tid;
    return reply.code(201).send(await withTenant(db, tenantId, (tx) => tx.reportSchedule.create({ data: { tenantId, ...i, createdBy: staff(req).sub } })));
  });
  app.delete("/exports/schedules/:id", pre, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => { if (!(await tx.reportSchedule.findUnique({ where: { id } }))) throw httpError(404, "Schedule not found"); await tx.reportSchedule.update({ where: { id }, data: { active: false } }); return { stopped: true }; });
  });
  // Produce it now rather than waiting for the next period.
  app.post("/exports/schedules/:id/run", pre, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const s = await withTenant(db, tenantId, (tx) => tx.reportSchedule.findUnique({ where: { id } }));
    if (!s) throw httpError(404, "Schedule not found");
    const w = windowFor(s.frequency);
    const r = await buildReport(db, tenantId, s.report as ReportName, w.from, w.to, req.access!.branchIds);
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      await tx.reportSchedule.update({ where: { id }, data: { lastRunAt: new Date() } });
      const run = await tx.reportRun.create({ data: { tenantId, scheduleId: id, report: s.report, fromDate: new Date(w.from), toDate: new Date(w.to), rows: r.rows.length, csv: toCsv(r.header, r.rows) }, select: { id: true, report: true, fromDate: true, toDate: true, rows: true, createdAt: true } });
      return run;
    }));
  });
  app.get("/exports/runs", pre, async (req) => withTenant(db, staff(req).tid, (tx) => tx.reportRun.findMany({ select: { id: true, report: true, fromDate: true, toDate: true, rows: true, createdAt: true, schedule: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 60 })));
  app.get("/exports/runs/:id/download", pre, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await withTenant(db, staff(req).tid, (tx) => tx.reportRun.findUnique({ where: { id } }));
    if (!r) throw httpError(404, "Report not found");
    return csv(reply, `${r.report.toLowerCase()}-${r.fromDate.toISOString().slice(0, 10)}-to-${r.toDate.toISOString().slice(0, 10)}`, r.csv);
  });
}
export { runDueSchedules };
