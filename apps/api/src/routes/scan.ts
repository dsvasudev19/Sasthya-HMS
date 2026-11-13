import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient, type TenantTx } from "@hms/db";
import { checkIn } from "../appointments";
import { hasPermission, inScope } from "../authz";
import { featureGate } from "../gates";
import { nextToken } from "../booking";
import { dayRange, staff, staffGuard, todayIst } from "../guards";
import { httpError } from "../util";

type Kind = "APPOINTMENT" | "PATIENT" | "HEALTH_CARD" | "LAB_ORDER" | "INVOICE" | "PRESCRIPTION" | "MEDICINE" | "UNKNOWN";
export interface ScanResult {
  kind: Kind;
  /** What happened: DONE (it acted), INFO (nothing to change), CHOOSE (needs one tap), NEEDS_BOOKING, DENIED, NOT_FOUND. */
  outcome: "DONE" | "INFO" | "CHOOSE" | "NEEDS_BOOKING" | "DENIED" | "NOT_FOUND";
  tone: "success" | "info" | "warning" | "error";
  title: string;
  message: string;
  /** Where the app should go next, if anywhere. */
  open?: string;
  patient?: { id: string; fullName: string; patientNo: string };
  /** The visit that was checked in, so the desk can print its slip. */
  appointmentId?: string;
  choices?: { id: string; label: string; sub?: string }[];
  /** For the on-screen card: token, fee, balance and the like. */
  facts?: { label: string; value: string }[];
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const hm = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Takes whatever a scanner or a person typed and cleans it: URLs from our QR codes are reduced to the code inside. */
export function normaliseCode(raw: string): string {
  let c = raw.trim();
  const url = /\/verify\/[0-9a-f-]{36}\/([0-9A-Fa-f]{12})\/?$/.exec(c);
  if (url) c = url[1]!;
  return c.replace(/\s+/g, "");
}

/** Scanning is the fastest way to do the next thing. This turns a code into what it names and, where one action is obvious, does it. */
export default async function scanRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "scan"));
  const body = z.object({ code: z.string().trim().min(2).max(200), action: z.string().max(30).optional(), appointmentId: z.string().uuid().optional(), patientId: z.string().uuid().optional(), doctorId: z.string().uuid().optional() });
  const prefixOf = async (tenantId: string) => (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug.slice(0, 3).toUpperCase();

  async function identify(tx: TenantTx, code: string) {
    const c = normaliseCode(code);
    if (/^A-[0-9a-f]{12}$/i.test(c)) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM hms.appointments WHERE right(id::text, 12) = ${c.slice(2).toLowerCase()} LIMIT 1`;
      if (rows[0]) return { kind: "APPOINTMENT" as const, id: rows[0].id };
    }
    if (/^[0-9A-F]{12}$/.test(c.toUpperCase())) {
      const rx = await tx.consultation.findUnique({ where: { rxCode: c.toUpperCase() }, select: { id: true } });
      if (rx) return { kind: "PRESCRIPTION" as const, id: rx.id };
    }
    const up = c.toUpperCase();
    const rxNo = await tx.consultation.findFirst({ where: { rxNo: up }, select: { id: true } });
    if (rxNo) return { kind: "PRESCRIPTION" as const, id: rxNo.id };
    const lab = await tx.labOrder.findFirst({ where: { orderNo: up }, select: { id: true } });
    if (lab) return { kind: "LAB_ORDER" as const, id: lab.id };
    const card = await tx.healthCard.findFirst({ where: { cardNo: up }, select: { id: true } });
    if (card) return { kind: "HEALTH_CARD" as const, id: card.id };
    const inv = await tx.invoice.findFirst({ where: { invoiceNo: { equals: c, mode: "insensitive" } }, select: { id: true } });
    if (inv) return { kind: "INVOICE" as const, id: inv.id };
    const pat = await tx.patient.findFirst({ where: { patientNo: { equals: c, mode: "insensitive" } }, select: { id: true } });
    if (pat) return { kind: "PATIENT" as const, id: pat.id };
    const med = await tx.medicine.findFirst({ where: { barcode: c }, select: { id: true } });
    if (med) return { kind: "MEDICINE" as const, id: med.id };
    const abha = c.replace(/[\s-]/g, "");
    if (/^\d{14}$/.test(abha)) {
      const byAbha = await tx.patient.findFirst({ where: { abhaNumber: abha }, select: { id: true } });
      if (byAbha) return { kind: "PATIENT" as const, id: byAbha.id };
    }
    if (/^[6-9]\d{9}$/.test(c)) {
      const byPhone = await tx.patient.findMany({ where: { phone: c }, select: { id: true }, take: 2 });
      if (byPhone.length === 1) return { kind: "PATIENT" as const, id: byPhone[0]!.id };
    }
    return null;
  }

  const patientBrief = (p: { id: string; fullName: string; patientNo: string }) => ({ id: p.id, fullName: p.fullName, patientNo: p.patientNo });

  /** The reception move: a patient arrives, someone scans, and they are checked in. */
  async function arrive(req: Parameters<typeof staff>[0], tx: TenantTx, patientId: string, o: { appointmentId?: string; walkIn?: boolean; doctorId?: string }): Promise<ScanResult> {
    const tenantId = staff(req).tid;
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: patientId } });
    const who = patientBrief(patient);
    if (!hasPermission(req, "appointments:write")) return { kind: "PATIENT", outcome: "DENIED", tone: "error", title: patient.fullName, message: "You do not have permission to check patients in.", patient: who };
    const { from, to } = dayRange(todayIst());
    const today = await tx.appointment.findMany({ where: { patientId, ...inScope(req), scheduledAt: { gte: from, lt: to }, status: { in: ["SCHEDULED", "CHECKED_IN", "IN_PROGRESS"] } }, include: { doctor: { select: { fullName: true } } }, orderBy: { scheduledAt: "asc" } });
    const branch = req.access!.allowed.find((b) => b.id === req.access!.branchId)!;
    const prefix = await prefixOf(tenantId);

    let target = o.appointmentId ? today.find((a) => a.id === o.appointmentId) : undefined;
    if (!target && !o.walkIn) {
      const open = today.filter((a) => a.status === "SCHEDULED");
      if (open.length > 1) return { kind: "PATIENT", outcome: "CHOOSE", tone: "info", title: patient.fullName, message: "More than one appointment today. Tap the right one.", patient: who, choices: open.map((a) => ({ id: a.id, label: `${hm(a.scheduledAt)} · token #${a.tokenNo}`, sub: a.doctor?.fullName ? `Dr ${a.doctor.fullName.replace(/^Dr\.?\s+/i, "")}` : "Any doctor" })) };
      target = open[0] ?? today[0];
    }

    if (target?.status === "CHECKED_IN" || target?.status === "IN_PROGRESS") {
      return { kind: "PATIENT", outcome: "INFO", tone: "info", title: patient.fullName, message: target.status === "IN_PROGRESS" ? "Already with the doctor." : `Already checked in. Waiting, token #${target.tokenNo}.`, patient: who, facts: [{ label: "Token", value: `#${target.tokenNo}` }] };
    }
    if (target) {
      const done = await checkIn(tx, target, { tenantPrefix: prefix, branch, createdBy: staff(req).sub });
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "appointment.checkin", entity: "appointment", entityId: target.id, meta: { via: "scan" } } });
      const inv = done.invoice;
      return {
        kind: "PATIENT", outcome: "DONE", tone: "success", title: patient.fullName, patient: who,
        message: done.feeWaived ? "Checked in. Covered by the health card, nothing to collect." : inv && inv.totalPaise > inv.paidPaise ? `Checked in. Collect ${rupees(inv.totalPaise - inv.paidPaise)}.` : "Checked in.",
        appointmentId: done.id,
        facts: [{ label: "Token", value: `#${done.tokenNo}` }, { label: "Time", value: hm(done.scheduledAt) }, ...(target.doctor?.fullName ? [{ label: "Doctor", value: `Dr ${target.doctor.fullName.replace(/^Dr\.?\s+/i, "")}` }] : []), ...(inv ? [{ label: "Bill", value: done.feeWaived ? "Covered by card" : `${rupees(inv.totalPaise)}${inv.paidPaise >= inv.totalPaise ? " · paid" : " · due"}` }] : [])],
        open: undefined,
      };
    }
    if (!o.walkIn) return { kind: "PATIENT", outcome: "NEEDS_BOOKING", tone: "warning", title: patient.fullName, message: "No appointment today. Check in as a walk-in?", patient: who };

    // A walk-in: book it for now and check them in, in one go.
    const now = new Date();
    const appt = await tx.appointment.create({ data: { tenantId, branchId: branch.id, patientId, doctorId: o.doctorId ?? null, scheduledAt: now, tokenNo: await nextToken(tx, tenantId, branch.code, now), channel: "IN_PERSON", reason: "Walk-in" } });
    const done = await checkIn(tx, appt, { tenantPrefix: prefix, branch, createdBy: staff(req).sub });
    await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "appointment.walkin", entity: "appointment", entityId: appt.id, meta: { via: "scan" } } });
    const inv = done.invoice;
    return { kind: "PATIENT", outcome: "DONE", tone: "success", title: patient.fullName, patient: who, message: done.feeWaived ? "Walk-in checked in. Covered by the health card." : inv ? `Walk-in checked in. Collect ${rupees(inv.totalPaise - inv.paidPaise)}.` : "Walk-in checked in.", appointmentId: done.id, facts: [{ label: "Token", value: `#${done.tokenNo}` }] };
  }

  app.post("/scan", { preHandler: staffGuard("patients:read") }, async (req): Promise<ScanResult> => {
    const input = body.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      // A choice made on screen carries its own ids; no need to scan again.
      if (input.appointmentId || (input.patientId && input.action)) {
        const pid = input.patientId ?? (await tx.appointment.findFirstOrThrow({ where: { id: input.appointmentId, ...inScope(req) } })).patientId;
        return arrive(req, tx, pid, { appointmentId: input.appointmentId, walkIn: input.action === "walkin", doctorId: input.doctorId });
      }
      const hit = await identify(tx, input.code);
      if (!hit) return { kind: "UNKNOWN", outcome: "NOT_FOUND", tone: "error", title: "Not recognised", message: `Nothing matches “${normaliseCode(input.code).slice(0, 40)}”. Check the code or search by name.` };

      switch (hit.kind) {
        case "APPOINTMENT": {
          const a = await tx.appointment.findFirstOrThrow({ where: { id: hit.id } });
          if (!req.access!.branchIds.includes(a.branchId)) return { kind: "APPOINTMENT", outcome: "DENIED", tone: "error", title: "Another branch", message: "That slip belongs to a different branch. Switch branch to use it." };
          if (a.status === "COMPLETED" || a.status === "CANCELLED" || a.status === "NO_SHOW") {
            return { kind: "APPOINTMENT", outcome: "INFO", tone: "warning", title: "Visit is closed", message: `This appointment is ${a.status.toLowerCase().replace("_", " ")}.`, open: `/patients/${a.patientId}` };
          }
          return arrive(req, tx, a.patientId, { appointmentId: a.id });
        }
        case "PATIENT": return arrive(req, tx, hit.id, {});
        case "HEALTH_CARD": {
          const card = await tx.healthCard.findUniqueOrThrow({ where: { id: hit.id }, include: { members: { include: { patient: true } }, plan: true } });
          if (card.members.length === 1) return arrive(req, tx, card.members[0]!.patientId, {});
          return { kind: "HEALTH_CARD", outcome: "CHOOSE", tone: "info", title: `Card ${card.cardNo}`, message: `${card.plan.name}. Who is here?`, choices: card.members.map((m) => ({ id: m.patientId, label: m.patient.fullName, sub: m.patient.patientNo })) };
        }
        case "LAB_ORDER": {
          const o = await tx.labOrder.findFirstOrThrow({ where: { id: hit.id }, include: { patient: { select: { id: true, fullName: true, patientNo: true } }, items: { select: { testName: true } } } });
          const who = patientBrief(o.patient);
          const facts = [{ label: "Tests", value: o.items.map((i) => i.testName).join(", ") }, { label: "Status", value: o.status.toLowerCase() }];
          if (o.status === "ORDERED") {
            if (!hasPermission(req, "lab:write")) return { kind: "LAB_ORDER", outcome: "DENIED", tone: "error", title: o.orderNo, message: "You do not have permission to collect samples.", patient: who };
            await tx.labOrder.update({ where: { id: o.id }, data: { status: "COLLECTED", collectedAt: new Date() } });
            await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "lab.collect", entity: "lab_order", entityId: o.id, meta: { via: "scan" } } });
            return { kind: "LAB_ORDER", outcome: "DONE", tone: "success", title: `${o.orderNo} · ${o.patient.fullName}`, message: "Sample marked as collected. Results can be entered now.", patient: who, facts, open: undefined };
          }
          if (o.status === "CANCELLED") return { kind: "LAB_ORDER", outcome: "INFO", tone: "warning", title: o.orderNo, message: "This order was cancelled.", patient: who, facts };
          return { kind: "LAB_ORDER", outcome: "INFO", tone: "info", title: `${o.orderNo} · ${o.patient.fullName}`, message: o.status === "COLLECTED" ? "Already collected. Opening it to enter results." : o.status === "RESULTED" ? "Results are in. Opening it to release." : "Released. Opening the report.", patient: who, facts, open: `/lab?order=${o.id}` };
        }
        case "INVOICE": {
          const i = await tx.invoice.findFirstOrThrow({ where: { id: hit.id }, include: { patient: { select: { id: true, fullName: true, patientNo: true } } } });
          const due = i.totalPaise - i.paidPaise;
          return { kind: "INVOICE", outcome: "INFO", tone: due > 0 && i.status !== "VOID" ? "warning" : "info", title: `${i.invoiceNo}${i.patient ? ` · ${i.patient.fullName}` : ""}`, message: i.status === "VOID" ? "This bill was voided." : due > 0 ? `${rupees(due)} due. Opening it to take payment.` : "Paid in full.", patient: i.patient ? patientBrief(i.patient) : undefined, facts: [{ label: "Total", value: rupees(i.totalPaise) }, { label: "Status", value: i.status.toLowerCase() }], open: hasPermission(req, "billing:read") ? `/billing?invoice=${i.id}` : undefined };
        }
        case "PRESCRIPTION": {
          const c = await tx.consultation.findFirstOrThrow({ where: { id: hit.id }, include: { patient: { select: { id: true, fullName: true, patientNo: true } }, items: true, dispenses: { select: { id: true } } } });
          const who = patientBrief(c.patient);
          if (!c.completedAt) return { kind: "PRESCRIPTION", outcome: "INFO", tone: "warning", title: c.rxNo ?? "Prescription", message: "This prescription is not signed yet.", patient: who };
          const dispensed = c.dispenses.length > 0;
          return { kind: "PRESCRIPTION", outcome: "INFO", tone: dispensed ? "warning" : "success", title: `${c.rxNo} · ${c.patient.fullName}`, message: dispensed ? "Already dispensed once." : hasPermission(req, "pharmacy:pos") ? "Loading it into the counter." : "Opening the patient record.", patient: who, facts: [{ label: "Medicines", value: c.items.map((i) => i.name).join(", ") || "none" }], open: hasPermission(req, "pharmacy:pos") && !dispensed ? `/pharmacy/pos?rx=${c.id}` : `/patients/${c.patientId}` };
        }
        case "MEDICINE": {
          const m = await tx.medicine.findFirstOrThrow({ where: { id: hit.id } });
          return { kind: "MEDICINE", outcome: "INFO", tone: "info", title: `${m.name}${m.strength ? ` ${m.strength}` : ""}`, message: "Medicine barcode. Scan it at the pharmacy counter to sell, or at goods receipt to add stock.", open: hasPermission(req, "pharmacy:read") ? `/pharmacy/inventory?q=${encodeURIComponent(m.barcode ?? m.name)}` : undefined };
        }
      }
      throw httpError(400, "Unsupported code");
    });
  });

  // ── what the unified search bar and the Ctrl+K palette ask ──
  app.get("/search", { preHandler: staffGuard("patients:read") }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
    const digits = q.replace(/\D/g, "");
    return withTenant(db, staff(req).tid, async (tx) => {
      const out: Record<string, unknown[]> = { patients: [], invoices: [], lab: [], medicines: [], documents: [], appointments: [] };
      out["patients"] = await tx.patient.findMany({
        where: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { patientNo: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] },
        select: { id: true, fullName: true, patientNo: true, phone: true, gender: true, dateOfBirth: true }, orderBy: { createdAt: "desc" }, take: 6,
      });
      if (hasPermission(req, "appointments:read")) {
        const { from, to } = dayRange(todayIst());
        out["appointments"] = await tx.appointment.findMany({ where: { ...inScope(req), scheduledAt: { gte: from, lt: to }, patient: { fullName: { contains: q, mode: "insensitive" } } }, select: { id: true, tokenNo: true, status: true, scheduledAt: true, patient: { select: { fullName: true } } }, orderBy: { scheduledAt: "asc" }, take: 4 });
      }
      if (hasPermission(req, "billing:read")) out["invoices"] = await tx.invoice.findMany({ where: { ...inScope(req), invoiceNo: { contains: q, mode: "insensitive" } }, select: { id: true, invoiceNo: true, totalPaise: true, status: true, patient: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 4 });
      if (hasPermission(req, "lab:read")) out["lab"] = await tx.labOrder.findMany({ where: { ...inScope(req), orderNo: { contains: q, mode: "insensitive" } }, select: { id: true, orderNo: true, status: true, patient: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 4 });
      if (hasPermission(req, "pharmacy:read")) out["medicines"] = await tx.medicine.findMany({ where: { active: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { genericName: { contains: q, mode: "insensitive" } }, { barcode: q }] }, select: { id: true, name: true, strength: true, pricePaise: true }, take: 5 });
      if (hasPermission(req, "documents:read")) out["documents"] = await tx.patientDocument.findMany({ where: { removedAt: null, OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }] }, select: { id: true, title: true, kind: true, patient: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 4 });
      return out;
    });
  });

}
