import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { istDay } from "../billing";
import { featureGate } from "../gates";
import { staff, staffGuard, todayIst } from "../guards";
import { addDays, startOfToday } from "../stock";

const range = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export default async function pharmacyReportRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "pharmacy"));

  // Sales, returns, payment mix, best sellers and margin for a date range (default: this month), for the branches in view.
  app.get("/pharmacy/reports/sales", { preHandler: staffGuard("pharmacy:reports") }, async (req) => {
    const q = range.parse(req.query);
    const today = todayIst();
    const from = istDay(q.from ?? `${today.slice(0, 8)}01`).from;
    const to = istDay(q.to ?? today).to;
    const ids = req.access!.branchIds;
    return withTenant(db, staff(req).tid, async (tx) => {
      const [totals] = await tx.$queryRaw<{ bills: bigint; total: bigint; tax: bigint }[]>`
        SELECT count(*) AS bills, COALESCE(sum(total_paise), 0) AS total, COALESCE(sum(tax_paise), 0) AS tax FROM hms.invoices
        WHERE source = 'PHARMACY' AND status <> 'VOID' AND branch_id = ANY(${ids}::uuid[]) AND created_at >= ${from} AND created_at < ${to}`;
      const byDay = await tx.$queryRaw<{ day: string; total: bigint; bills: bigint }[]>`
        SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(total_paise) AS total, count(*) AS bills FROM hms.invoices
        WHERE source = 'PHARMACY' AND status <> 'VOID' AND branch_id = ANY(${ids}::uuid[]) AND created_at >= ${from} AND created_at < ${to} GROUP BY 1 ORDER BY 1`;
      const byMethod = await tx.$queryRaw<{ method: string; total: bigint }[]>`
        SELECT p.method::text AS method, sum(p.amount_paise) AS total FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id
        WHERE i.source = 'PHARMACY' AND i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${from} AND p.received_at < ${to} GROUP BY 1`;
      const top = await tx.$queryRaw<{ medicine_id: string; name: string; strength: string | null; qty: bigint; revenue: bigint; cost: bigint | null }[]>`
        SELECT m.id AS medicine_id, m.name, m.strength, sum(dl.qty) AS qty, sum(dl.amount_paise) AS revenue,
               sum(CASE WHEN sb.cost_paise IS NOT NULL THEN dl.qty * sb.cost_paise END) AS cost
        FROM hms.dispense_lines dl JOIN hms.dispenses d ON d.id = dl.dispense_id JOIN hms.medicines m ON m.id = dl.medicine_id JOIN hms.stock_batches sb ON sb.id = dl.batch_id
        WHERE d.branch_id = ANY(${ids}::uuid[]) AND d.created_at >= ${from} AND d.created_at < ${to} GROUP BY m.id, m.name, m.strength ORDER BY revenue DESC LIMIT 15`;
      const returns = await tx.saleReturn.aggregate({ where: { branchId: { in: ids }, createdAt: { gte: from, lt: to } }, _sum: { amountPaise: true }, _count: { _all: true } });
      const revenue = top.reduce((a, t) => a + Number(t.revenue), 0);
      const known = top.filter((t) => t.cost !== null);
      const margin = known.reduce((a, t) => a + Number(t.revenue) - Number(t.cost), 0);
      return {
        from: from.toISOString(), to: to.toISOString(),
        bills: Number(totals?.bills ?? 0), totalPaise: Number(totals?.total ?? 0), taxPaise: Number(totals?.tax ?? 0),
        returnsPaise: returns._sum.amountPaise ?? 0, returnsCount: returns._count._all,
        netPaise: Number(totals?.total ?? 0) - (returns._sum.amountPaise ?? 0),
        byDay: byDay.map((d) => ({ day: d.day, totalPaise: Number(d.total), bills: Number(d.bills) })),
        byMethod: byMethod.map((m) => ({ method: m.method, totalPaise: Number(m.total) })),
        topItems: top.map((t) => ({ medicineId: t.medicine_id, name: `${t.name}${t.strength ? ` ${t.strength}` : ""}`, qty: Number(t.qty), revenuePaise: Number(t.revenue), marginPaise: t.cost === null ? null : Number(t.revenue) - Number(t.cost) })),
        marginPaise: margin, marginPercent: known.length && revenue ? Math.round((margin / known.reduce((a, t) => a + Number(t.revenue), 0)) * 1000) / 10 : null,
      };
    });
  });

  // What the stock on the shelf is worth, at cost and at selling price.
  app.get("/pharmacy/reports/stock-value", { preHandler: staffGuard("pharmacy:reports") }, async (req) => {
    const ids = req.access!.branchIds;
    return withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; name: string; strength: string | null; qty: bigint; at_cost: bigint | null; at_price: bigint }[]>`
        SELECT m.id, m.name, m.strength, sum(sb.qty_on_hand) AS qty, sum(sb.qty_on_hand * COALESCE(sb.cost_paise, 0)) AS at_cost, sum(sb.qty_on_hand * m.price_paise) AS at_price
        FROM hms.stock_batches sb JOIN hms.medicines m ON m.id = sb.medicine_id
        WHERE sb.branch_id = ANY(${ids}::uuid[]) AND sb.qty_on_hand > 0 AND sb.expiry_date > CURRENT_DATE GROUP BY m.id, m.name, m.strength ORDER BY at_price DESC`;
      const items = rows.map((r) => ({ medicineId: r.id, name: `${r.name}${r.strength ? ` ${r.strength}` : ""}`, qty: Number(r.qty), costValuePaise: Number(r.at_cost ?? 0), sellingValuePaise: Number(r.at_price) }));
      return { items, costValuePaise: items.reduce((a, i) => a + i.costValuePaise, 0), sellingValuePaise: items.reduce((a, i) => a + i.sellingValuePaise, 0) };
    });
  });

  // Batches that expire soon, with the value that would be lost.
  app.get("/pharmacy/reports/expiry", { preHandler: staffGuard("pharmacy:reports") }, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query);
    return withTenant(db, staff(req).tid, async (tx) => {
      const today = startOfToday();
      const batches = await tx.stockBatch.findMany({
        where: { branchId: { in: req.access!.branchIds }, qtyOnHand: { gt: 0 }, expiryDate: { lte: addDays(today, days) } },
        include: { medicine: { select: { name: true, strength: true } }, branch: { select: { code: true } } },
        orderBy: { expiryDate: "asc" },
      });
      return batches.map((b) => ({ id: b.id, medicine: `${b.medicine.name}${b.medicine.strength ? ` ${b.medicine.strength}` : ""}`, branch: b.branch.code, batchNo: b.batchNo, expiryDate: b.expiryDate, qtyOnHand: b.qtyOnHand, expired: b.expiryDate <= today, atRiskPaise: b.qtyOnHand * (b.costPaise ?? 0) }));
    });
  });
}
