import { withTenant, type PrismaClient } from "@hms/db";
import { istDay } from "./billing";

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const names = async (db: PrismaClient, ids: (string | null)[]) => new Map((await db.identity.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));

/** What each doctor earned the hospital in a month (money actually received, less refunds) and their share of it at the rate in force on the last day. */
export async function doctorStatement(db: PrismaClient, tenantId: string, p: string) {
  const [y, m] = p.split("-").map(Number) as [number, number];
  const first = `${p}-01`, next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const A = istDay(first).from, Z = istDay(addDays(next, -1)).to;
  const { gross, refunds, shares } = await withTenant(db, tenantId, async (tx) => ({
    gross: await tx.$queryRaw<{ doctor_id: string; source: string; v: bigint; bills: bigint }[]>`
      SELECT a.doctor_id, 'CONSULTATION' AS source, sum(p.amount_paise) AS v, count(DISTINCT i.id) AS bills FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id JOIN hms.appointments a ON a.id = i.appointment_id
      WHERE a.doctor_id IS NOT NULL AND p.received_at >= ${A} AND p.received_at < ${Z} GROUP BY 1
      UNION ALL
      SELECT ad.doctor_id, 'IPD', sum(p.amount_paise), count(DISTINCT i.id) FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id JOIN hms.admissions ad ON ad.invoice_id = i.id
      WHERE p.received_at >= ${A} AND p.received_at < ${Z} GROUP BY 1`,
    refunds: await tx.$queryRaw<{ doctor_id: string; source: string; v: bigint }[]>`
      SELECT a.doctor_id, 'CONSULTATION' AS source, sum(r.amount_paise) AS v FROM hms.refunds r JOIN hms.invoices i ON i.id = r.invoice_id JOIN hms.appointments a ON a.id = i.appointment_id WHERE a.doctor_id IS NOT NULL AND r.created_at >= ${A} AND r.created_at < ${Z} GROUP BY 1
      UNION ALL
      SELECT ad.doctor_id, 'IPD', sum(r.amount_paise) FROM hms.refunds r JOIN hms.invoices i ON i.id = r.invoice_id JOIN hms.admissions ad ON ad.invoice_id = i.id WHERE r.created_at >= ${A} AND r.created_at < ${Z} GROUP BY 1`,
    shares: await tx.doctorShare.findMany({ where: { effectiveFrom: { lte: new Date(`${addDays(next, -1)}T00:00:00Z`) } }, orderBy: { effectiveFrom: "desc" } }),
  }));
  const doctors = [...new Set([...gross.map((g) => g.doctor_id)])];
  const who = await names(db, doctors);
  return doctors.map((d) => {
    const lines = (["CONSULTATION", "IPD"] as const).map((source) => {
      const g = num(gross.find((x) => x.doctor_id === d && x.source === source)?.v), r = num(refunds.find((x) => x.doctor_id === d && x.source === source)?.v);
      const rate = shares.find((s) => s.doctorId === d && s.source === source)?.basisPoints ?? 0;
      const net = g - r;
      return { source, bills: num(gross.find((x) => x.doctor_id === d && x.source === source)?.bills), receivedPaise: g, refundedPaise: r, netPaise: net, percent: rate / 100, sharePaise: Math.round((net * rate) / 10_000) };
    }).filter((l) => l.receivedPaise || l.refundedPaise);
    return { doctorId: d, doctor: who.get(d) ?? null, period: p, grossPaise: lines.reduce((a, l) => a + l.netPaise, 0), sharePaise: lines.reduce((a, l) => a + l.sharePaise, 0), lines };
  }).filter((s) => s.lines.length).sort((a, b) => b.sharePaise - a.sharePaise);
}
