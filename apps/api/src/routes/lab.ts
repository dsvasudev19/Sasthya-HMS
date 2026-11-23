import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { labResultsInput, labTestInput, labTestPatch, releaseInput, sampleRejectInput, walkInLabOrderInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { featureGate } from "../gates";
import { authorize, hasPermission, inScope } from "../authz";
import { staff, staffGuard } from "../guards";
import { createLabOrder, flagFor, orderInclude } from "../lab";
import { reportReady } from "../notify";
import { labReportPdf } from "../pdf";
import { httpError, prefixOf } from "../util";

const idParam = z.object({ id: z.string().uuid() });

export default async function labRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "lab"));
  // ── catalogue ──
  app.get("/lab/tests", { preHandler: staffGuard("lab:read") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => tx.labTest.findMany({ where: { active: true }, orderBy: { name: "asc" } })),
  );
  app.post("/lab/tests", { preHandler: staffGuard("lab:write") }, async (req, reply) => {
    const input = labTestInput.parse(req.body);
    const created = await withTenant(db, staff(req).tid, (tx) => tx.labTest.create({ data: { tenantId: staff(req).tid, ...input } }));
    return reply.code(201).send(created);
  });
  app.patch("/lab/tests/:id", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = labTestPatch.parse(req.body);
    return withTenant(db, staff(req).tid, (tx) => tx.labTest.update({ where: { id }, data: input }));
  });

  // ── orders ──
  app.get("/lab/orders", { preHandler: staffGuard("lab:read") }, async (req) => {
    const { status, patientId } = z.object({ status: z.enum(["ORDERED", "COLLECTED", "RESULTED", "RELEASED", "CANCELLED"]).optional(), patientId: z.string().uuid().optional() }).parse(req.query);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.labOrder.findMany({ where: { ...inScope(req), ...(status ? { status } : {}), ...(patientId ? { patientId } : {}) }, include: orderInclude, orderBy: { createdAt: "desc" }, take: 100 }),
    );
  });

  app.get("/lab/orders/:id", { preHandler: staffGuard("lab:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, (tx) => tx.labOrder.findFirstOrThrow({ where: { id, ...inScope(req) }, include: orderInclude }));
  });

  // Walk-in or desk order (the doctor's in-visit order is POST /appointments/:id/lab-orders).
  app.post("/lab/orders", { preHandler: staffGuard("lab:write") }, async (req, reply) => {
    const input = walkInLabOrderInput.parse(req.body);
    const tenantId = staff(req).tid;
    const prefix = await prefixOf(db, tenantId);
    const order = await withTenant(db, tenantId, async (tx) => {
      if (!(await tx.patient.findUnique({ where: { id: input.patientId } }))) throw httpError(404, "Patient not found");
      return createLabOrder(tx, { tenantId, prefix, branch: { id: req.access!.branchId, code: req.access!.branchCode }, patientId: input.patientId, testIds: input.testIds, orderedBy: staff(req).sub, payment: input.payment });
    });
    return reply.code(201).send(order);
  });

  app.post("/lab/orders/:id/collect", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ sampleBarcode: z.string().trim().max(40).optional() }).parse(req.body ?? {});
    return withTenant(db, staff(req).tid, async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id, ...inScope(req) } });
      if (!o) throw httpError(404, "Order not found");
      if (o.status !== "ORDERED") throw httpError(409, `Order is already ${o.status.toLowerCase()}`);
      return tx.labOrder.update({
        where: { id },
        data: {
          status: "COLLECTED",
          collectedAt: new Date(),
          sampleBarcode: body.sampleBarcode ?? o.sampleBarcode,
        },
        include: orderInclude,
      });
    });
  });

  app.post("/lab/orders/:id/sample-reject", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { reason } = sampleRejectInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id, ...inScope(req) } });
      if (!o) throw httpError(404, "Order not found");
      if (o.status !== "COLLECTED") throw httpError(409, "Only collected samples can be rejected");

      await tx.auditLog.create({
        data: {
          tenantId,
          actorIdentityId: staff(req).sub,
          action: "lab.sample_reject",
          entity: "lab_order",
          entityId: id,
          meta: { reason },
        },
      });

      return tx.labOrder.update({
        where: { id },
        data: { status: "ORDERED", collectedAt: null, rejectionReason: reason },
        include: orderInclude,
      });
    });
  });

  // Enter results. Numeric results are flagged against the test's reference and critical limits.
  app.put("/lab/orders/:id/results", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { results } = labResultsInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id, ...inScope(req) }, include: { items: true } });
      if (!o) throw httpError(404, "Order not found");
      if (!["COLLECTED", "RESULTED"].includes(o.status)) throw httpError(409, o.status === "ORDERED" ? "Collect the sample first" : "Results are locked once released");
      for (const r of results) {
        const item = o.items.find((i) => i.id === r.itemId);
        if (!item) throw httpError(404, "Test not found in this order");
        const test = await tx.labTest.findUniqueOrThrow({ where: { id: item.testId } });
        if (r.resultValue === undefined && !r.resultText) throw httpError(400, `Enter a result for ${item.testName}`);
        await tx.labOrderItem.update({
          where: { id: item.id },
          data: {
            resultValue: r.resultValue ?? null,
            resultText: r.resultText ?? null,
            notes: r.notes ?? null,
            flag: r.resultValue !== undefined ? flagFor(r.resultValue, test) : null,
            resultedBy: staff(req).sub,
            resultedAt: new Date(),
          },
        });
      }
      const items = await tx.labOrderItem.findMany({ where: { orderId: id } });
      const done = items.every((i) => i.resultedAt);
      return tx.labOrder.update({ where: { id }, data: { status: done ? "RESULTED" : "COLLECTED" }, include: orderInclude });
    });
  });

  // Release the report to the patient. The bill must be paid, unless an owner/admin overrides.
  app.post("/lab/orders/:id/release", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { force } = releaseInput.parse(req.body ?? {});
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return withTenant(db, tenantId, async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id, ...inScope(req) }, include: { invoice: true } });
      if (!o) throw httpError(404, "Order not found");
      if (o.status !== "RESULTED") throw httpError(409, "All results must be entered before release");
      if (o.invoice && o.invoice.status !== "PAID") {
        const canOverride = hasPermission(req, "lab:release_override");
        if (!(force && canOverride)) throw httpError(409, "The bill is not paid yet. Collect payment before releasing the report.");
        authorize(req, "lab:release_override");
        await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "lab.release_unpaid", entity: "lab_order", entityId: id } });
      }
      const released = await tx.labOrder.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date(), releasedBy: staff(req).sub }, include: orderInclude });
      await reportReady(tx, tenant, { id: o.id, orderNo: o.orderNo, patientId: o.patientId });
      return released;
    });
  });

  app.post("/lab/orders/:id/cancel", { preHandler: staffGuard("lab:write") }, async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id, ...inScope(req) }, include: { invoice: true } });
      if (!o) throw httpError(404, "Order not found");
      if (!["ORDERED", "COLLECTED"].includes(o.status)) throw httpError(409, "Only orders without results can be cancelled");
      if (o.invoice && o.invoice.paidPaise > 0) throw httpError(409, "The bill has payments; ask the owner to handle the refund");
      if (o.invoice) await tx.invoice.update({ where: { id: o.invoice.id }, data: { status: "VOID", voidedAt: new Date() } });
      return tx.labOrder.update({ where: { id }, data: { status: "CANCELLED" }, include: orderInclude });
    });
  });

  app.get("/lab/stats", { preHandler: staffGuard("lab:read") }, async (req) => {
    return withTenant(db, staff(req).tid, async (tx) => {
      const [ordered, collected, resulted, released, critical] = await Promise.all([
        tx.labOrder.count({ where: { ...inScope(req), status: "ORDERED" } }),
        tx.labOrder.count({ where: { ...inScope(req), status: "COLLECTED" } }),
        tx.labOrder.count({ where: { ...inScope(req), status: "RESULTED" } }),
        tx.labOrder.count({ where: { ...inScope(req), status: "RELEASED" } }),
        tx.labOrderItem.count({ where: { order: inScope(req), flag: { in: ["CRITICAL_LOW", "CRITICAL_HIGH"] } } }),
      ]);
      return { ordered, collected, resulted, released, critical };
    });
  });

  app.get("/lab/orders/:id/report.pdf", { preHandler: staffGuard("lab:read") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const tenantId = staff(req).tid;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const profile = await db.tenantProfile.findUnique({ where: { tenantId } });

    const order = await withTenant(db, tenantId, async (tx) => {
      return tx.labOrder.findFirst({
        where: { id, ...inScope(req) },
        include: {
          ...orderInclude,
          branch: { select: { name: true, address: true, phone: true } },
          consultation: { include: { appointment: { include: { doctor: { select: { fullName: true } } } } } },
        },
      });
    });
    if (!order) throw httpError(404, "Lab order not found");

    const releasedStaff = order.releasedBy ? await db.identity.findUnique({ where: { id: order.releasedBy } }) : null;

    const pdf = await labReportPdf({
      hospital: {
        name: profile?.legalName || tenant.name,
        branchName: order.branch.name,
        address: profile?.addressLine1 || order.branch.address,
        phone: profile?.contactPhone || order.branch.phone,
        gstin: profile?.gstin,
      },
      order: {
        orderNo: order.orderNo,
        sampleBarcode: order.sampleBarcode,
        createdAt: order.createdAt,
        collectedAt: order.collectedAt,
        releasedAt: order.releasedAt,
        doctor: order.consultation?.appointment?.doctor?.fullName,
        clinicalNotes: order.clinicalNotes,
      },
      patient: {
        name: order.patient.fullName,
        patientNo: order.patient.patientNo,
        gender: order.patient.gender,
        dob: order.patient.dateOfBirth,
        phone: order.patient.phone,
      },
      items: order.items.map((i) => ({
        testName: i.testName,
        unit: i.unit,
        refRange: i.refRange,
        resultText: i.resultText,
        resultValue: i.resultValue ? i.resultValue.toString() : null,
        flag: i.flag,
        notes: i.notes,
        method: i.method,
      })),
      releasedBy: {
        name: releasedStaff?.fullName || "Pathologist On Duty",
      },
    });

    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="lab-report-${order.orderNo}.pdf"`)
      .send(pdf);
  });
}
