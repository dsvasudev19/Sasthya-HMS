import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { doctorLeaveInput, doctorProfileInput, doctorScheduleInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { doctorSlots } from "../booking";
import { listDoctors } from "../doctorList";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

const idParam = z.object({ id: z.string().uuid() });

export default async function doctorRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  const doctors = (tenantId: string) => listDoctors(db, tenantId);

  app.get("/doctors", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const all = await doctors(staff(req).tid);
    // For booking: only doctors who are active and (when they have a profile) work at the branch being viewed.
    return all.filter((d) => d.active && (!d.hasProfile || d.branchIds.includes(req.access!.branchId) || d.branchIds.length === 0));
  });

  app.get("/doctors/:id/slots", { preHandler: staffGuard("appointments:read") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { date, branchId } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.string().uuid().optional() }).parse(req.query);
    const branch = branchId && req.access!.allowed.some((b) => b.id === branchId) ? branchId : req.access!.branchId;
    const slots = await withTenant(db, staff(req).tid, (tx) => doctorSlots(tx, staff(req).tid, id, branch, date));
    return slots.map((s) => ({ time: s.time.toISOString(), available: s.available }));
  });

  // ── management ──
  app.get("/doctor-profiles", { preHandler: staffGuard("doctors:manage") }, async (req) => {
    const tenantId = staff(req).tid;
    const list = await doctors(tenantId);
    const profiles = await withTenant(db, tenantId, (tx) => tx.doctorProfile.findMany({ include: { schedules: true, leaves: { where: { toDate: { gte: new Date() } }, orderBy: { fromDate: "asc" } } } }));
    return list.map((d) => ({ ...d, schedules: profiles.find((p) => p.identityId === d.id)?.schedules ?? [], leaves: profiles.find((p) => p.identityId === d.id)?.leaves ?? [] }));
  });

  app.put("/doctor-profiles/:id", { preHandler: staffGuard("doctors:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = doctorProfileInput.parse(req.body);
    const tenantId = staff(req).tid;
    if (!(await doctors(tenantId)).some((d) => d.id === id)) throw httpError(404, "That staff member cannot see patients. Give their role the clinical permission first.");
    return withTenant(db, tenantId, (tx) =>
      tx.doctorProfile.upsert({ where: { tenantId_identityId: { tenantId, identityId: id } }, update: input, create: { tenantId, identityId: id, ...input } }),
    );
  });

  // Replaces the weekly schedule at one branch.
  app.put("/doctor-profiles/:id/schedule", { preHandler: staffGuard("doctors:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { branchId, slots } = doctorScheduleInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      const profile = await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId, identityId: id } } });
      if (!profile) throw httpError(404, "Create the doctor's profile first");
      if (!(await tx.branch.findUnique({ where: { tenantId_id: { tenantId, id: branchId } } }))) throw httpError(404, "Branch not found");
      // Overlapping shifts on the same weekday would double the slots.
      for (const a of slots) for (const b of slots) if (a !== b && a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) throw httpError(400, "Shifts on the same day overlap");
      await tx.doctorSchedule.deleteMany({ where: { doctorId: profile.id, branchId } });
      if (slots.length) await tx.doctorSchedule.createMany({ data: slots.map((s) => ({ tenantId, doctorId: profile.id, branchId, ...s })) });
      return tx.doctorSchedule.findMany({ where: { doctorId: profile.id, branchId }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] });
    });
  });

  app.post("/doctor-profiles/:id/leaves", { preHandler: staffGuard("doctors:manage") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = doctorLeaveInput.parse(req.body);
    const tenantId = staff(req).tid;
    const leave = await withTenant(db, tenantId, async (tx) => {
      const profile = await tx.doctorProfile.findUnique({ where: { tenantId_identityId: { tenantId, identityId: id } } });
      if (!profile) throw httpError(404, "Create the doctor's profile first");
      return tx.doctorLeave.create({ data: { tenantId, doctorId: profile.id, fromDate: new Date(`${input.fromDate}T00:00:00Z`), toDate: new Date(`${input.toDate}T00:00:00Z`), reason: input.reason } });
    });
    return reply.code(201).send(leave);
  });

  app.delete("/doctor-leaves/:id", { preHandler: staffGuard("doctors:manage") }, async (req) => {
    const { id } = idParam.parse(req.params);
    await withTenant(db, staff(req).tid, (tx) => tx.doctorLeave.delete({ where: { id } }));
    return { removed: true };
  });
}
