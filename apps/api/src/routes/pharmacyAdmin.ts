import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectDuesInput, medicineImportInput, medicineImportRow } from "@hms/contracts";
import type { PrismaClient } from "@hms/db";
import { authorize, inScope } from "../authz";
import { recordPayment } from "../billing";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { receiveBatch, startOfToday } from "../stock";
import { httpError } from "../util";

const UUID = /^[0-9a-f-]{36}$/;

/** Bulk catalogue import and customer credit: the two things a busy counter needs that a single sale does not. */
export default async function pharmacyAdminRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "pharmacy"));

  // Rows are checked one by one so a typo on row 40 does not sink the other 499. `dryRun` reports what would happen without doing it.
  app.post("/medicines/import", { preHandler: [featureGate(db, "imports"), staffGuard("pharmacy:write")] }, async (req) => {
    const { rows, dryRun } = medicineImportInput.parse(req.body);
    const tenantId = staff(req).tid;
    if (!UUID.test(tenantId)) throw httpError(400, "Bad tenant");
    const result = { created: 0, updated: 0, stockAdded: 0, errors: [] as { row: number; name?: string; message: string }[] };
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const today = startOfToday();
      const pending = new Set<string>(); // what a dry run would already have created earlier in the same file
      for (const [i, raw] of rows.entries()) {
        const fail = (message: string) => result.errors.push({ row: i + 1, name: typeof raw["name"] === "string" ? raw["name"] : undefined, message });
        const p = medicineImportRow.safeParse(raw);
        if (!p.success) { fail(p.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ")); continue; }
        const r = p.data;
        const stock = [r.batchNo, r.expiryDate, r.qty].filter((x) => x !== undefined).length;
        if (stock !== 0 && stock !== 3) { fail("Opening stock needs batch number, expiry date and quantity together"); continue; }
        if (r.expiryDate && new Date(`${r.expiryDate}T00:00:00Z`) <= today) { fail("The batch is already expired"); continue; }
        const { batchNo, expiryDate, qty, costPaise, ...med } = r;
        try {
          // A savepoint per row: one failing insert must not abort the whole transaction.
          await tx.$executeRaw`SAVEPOINT row_import`;
          const existing = (med.barcode ? await tx.medicine.findFirst({ where: { barcode: med.barcode } }) : null) ?? (await tx.medicine.findFirst({ where: { name: { equals: med.name, mode: "insensitive" }, strength: med.strength ?? null } }));
          let id: string;
          const key = med.barcode ?? `${med.name.toLowerCase()}|${med.strength ?? ""}`;
          if (!existing && dryRun && (pending.has(key) || (med.barcode && pending.has(`${med.name.toLowerCase()}|${med.strength ?? ""}`)))) { result.updated++; id = ""; }
          else if (existing) { if (!dryRun) await tx.medicine.update({ where: { id: existing.id }, data: med }); id = existing.id; result.updated++; }
          else if (dryRun) { id = ""; pending.add(key); pending.add(`${med.name.toLowerCase()}|${med.strength ?? ""}`); result.created++; }
          else { id = (await tx.medicine.create({ data: { tenantId, ...med } })).id; result.created++; }
          if (stock === 3 && !dryRun) { await receiveBatch(tx, { tenantId, branchId: req.access!.branchId, medicineId: id, batchNo: batchNo!, expiryDate: new Date(`${expiryDate}T00:00:00Z`), qty: qty!, costPaise, by: staff(req).sub }); }
          if (stock === 3) result.stockAdded++;
          await tx.$executeRaw`RELEASE SAVEPOINT row_import`;
        } catch (e) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT row_import`;
          const code = (e as { code?: string }).code;
          fail(code === "P2002" ? "Another medicine already uses that barcode or name and strength" : (e as Error).message.split("\n").pop()!.slice(0, 160));
        }
      }
      if (!dryRun) await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "pharmacy.import", entity: "medicine", meta: { rows: rows.length, created: result.created, updated: result.updated, errors: result.errors.length } } });
    }, { timeout: 120_000, maxWait: 20_000 });
    return { ...result, dryRun };
  });

  // ── customer credit: who owes the pharmacy, and taking their payments ──
  app.get("/pharmacy/receivables", { preHandler: staffGuard("pharmacy:pos") }, async (req) => {
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${staff(req).tid}, true)`;
      return tx.invoice.groupBy({ by: ["patientId"], where: { ...inScope(req), source: "PHARMACY", status: { in: ["UNPAID", "PARTIAL"] }, patientId: { not: null } }, _sum: { totalPaise: true, paidPaise: true }, _count: { _all: true }, _min: { createdAt: true } });
    });
    const ids = rows.map((r) => r.patientId!) ;
    const people = await db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${staff(req).tid}, true)`; return tx.patient.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phone: true, patientNo: true } }); });
    return rows.map((r) => ({ patient: people.find((p) => p.id === r.patientId)!, duePaise: (r._sum.totalPaise ?? 0) - (r._sum.paidPaise ?? 0), bills: r._count._all, oldest: r._min.createdAt })).filter((r) => r.patient && r.duePaise > 0).sort((a, b) => b.duePaise - a.duePaise);
  });

  app.get("/pharmacy/receivables/:patientId", { preHandler: staffGuard("pharmacy:pos") }, async (req) => {
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${staff(req).tid}, true)`;
      const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, fullName: true, phone: true, patientNo: true } });
      if (!patient) throw httpError(404, "Customer not found");
      const bills = await tx.invoice.findMany({ where: { ...inScope(req), source: "PHARMACY", patientId, status: { in: ["UNPAID", "PARTIAL"] } }, orderBy: { createdAt: "asc" }, select: { id: true, invoiceNo: true, createdAt: true, totalPaise: true, paidPaise: true } });
      const recent = await tx.payment.findMany({ where: { invoice: { patientId, source: "PHARMACY" } }, orderBy: { receivedAt: "desc" }, take: 10, select: { id: true, amountPaise: true, method: true, receivedAt: true, invoice: { select: { invoiceNo: true } } } });
      return { patient, bills, duePaise: bills.reduce((a, b) => a + b.totalPaise - b.paidPaise, 0), recent };
    });
  });

  // A payment against the account is spread over the oldest open bills first.
  app.post("/pharmacy/receivables/:patientId/collect", { preHandler: staffGuard("pharmacy:pos") }, async (req, reply) => {
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);
    const input = collectDuesInput.parse(req.body);
    const tenantId = staff(req).tid;
    authorize(req, "pharmacy:pos", { amountPaise: input.amountPaise });
    const out = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dues:${patientId}`}, 0))`;
      const bills = await tx.invoice.findMany({ where: { ...inScope(req), source: "PHARMACY", patientId, status: { in: ["UNPAID", "PARTIAL"] } }, orderBy: { createdAt: "asc" } });
      const due = bills.reduce((a, b) => a + b.totalPaise - b.paidPaise, 0);
      if (input.amountPaise > due) throw httpError(409, `This customer owes ${(due / 100).toFixed(2)}. Take no more than that.`);
      let left = input.amountPaise;
      const applied: { invoiceNo: string; amountPaise: number }[] = [];
      for (const b of bills) {
        if (left === 0) break;
        const put = Math.min(left, b.totalPaise - b.paidPaise);
        await recordPayment(tx, tenantId, b.id, { amountPaise: put, method: input.method, reference: input.reference, receivedBy: staff(req).sub });
        applied.push({ invoiceNo: b.invoiceNo, amountPaise: put });
        left -= put;
      }
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "pharmacy.dues.collect", entity: "patient", entityId: patientId, meta: { amountPaise: input.amountPaise, method: input.method, bills: applied.length } } });
      return { collectedPaise: input.amountPaise, remainingPaise: due - input.amountPaise, applied };
    }, { timeout: 30_000 });
    return reply.code(201).send(out);
  });
}
