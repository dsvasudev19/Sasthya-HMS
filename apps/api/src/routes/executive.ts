import type { FastifyInstance } from "fastify";
import { withTenant, type PrismaClient } from "@hms/db";
import { featureGate } from "../gates";
import { staff, staffGuard, todayIst } from "../guards";
import { istDay } from "../billing";

const DAY = 86_400_000;
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

const rupeesText = (p: number) => `Rs ${(p / 100).toLocaleString("en-IN")}`;
export interface Insight { level: "good" | "watch" | "act"; title: string; detail: string }

/** What a chairman looks at first: money, beds, doctors, leakage and cash control across every branch, with plain-language flags. */
export default async function executiveRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.get("/analytics/executive", { preHandler: [featureGate(db, "reports"), staffGuard("executive:read")] }, async (req) => {
    const ids = req.access!.branchIds;
    const today = todayIst();
    const monthStart = `${today.slice(0, 8)}01`;
    const dom = Number(today.slice(8, 10));
    const prevStart = (() => { const d = new Date(`${monthStart}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
    const prevSame = addDays(prevStart, dom); // the same number of days into last month
    const A = istDay(monthStart).from, Z = istDay(today).to, PA = istDay(prevStart).from, PZ = istDay(addDays(prevSame, -1)).to;
    const d30 = istDay(addDays(today, -29)).from;

    const r = await withTenant(db, staff(req).tid, async (tx) => {
      const money = async (a: Date, z: Date) => {
        const [b] = await tx.$queryRaw<{ billed: bigint; discount: bigint; bills: bigint; voids: bigint }[]>`
          SELECT COALESCE(sum(total_paise) FILTER (WHERE status <> 'VOID'), 0) AS billed, COALESCE(sum(discount_paise) FILTER (WHERE status <> 'VOID'), 0) AS discount, count(*) FILTER (WHERE status <> 'VOID') AS bills, count(*) FILTER (WHERE status = 'VOID') AS voids
          FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND created_at >= ${a} AND created_at < ${z}`;
        const [c] = await tx.$queryRaw<{ v: bigint }[]>`SELECT COALESCE(sum(p.amount_paise), 0) AS v FROM hms.payments p JOIN hms.invoices i ON i.id = p.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND p.received_at >= ${a} AND p.received_at < ${z}`;
        const [f] = await tx.$queryRaw<{ v: bigint }[]>`SELECT COALESCE(sum(r.amount_paise), 0) AS v FROM hms.refunds r JOIN hms.invoices i ON i.id = r.invoice_id WHERE i.branch_id = ANY(${ids}::uuid[]) AND r.created_at >= ${a} AND r.created_at < ${z}`;
        const visits = await tx.appointment.count({ where: { branchId: { in: ids }, scheduledAt: { gte: a, lt: z }, status: { not: "CANCELLED" } } });
        const noShow = await tx.appointment.count({ where: { branchId: { in: ids }, scheduledAt: { gte: a, lt: z }, status: "NO_SHOW" } });
        const patients = await tx.patient.count({ where: { createdAt: { gte: a, lt: z } } });
        return { billed: num(b?.billed), discount: num(b?.discount), bills: num(b?.bills), voids: num(b?.voids), collected: num(c?.v), refunded: num(f?.v), visits, noShow, patients };
      };
      const now = await money(A, Z), prev = await money(PA, PZ);
      const bySource = await tx.$queryRaw<{ source: string; v: bigint }[]>`SELECT source::text AS source, sum(total_paise) AS v FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'VOID' AND created_at >= ${A} AND created_at < ${Z} GROUP BY 1 ORDER BY v DESC`;
      const doctors = await tx.$queryRaw<{ doctor_id: string; v: bigint; visits: bigint }[]>`
        SELECT a.doctor_id, COALESCE(sum(i.total_paise) FILTER (WHERE i.status <> 'VOID'), 0) AS v, count(DISTINCT a.id) FILTER (WHERE a.status = 'COMPLETED') AS visits
        FROM hms.appointments a LEFT JOIN hms.invoices i ON i.appointment_id = a.id WHERE a.branch_id = ANY(${ids}::uuid[]) AND a.doctor_id IS NOT NULL AND a.scheduled_at >= ${A} AND a.scheduled_at < ${Z}
        GROUP BY 1 ORDER BY v DESC, visits DESC LIMIT 8`;
      const branches = await tx.$queryRaw<{ code: string; name: string; v: bigint; bills: bigint }[]>`
        SELECT b.code, b.name, COALESCE(sum(i.total_paise), 0) AS v, count(i.id) AS bills FROM hms.branches b LEFT JOIN hms.invoices i ON i.branch_id = b.id AND i.status <> 'VOID' AND i.created_at >= ${A} AND i.created_at < ${Z}
        WHERE b.id = ANY(${ids}::uuid[]) GROUP BY 1, 2 ORDER BY v DESC`;
      const trend = await tx.$queryRaw<{ day: string; v: bigint }[]>`SELECT to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, sum(total_paise) AS v FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status <> 'VOID' AND created_at >= ${d30} AND created_at < ${Z} GROUP BY 1`;
      const variance = await tx.dailyClosing.findMany({ where: { branchId: { in: ids }, date: { gte: new Date(`${addDays(today, -29)}T00:00:00Z`) } }, include: { branch: { select: { code: true } } }, orderBy: { date: "desc" } });
      const aging = await tx.$queryRaw<{ d7: bigint; d30: bigint; over: bigint }[]>`
        SELECT COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS d7, COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at < now() - interval '7 days' AND created_at >= now() - interval '30 days'), 0) AS d30, COALESCE(sum(total_paise - paid_paise) FILTER (WHERE created_at < now() - interval '30 days'), 0) AS over
        FROM hms.invoices WHERE branch_id = ANY(${ids}::uuid[]) AND status IN ('UNPAID', 'PARTIAL')`;
      // inpatient: how full the beds are, how long people stay
      const bedCount = await tx.bed.count({ where: { active: true, status: { not: "MAINTENANCE" }, ward: { branchId: { in: ids }, active: true } } });
      const occupiedNow = await tx.bed.count({ where: { active: true, status: "OCCUPIED", ward: { branchId: { in: ids } } } });
      const [bedDays] = await tx.$queryRaw<{ days: number | null }[]>`
        SELECT sum(extract(epoch FROM (LEAST(COALESCE(s.to_at, now()), now()) - GREATEST(s.from_at, ${d30}))) / 86400)::float AS days FROM hms.bed_stays s JOIN hms.admissions a ON a.id = s.admission_id
        WHERE a.branch_id = ANY(${ids}::uuid[]) AND COALESCE(s.to_at, now()) > ${d30}`;
      const [los] = await tx.$queryRaw<{ alos: number | null; n: bigint }[]>`SELECT round((avg(extract(epoch FROM (discharged_at - admitted_at)) / 86400))::numeric, 1)::float AS alos, count(*) AS n FROM hms.admissions WHERE branch_id = ANY(${ids}::uuid[]) AND status = 'DISCHARGED' AND discharged_at >= ${d30}`;
      const admitted = await tx.admission.count({ where: { branchId: { in: ids }, admittedAt: { gte: A, lt: Z } } });
      const discharged = await tx.admission.count({ where: { branchId: { in: ids }, dischargedAt: { gte: A, lt: Z } } });
      const outcomes = await tx.admission.groupBy({ by: ["dischargeType"], where: { branchId: { in: ids }, status: "DISCHARGED", dischargedAt: { gte: d30 } }, _count: { _all: true } });
      const overdue = await tx.admission.count({ where: { branchId: { in: ids }, status: "ADMITTED", expectedDischargeOn: { lt: new Date(`${today}T00:00:00Z`) } } });
      const [stock] = await tx.$queryRaw<{ expired: bigint; value: bigint }[]>`SELECT count(*) FILTER (WHERE expiry_date <= CURRENT_DATE AND qty_on_hand > 0) AS expired, COALESCE(sum(qty_on_hand * COALESCE(cost_paise, 0)) FILTER (WHERE expiry_date <= CURRENT_DATE), 0) AS value FROM hms.stock_batches WHERE branch_id = ANY(${ids}::uuid[])`;
      // the newer departments: all read as zero where a hospital does not use them
      const claims = await tx.claim.findMany({ where: { branchId: { in: ids } }, select: { status: true, approvedPaise: true, settledPaise: true, submittedAt: true, payer: { select: { creditDays: true } } } });
      const owed = claims.filter((c) => c.status === "APPROVED");
      const insurance = { openClaims: claims.filter((c) => !["SETTLED", "CLOSED", "REJECTED", "PREAUTH_REJECTED"].includes(c.status)).length, receivablePaise: owed.reduce((a, c) => a + c.approvedPaise - c.settledPaise, 0), overduePaise: owed.filter((c) => c.submittedAt && Date.now() - c.submittedAt.getTime() > c.payer.creditDays * DAY).reduce((a, c) => a + c.approvedPaise - c.settledPaise, 0), rejectedMtd: await tx.claim.count({ where: { branchId: { in: ids }, status: "REJECTED", updatedAt: { gte: A } } }) };
      const surg = await tx.surgery.findMany({ where: { branchId: { in: ids }, scheduledStart: { gte: d30, lte: new Date() } }, select: { status: true, startedAt: true, endedAt: true } });
      const theatres = await tx.theatre.count({ where: { branchId: { in: ids }, active: true } });
      const usedH = surg.filter((x) => x.status === "COMPLETED" && x.startedAt && x.endedAt).reduce((a, x) => a + (x.endedAt!.getTime() - x.startedAt!.getTime()) / 3_600_000, 0);
      const ot = { theatres, completed30d: surg.filter((x) => x.status === "COMPLETED").length, cancelled30d: surg.filter((x) => x.status === "CANCELLED").length, utilisationPct: theatres ? Math.min(100, Math.round((usedH / (theatres * 30 * 10)) * 1000) / 10) : null };
      const erRows = await tx.erVisit.findMany({ where: { branchId: { in: ids }, arrivedAt: { gte: d30 } }, select: { status: true, triage: true, arrivedAt: true, seenAt: true } });
      const waits = erRows.filter((x) => x.seenAt).map((x) => (x.seenAt!.getTime() - x.arrivedAt.getTime()) / 60_000).sort((a, b) => a - b);
      const er = { visits30d: erRows.length, medianDoorToDoctorMinutes: waits.length ? Math.round(waits[waits.length >> 1]!) : null, lwbsPct: erRows.length ? Math.round((erRows.filter((x) => x.status === "LWBS").length / erRows.length) * 1000) / 10 : 0, waitingNow: erRows.filter((x) => x.status === "WAITING").length };
      const fb = await tx.feedback.findMany({ where: { answeredAt: { gte: new Date(Date.now() - 90 * DAY) } }, select: { score: true } });
      const sc = fb.map((x) => x.score!);
      const feedback = { responses90d: sc.length, nps: sc.length ? Math.round(((sc.filter((x) => x >= 9).length - sc.filter((x) => x <= 6).length) / sc.length) * 100) : null };
      const todayDate = new Date(`${today}T00:00:00Z`);
      const rostered = await tx.shift.findMany({ where: { branchId: { in: ids }, date: todayDate }, select: { identityId: true, startTime: true } });
      const punched = new Set((await tx.attendance.findMany({ where: { branchId: { in: ids }, date: todayDate }, select: { identityId: true } })).map((x) => x.identityId));
      const absent = rostered.filter((x) => !punched.has(x.identityId) && Date.now() > new Date(`${today}T${x.startTime}:00+05:30`).getTime() + 15 * 60_000).length;
      const workforce = { rosteredToday: rostered.length, absentToday: absent };
      return { insurance, ot, er, feedback, workforce, now, prev, bySource, doctors, branches, trend, variance, aging: aging[0], bedCount, occupiedNow, bedDays: bedDays?.days ?? 0, los, admitted, discharged, outcomes, overdue, stock };
    });

    const names = new Map((await db.identity.findMany({ where: { id: { in: r.doctors.map((d) => d.doctor_id) } }, select: { id: true, fullName: true } })).map((i) => [i.id, i.fullName]));
    const days30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
    const occ30 = r.bedCount ? Math.min(100, Math.round((r.bedDays / (r.bedCount * 30)) * 1000) / 10) : null;
    const eff = r.now.billed ? Math.round((r.now.collected / r.now.billed) * 1000) / 10 : null;
    const leak = r.now.billed + r.now.discount ? Math.round((r.now.discount / (r.now.billed + r.now.discount)) * 1000) / 10 : 0;
    const off = r.variance.filter((v) => v.countedCashPaise !== v.expectedCashPaise);
    const aging = r.aging ?? { d7: 0n, d30: 0n, over: 0n };

    const insights: Insight[] = [];
    const revΔ = pct(r.now.billed, r.prev.billed);
    if (revΔ !== null) insights.push(revΔ <= -10 ? { level: "act", title: `Billing is ${Math.abs(revΔ)}% below the same point last month`, detail: "Check which department or branch has slowed, below." } : revΔ >= 10 ? { level: "good", title: `Billing is up ${revΔ}% on the same point last month`, detail: "Keep an eye on whether collections are keeping pace." } : { level: "good", title: "Billing is steady against last month", detail: `${revΔ >= 0 ? "+" : ""}${revΔ}% over the same days.` });
    if (eff !== null && eff < 80) insights.push({ level: "act", title: `Only ${eff}% of what was billed has been collected`, detail: "Follow up open bills, and look at which departments are billed but unpaid." });
    if (r.bedCount && r.occupiedNow / r.bedCount >= 0.9) insights.push({ level: "act", title: `Beds are ${Math.round((r.occupiedNow / r.bedCount) * 100)}% full`, detail: "Little room for emergencies. Plan discharges and consider opening more beds." });
    else if (occ30 !== null && occ30 < 40) insights.push({ level: "watch", title: `Average bed occupancy is only ${occ30}% over 30 days`, detail: "Capacity is under-used. Look at referral sources and ward pricing." });
    if (r.overdue) insights.push({ level: "watch", title: `${r.overdue} admitted patient${r.overdue > 1 ? "s are" : " is"} past the expected discharge date`, detail: "Each extra day ties up a bed. Review them on the ward round." });
    if (off.length) insights.push({ level: "act", title: `Cash did not tally on ${off.length} closing${off.length > 1 ? "s" : ""} this month`, detail: `Largest gap: Rs ${(Math.max(...off.map((v) => Math.abs(v.countedCashPaise - v.expectedCashPaise))) / 100).toLocaleString("en-IN")}.` });
    if (leak > 8) insights.push({ level: "watch", title: `Discounts are ${leak}% of gross billing`, detail: "Above 8% usually means discounts are being given without a rule. Add an access policy to cap them." });
    if (r.now.voids > 3) insights.push({ level: "watch", title: `${r.now.voids} bills were voided this month`, detail: "Review who voided them in the audit trail." });
    const nsr = r.now.visits ? Math.round((r.now.noShow / r.now.visits) * 1000) / 10 : 0;
    if (nsr > 15) insights.push({ level: "watch", title: `${nsr}% of booked visits are no-shows`, detail: "Turn on reminders and consider confirming bookings the day before." });
    if (num(aging.over) > 0) insights.push({ level: "watch", title: `Rs ${(num(aging.over) / 100).toLocaleString("en-IN")} has been unpaid for over 30 days`, detail: "Older dues are the hardest to recover. Assign follow-ups." });
    if (num(r.stock?.value) > 0) insights.push({ level: "watch", title: `Expired stock worth Rs ${(num(r.stock?.value) / 100).toLocaleString("en-IN")} is still on the shelf`, detail: "Return it to suppliers or write it off." });
    if (r.insurance.overduePaise > 0) insights.push({ level: "act", title: `Insurers are ${rupeesText(r.insurance.overduePaise)} overdue`, detail: "Approved claims past the payer's credit period. Chase them from the Insurance page." });
    if (r.er.waitingNow > 0 && r.er.medianDoorToDoctorMinutes !== null && r.er.medianDoorToDoctorMinutes > 30) insights.push({ level: "watch", title: `Emergency door-to-doctor time is ${r.er.medianDoorToDoctorMinutes} minutes`, detail: "The median over 30 days is above 30 minutes. Review staffing at peak hours." });
    if (r.er.lwbsPct > 5) insights.push({ level: "watch", title: `${r.er.lwbsPct}% of emergency patients leave without being seen`, detail: "Long waits are costing you patients and goodwill." });
    if (r.ot.utilisationPct !== null && r.ot.theatres > 0 && r.ot.utilisationPct < 35) insights.push({ level: "watch", title: `Theatres are used ${r.ot.utilisationPct}% of the time`, detail: "Idle theatre time is the costliest idle capacity you have." });
    if (r.feedback.nps !== null && r.feedback.responses90d >= 10 && r.feedback.nps < 30) insights.push({ level: "act", title: `Patient satisfaction (NPS) is ${r.feedback.nps}`, detail: "Read the low-score comments on the Feedback page." });
    if (r.workforce.absentToday > 0) insights.push({ level: "watch", title: `${r.workforce.absentToday} rostered staff have not signed in today`, detail: "Check the attendance board." });
    const order = { act: 0, watch: 1, good: 2 } as const;
    insights.sort((a, b) => order[a.level] - order[b.level]);

    return {
      asOf: today, monthStart, daysIn: dom,
      kpis: {
        billedPaise: r.now.billed, billedPrevPaise: r.prev.billed, billedChangePct: revΔ, collectedPaise: r.now.collected, collectedChangePct: pct(r.now.collected, r.prev.collected), collectionEfficiencyPct: eff,
        visits: r.now.visits, visitsChangePct: pct(r.now.visits, r.prev.visits), newPatients: r.now.patients, newPatientsChangePct: pct(r.now.patients, r.prev.patients), refundedPaise: r.now.refunded, discountPct: leak, noShowPct: nsr,
      },
      inpatient: { beds: r.bedCount, occupied: r.occupiedNow, occupancyNowPct: r.bedCount ? Math.round((r.occupiedNow / r.bedCount) * 1000) / 10 : null, occupancy30dPct: occ30, avgLengthOfStayDays: r.los?.alos ?? null, discharges30d: num(r.los?.n), admissionsMtd: r.admitted, dischargesMtd: r.discharged, pastExpectedDischarge: r.overdue, outcomes: Object.fromEntries(r.outcomes.map((o) => [o.dischargeType ?? "OTHER", o._count._all])) },
      revenueBySource: r.bySource.map((s) => ({ source: s.source, paise: num(s.v) })),
      doctors: r.doctors.map((d) => ({ id: d.doctor_id, name: names.get(d.doctor_id) ?? "Doctor", billedPaise: num(d.v), visits: num(d.visits) })),
      branches: r.branches.map((b) => ({ code: b.code, name: b.name, billedPaise: num(b.v), bills: num(b.bills) })),
      trend: days30.map((d) => ({ day: d, paise: num(r.trend.find((t) => t.day === d)?.v) })),
      control: { cashMismatches: off.slice(0, 6).map((v) => ({ date: v.date, branch: v.branch.code, variancePaise: v.countedCashPaise - v.expectedCashPaise })), voidedBills: r.now.voids, aging: { under7Paise: num(aging.d7), under30Paise: num(aging.d30), over30Paise: num(aging.over) } },
      insurance: r.insurance, ot: r.ot, er: r.er, feedback: r.feedback, workforce: r.workforce,
      insights,
    };
  });
}
