import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type PrismaClient } from "@hms/db";
import { hasFeature, effectivePlan } from "@hms/billing-core";
import { hasPermission } from "../authz";
import { staff, staffGuard } from "../guards";
import { featureGate } from "../gates";
import { nextSeq } from "@hms/db";

interface Step { key: string; title: string; detail: string; done: boolean; href: string; optional?: boolean }

/** Day-one readiness: what a new hospital still has to set up, worked out from its own data so it can never go stale. */
export default async function setupRoutes(app: FastifyInstance, { db, messagingLive, paymentsLive }: { db: PrismaClient; messagingLive: boolean; paymentsLive: boolean }) {
  app.get("/setup/status", { preHandler: staffGuard("patients:read") }, async (req) => {
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const pharmacy = tenant.kind === "PHARMACY" || hasFeature(effectivePlan(tenant), "pharmacy");
    const members = new Set((await db.tenantMembership.findMany({ where: { tenantId } })).map((m) => m.identityId)).size;
    const data = await withTenant(db, tenantId, async (tx) => ({
      profile: await tx.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: "profile" } } }),
      patients: await tx.patient.count(),
      appointments: await tx.appointment.count(),
      doctors: await tx.doctorSchedule.count(),
      medicines: await tx.medicine.count(),
      stock: await tx.stockBatch.count(),
      suppliers: await tx.supplier.count(),
      docs: await tx.patientDocument.count(),
    }));
    const p = (data.profile?.value ?? {}) as { address?: string; phone?: string; gstin?: string; upiVpa?: string; drugLicence?: string };
    const steps: Step[] = [
      { key: "profile", title: "Hospital profile", detail: "Name, address and phone are printed on every bill and prescription.", done: !!p.address && !!p.phone, href: "/settings?tab=profile" },
      ...(tenant.kind === "PHARMACY" ? [] : [{ key: "doctors", title: "Doctors and their hours", detail: "A weekly schedule lets patients book real free slots.", done: data.doctors > 0, href: "/settings?tab=doctors" }]),
      { key: "staff", title: "Your team", detail: "Give every person their own sign-in and a role.", done: members > 1, href: "/settings?tab=team" },
      { key: "patients", title: "Patients", detail: "Import your existing register from a spreadsheet, or start registering.", done: data.patients > 0, href: "/patients" },
      ...(pharmacy ? [
        { key: "medicines", title: "Medicine catalogue and opening stock", detail: "Import from a spreadsheet with batch, expiry and quantity.", done: data.medicines > 0 && data.stock > 0, href: "/pharmacy/inventory" },
        { key: "licence", title: "Drug licence and GSTIN on bills", detail: "Required on pharmacy tax invoices.", done: !!p.drugLicence && !!p.gstin, href: "/settings?tab=profile", optional: true },
      ] : []),
      { key: "payments", title: "Take payments online", detail: paymentsLive ? "Online payment links are switched on." : "Add a UPI id for bill QR codes. Card and UPI links need the payment gateway keys.", done: !!p.upiVpa || paymentsLive, href: "/settings?tab=profile", optional: true },
      { key: "messages", title: "SMS and WhatsApp", detail: messagingLive ? "Messages are being sent through your provider." : "Messages are only logged until a provider is connected. Patients will not receive reminders yet.", done: messagingLive, href: "/settings", optional: true },
      { key: "first", title: "First appointment", detail: "Book one to see the whole flow, from check-in to prescription.", done: data.appointments > 0, href: "/appointments" },
    ];
    const required = steps.filter((s) => !s.optional);
    return { steps, percent: Math.round((required.filter((s) => s.done).length / required.length) * 100), ready: required.every((s) => s.done), manage: hasPermission(req, "settings:write") || hasPermission(req, "team:manage") };
  });

  // ── bring an existing patient register across ──
  const patientRow = z.object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    language: z.enum(["en", "hi"]).optional(),
  });
  app.post("/patients/import", { preHandler: [featureGate(db, "imports"), staffGuard("patients:write")] }, async (req) => {
    const { rows, dryRun } = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500), dryRun: z.boolean().default(false) }).parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug.slice(0, 3).toUpperCase();
    const out = { created: 0, duplicates: 0, errors: [] as { row: number; name?: string; message: string }[] };
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const seen = new Set<string>();
      for (const [i, raw] of rows.entries()) {
        const parsed = patientRow.safeParse(raw);
        if (!parsed.success) { out.errors.push({ row: i + 1, name: typeof raw["fullName"] === "string" ? raw["fullName"] : undefined, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") }); continue; }
        const r = parsed.data;
        // The same person twice (same phone and name, in the file or already registered) is not added again.
        const key = `${r.fullName.toLowerCase()}|${r.phone ?? ""}`;
        const dup = seen.has(key) || (r.phone ? !!(await tx.patient.findFirst({ where: { phone: r.phone, fullName: { equals: r.fullName, mode: "insensitive" } } })) : false);
        if (dup) { out.duplicates++; continue; }
        seen.add(key);
        if (!dryRun) { const n = await nextSeq(tx, tenantId, "patient"); await tx.patient.create({ data: { tenantId, patientNo: `${prefix}-${String(n).padStart(6, "0")}`, fullName: r.fullName, phone: r.phone, gender: r.gender, dateOfBirth: r.dateOfBirth ? new Date(`${r.dateOfBirth}T00:00:00Z`) : undefined, language: r.language } }); }
        out.created++;
      }
      if (!dryRun) await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "patients.import", entity: "patient", meta: { rows: rows.length, created: out.created, duplicates: out.duplicates, errors: out.errors.length } } });
    }, { timeout: 120_000, maxWait: 20_000 });
    return { ...out, dryRun };
  });
}
