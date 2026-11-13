import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nextSeq, withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { inScope } from "../authz";
import { recordPayment } from "../billing";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });
const DAY = 86_400_000;
const paise = z.number().int().min(0).max(1_000_000_000);

type Action = "approve_preauth" | "reject_preauth" | "submit" | "query" | "respond" | "approve" | "reject" | "settle" | "close";
/** What each action may be done from, and where it lands. Anything else is refused. */
const FLOW: Record<Action, { from: string[]; to: string }> = {
  approve_preauth: { from: ["PREAUTH_PENDING"], to: "PREAUTH_APPROVED" },
  reject_preauth: { from: ["PREAUTH_PENDING"], to: "PREAUTH_REJECTED" },
  submit: { from: ["DRAFT", "PREAUTH_APPROVED"], to: "SUBMITTED" },
  query: { from: ["SUBMITTED"], to: "QUERY" },
  respond: { from: ["QUERY"], to: "SUBMITTED" },
  approve: { from: ["SUBMITTED"], to: "APPROVED" },
  reject: { from: ["SUBMITTED"], to: "REJECTED" },
  settle: { from: ["APPROVED"], to: "APPROVED" },
  close: { from: ["DRAFT", "PREAUTH_PENDING", "PREAUTH_APPROVED", "PREAUTH_REJECTED", "SUBMITTED", "QUERY", "APPROVED", "REJECTED"], to: "CLOSED" },
};

const view = (c: { id: string; claimNo: string; kind: string; status: string; diagnosis: string | null; preauthRequestedPaise: number; preauthApprovedPaise: number; billedPaise: number; approvedPaise: number; settledPaise: number; disallowedPaise: number; submittedAt: Date | null; createdAt: Date; invoiceId: string | null; admissionId: string | null }) => ({
  ...c, outstandingPaise: Math.max(0, c.approvedPaise - c.settledPaise), ageDays: Math.floor((Date.now() - (c.submittedAt ?? c.createdAt).getTime()) / DAY),
});

