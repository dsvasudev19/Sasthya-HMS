import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { manualMessageInput, messagingSettingsInput } from "@hms/contracts";
import { withTenant, type PrismaClient } from "@hms/db";
import { enqueueManual, getSettings, saveSettings } from "@hms/notifications";
import { featureGate } from "../gates";
import { staff, staffGuard } from "../guards";
import { httpError } from "../util";

export default async function messagesRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.addHook("preHandler", featureGate(db, "messaging"));
  app.get("/messages", { preHandler: staffGuard("messages:read") }, async (req) => {
    const { status, q } = z.object({ status: z.enum(["QUEUED", "SENT", "FAILED", "SKIPPED"]).optional(), q: z.string().trim().max(60).optional() }).parse(req.query);
    return withTenant(db, staff(req).tid, (tx) =>
      tx.message.findMany({
        where: { ...(status ? { status } : {}), ...(q ? { OR: [{ toPhone: { contains: q } }, { patient: { fullName: { contains: q, mode: "insensitive" } } }] } : {}) },
        include: { patient: { select: { id: true, fullName: true, patientNo: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  });

  // Messages sent so far this calendar month (IST), by status. Used for plan quotas.
  app.get("/messages/usage", { preHandler: staffGuard("messages:read") }, async (req) => {
    const ist = new Date(Date.now() + 5.5 * 3600_000);
    const from = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600_000);
    return withTenant(db, staff(req).tid, async (tx) => {
      const rows = await tx.message.groupBy({ by: ["status"], where: { createdAt: { gte: from } }, _count: { _all: true } });
      const by = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
      return { month: ist.toISOString().slice(0, 7), sent: by["SENT"] ?? 0, queued: by["QUEUED"] ?? 0, failed: by["FAILED"] ?? 0 };
    });
  });

  app.post("/messages", { preHandler: staffGuard("messages:write") }, async (req, reply) => {
    const { patientId, text } = manualMessageInput.parse(req.body);
    const tenantId = staff(req).tid;
    const ok = await withTenant(db, tenantId, (tx) => enqueueManual(tx, { tenantId, patientId, text }));
    if (!ok) throw httpError(400, "This patient has no mobile number");
    return reply.code(202).send({ queued: true });
  });

  app.post("/messages/:id/retry", { preHandler: staffGuard("messages:write") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(db, staff(req).tid, async (tx) => {
      const m = await tx.message.findUnique({ where: { id } });
      if (!m) throw httpError(404, "Message not found");
      if (m.status !== "FAILED") throw httpError(409, "Only failed messages can be retried");
      return tx.message.update({ where: { id }, data: { status: "QUEUED", attempts: 0, error: null, nextAttemptAt: new Date() } });
    });
  });

  app.get("/settings/messaging", { preHandler: staffGuard("messages:read") }, async (req) =>
    withTenant(db, staff(req).tid, (tx) => getSettings(tx, staff(req).tid)),
  );
  app.put("/settings/messaging", { preHandler: staffGuard("settings:write") }, async (req) => {
    const input = messagingSettingsInput.parse(req.body);
    const tenantId = staff(req).tid;
    return withTenant(db, tenantId, async (tx) => {
      await saveSettings(tx, tenantId, input);
      await tx.auditLog.create({ data: { tenantId, actorIdentityId: staff(req).sub, action: "settings.messaging", entity: "tenant_settings", meta: input } });
      return input;
    });
  });
}