/** Claims against insurers and TPAs, from pre-authorisation to the money arriving. Gated as the "insurance" feature. */
export default async function insuranceRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const gate = featureGate(db, "insurance");
  const read = { preHandler: [gate, staffGuard("insurance:read")] };
  const write = { preHandler: [gate, staffGuard("insurance:write")] };
  const manage = { preHandler: [gate, staffGuard("insurance:manage")] };
  const dup = (e: unknown, m: string): never => { if ((e as { code?: string }).code === "P2002") throw httpError(409, m); throw e; };

  // ── payers ──
  app.get("/insurance/payers", read, async (req) => withTenant(db, staff(req).tid, (tx) => tx.payer.findMany({ orderBy: { name: "asc" } })));
  app.post("/insurance/payers", manage, async (req, reply) => {
    const i = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(["INSURER", "TPA", "GOVERNMENT", "CORPORATE"]), contactEmail: z.string().email().optional(), contactPhone: z.string().trim().max(20).optional(), creditDays: z.number().int().min(0).max(365).default(30) }).parse(req.body);
    const tenantId = staff(req).tid;
    return reply.code(201).send(await withTenant(db, tenantId, (tx) => tx.payer.create({ data: { tenantId, ...i } }).catch((e) => dup(e, "A payer with that name already exists"))));
  });
  app.patch("/insurance/payers/:id", manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ name: z.string().trim().min(2).max(100).optional(), creditDays: z.number().int().min(0).max(365).optional(), active: z.boolean().optional(), contactEmail: z.string().email().nullable().optional(), contactPhone: z.string().trim().max(20).nullable().optional() }).parse(req.body);
    return withTenant(db, staff(req).tid, async (tx) => { if (!(await tx.payer.findUnique({ where: { id } }))) throw httpError(404, "Payer not found"); return tx.payer.update({ where: { id }, data: i }).catch((e) => dup(e, "A payer with that name already exists")); });
  });

  // ── a patient's policies ──
  app.get("/patients/:id/policies", read, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, (tx) => tx.patientPolicy.findMany({ where: { patientId: id }, include: { payer: { select: { id: true, name: true, kind: true } } }, orderBy: { createdAt: "desc" } }));
  });
  app.post("/patients/:id/policies", write, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ payerId: z.string().uuid(), policyNo: z.string().trim().min(2).max(60), memberId: z.string().trim().max(60).optional(), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), sumInsuredPaise: paise.optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    return reply.code(201).send(await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id } }))) throw httpError(404, "Patient not found");
      if (!(await tx.payer.findFirst({ where: { id: i.payerId, active: true } }))) throw httpError(404, "Payer not found");
      return tx.patientPolicy.create({ data: { tenantId, patientId: id, payerId: i.payerId, policyNo: i.policyNo, memberId: i.memberId, sumInsuredPaise: i.sumInsuredPaise, validUntil: i.validUntil ? new Date(i.validUntil) : undefined } }).catch((e) => dup(e, "This policy is already on file"));
    }));
  });

  // ── claims ──
  app.get("/insurance/claims", read, async (req) => {
    const q = z.object({ status: z.string().optional(), payerId: z.string().uuid().optional(), open: z.coerce.boolean().optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    const rows = await withTenant(db, staff(req).tid, (tx) => tx.claim.findMany({
      where: { ...inScope(req), ...(q.status ? { status: q.status } : {}), ...(q.open ? { status: { notIn: ["SETTLED", "CLOSED", "REJECTED", "PREAUTH_REJECTED"] } } : {}), ...(q.payerId ? { payerId: q.payerId } : {}), ...(q.q ? { OR: [{ claimNo: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }] } : {}) },
      include: { patient: { select: { id: true, fullName: true, patientNo: true } }, payer: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: q.limit,
    }));
    return rows.map((c) => ({ ...view(c), patient: c.patient, payer: c.payer }));
  });

  // Money the insurers owe, how old it is against each one's credit terms, and how they behave.
  app.get("/insurance/summary", read, async (req) => {
    return withTenant(db, staff(req).tid, async (tx) => {
      const claims = await tx.claim.findMany({ where: { ...inScope(req) }, include: { payer: { select: { id: true, name: true, creditDays: true } } } });
      const open = claims.filter((c) => !["SETTLED", "CLOSED", "REJECTED", "PREAUTH_REJECTED"].includes(c.status));
      const byStatus: Record<string, { count: number; paise: number }> = {};
      for (const c of claims) { const e = (byStatus[c.status] ??= { count: 0, paise: 0 }); e.count++; e.paise += c.status === "APPROVED" ? c.approvedPaise - c.settledPaise : c.billedPaise || c.preauthRequestedPaise; }
      const payers = new Map<string, { id: string; name: string; creditDays: number; claims: number; receivablePaise: number; overduePaise: number; rejected: number; decided: number; settledPaise: number; days: number[] }>();
      for (const c of claims) {
        const p = payers.get(c.payerId) ?? { id: c.payerId, name: c.payer.name, creditDays: c.payer.creditDays, claims: 0, receivablePaise: 0, overduePaise: 0, rejected: 0, decided: 0, settledPaise: 0, days: [] };
        p.claims++;
        const owed = c.status === "APPROVED" ? c.approvedPaise - c.settledPaise : 0;
        p.receivablePaise += owed;
        if (owed > 0 && c.submittedAt && Date.now() - c.submittedAt.getTime() > c.payer.creditDays * DAY) p.overduePaise += owed;
        if (["APPROVED", "SETTLED", "REJECTED"].includes(c.status)) { p.decided++; if (c.status === "REJECTED") p.rejected++; }
        p.settledPaise += c.settledPaise;
        if (c.status === "SETTLED" && c.submittedAt && c.closedAt) p.days.push((c.closedAt.getTime() - c.submittedAt.getTime()) / DAY);
        payers.set(c.payerId, p);
      }
      return {
        openClaims: open.length, receivablePaise: claims.reduce((a, c) => a + (c.status === "APPROVED" ? c.approvedPaise - c.settledPaise : 0), 0),
        overduePaise: [...payers.values()].reduce((a, p) => a + p.overduePaise, 0), settledPaise: claims.reduce((a, c) => a + c.settledPaise, 0), disallowedPaise: claims.reduce((a, c) => a + c.disallowedPaise, 0), byStatus,
        payers: [...payers.values()].map(({ days, ...p }) => ({ ...p, rejectionPct: p.decided ? Math.round((p.rejected / p.decided) * 1000) / 10 : 0, avgDaysToSettle: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null })).sort((a, b) => b.receivablePaise - a.receivablePaise),
      };
    });
  });

  app.post("/insurance/claims", write, async (req, reply) => {
    const i = z.object({ patientId: z.string().uuid(), payerId: z.string().uuid(), policyId: z.string().uuid().optional(), admissionId: z.string().uuid().optional(), invoiceId: z.string().uuid().optional(), kind: z.enum(["CASHLESS", "REIMBURSEMENT"]), diagnosis: z.string().trim().max(300).optional(), preauthRequestedPaise: paise.default(0), notes: z.string().trim().max(500).optional() }).parse(req.body);
    if (i.kind === "CASHLESS" && i.preauthRequestedPaise <= 0) throw httpError(400, "Enter the amount you are asking the insurer to pre-authorise");
    const tenantId = staff(req).tid;
    const created = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: i.patientId } }))) throw httpError(404, "Patient not found");
      if (!(await tx.payer.findFirst({ where: { id: i.payerId, active: true } }))) throw httpError(404, "Payer not found");
      if (i.policyId && !(await tx.patientPolicy.findFirst({ where: { id: i.policyId, patientId: i.patientId, payerId: i.payerId } }))) throw httpError(400, "That policy is not this patient's with this payer");
      let billed = 0;
      if (i.invoiceId) { const inv = await tx.invoice.findFirst({ where: { id: i.invoiceId, patientId: i.patientId, ...inScope(req) } }); if (!inv || inv.status === "VOID") throw httpError(404, "Invoice not found"); billed = inv.totalPaise; }
      if (i.admissionId && !(await tx.admission.findFirst({ where: { id: i.admissionId, patientId: i.patientId, ...inScope(req) } }))) throw httpError(404, "Admission not found");
      const year = new Date().getFullYear();
      const claimNo = `CLM-${year}-${String(await nextSeq(tx, tenantId, `claim:${year}`)).padStart(5, "0")}`;
      const status = i.kind === "CASHLESS" ? "PREAUTH_PENDING" : "DRAFT";
      const c = await tx.claim.create({ data: { tenantId, branchId: req.access!.branchId, claimNo, patientId: i.patientId, payerId: i.payerId, policyId: i.policyId, admissionId: i.admissionId, invoiceId: i.invoiceId, kind: i.kind, status, diagnosis: i.diagnosis, preauthRequestedPaise: i.preauthRequestedPaise, billedPaise: billed, notes: i.notes, createdBy: staff(req).sub } })
        .catch((e) => dup(e, "A claim is already open for that invoice"));
      await tx.claimEvent.create({ data: { tenantId, claimId: c.id, status, amountPaise: i.preauthRequestedPaise || billed || null, note: "Claim opened", byId: staff(req).sub } });
      return c;
    });
    return reply.code(201).send(view(created));
  });

  app.get("/insurance/claims/:id", read, async (req) => {
    const { id } = idParam.parse(req.params);
    const c = await withTenant(db, staff(req).tid, (tx) => tx.claim.findFirst({ where: { id, ...inScope(req) }, include: { events: { orderBy: { at: "asc" } }, patient: { select: { id: true, fullName: true, patientNo: true } }, payer: true, policy: true } }));
    if (!c) throw httpError(404, "Claim not found");
    const who = new Map((await db.identity.findMany({ where: { id: { in: c.events.map((e) => e.byId) } }, select: { id: true, fullName: true } })).map((x) => [x.id, x.fullName]));
    return { ...view(c), patient: c.patient, payer: c.payer, policy: c.policy, events: c.events.map((e) => ({ id: e.id, status: e.status, amountPaise: e.amountPaise, note: e.note, at: e.at, by: who.get(e.byId) ?? null })), next: (Object.keys(FLOW) as Action[]).filter((a) => FLOW[a].from.includes(c.status)) };
  });

  app.post("/insurance/claims/:id/act", write, async (req) => {
    const { id } = idParam.parse(req.params);
    const i = z.object({ action: z.enum(Object.keys(FLOW) as [Action, ...Action[]]), amountPaise: paise.optional(), note: z.string().trim().max(500).optional(), invoiceId: z.string().uuid().optional(), closeShort: z.boolean().optional() }).parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx: TenantTx) => {
      const c = await tx.claim.findFirst({ where: { id, ...inScope(req) } });
      if (!c) throw httpError(404, "Claim not found");
      const step = FLOW[i.action];
      if (!step.from.includes(c.status)) throw httpError(409, `A claim that is ${c.status.toLowerCase().replace(/_/g, " ")} cannot be moved that way`);
      const data: Record<string, unknown> = { status: step.to };
      let amount = i.amountPaise;
      const need = (v: number | undefined, label: string) => { if (!v || v <= 0) throw httpError(400, label); return v; };
      switch (i.action) {
        case "approve_preauth": data["preauthApprovedPaise"] = need(amount, "Enter the amount the insurer pre-authorised"); break;
        case "submit": {
          const invoiceId = i.invoiceId ?? c.invoiceId;
          if (!invoiceId) throw httpError(400, "Attach the final invoice before submitting");
          const inv = await tx.invoice.findFirst({ where: { id: invoiceId, patientId: c.patientId } });
          if (!inv || inv.status === "VOID") throw httpError(404, "Invoice not found");
          Object.assign(data, { invoiceId, billedPaise: inv.totalPaise, submittedAt: c.submittedAt ?? new Date() }); amount = inv.totalPaise; break;
        }
        case "approve": {
          const a = need(amount, "Enter the amount the insurer approved");
          if (a > c.billedPaise) throw httpError(400, "The approved amount cannot be more than the bill");
          Object.assign(data, { approvedPaise: a, disallowedPaise: c.billedPaise - a }); break;
        }
        case "settle": {
          const a = need(amount, "Enter the amount received");
          const left = c.approvedPaise - c.settledPaise;
          if (a > left) throw httpError(409, `Only ${left} paise is still due on this claim`);
          if (!c.invoiceId) throw httpError(409, "There is no invoice to credit");
          await recordPayment(tx, tenantId, c.invoiceId, { amountPaise: a, method: "INSURANCE", reference: c.claimNo, receivedBy: staff(req).sub });
          const settled = c.settledPaise + a;
          const done = settled === c.approvedPaise || i.closeShort;
          Object.assign(data, { settledPaise: settled, status: done ? "SETTLED" : "APPROVED", ...(done ? { closedAt: new Date() } : {}), ...(i.closeShort && settled < c.approvedPaise ? { disallowedPaise: c.disallowedPaise + (c.approvedPaise - settled) } : {}) });
          break;
        }
        case "close": data["closedAt"] = new Date(); break;
        default: break;
      }
      const updated = await tx.claim.update({ where: { id }, data }).catch((e) => dup(e, "A claim is already open for that invoice"));
      await tx.claimEvent.create({ data: { tenantId, claimId: id, status: String(data["status"]), amountPaise: amount ?? null, note: [i.action.replace(/_/g, " "), i.note].filter(Boolean).join(": "), byId: staff(req).sub } });
      return view(updated);
    });
  });
}
