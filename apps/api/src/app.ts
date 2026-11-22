import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import { configureAuthz } from "./authz";
import { configureSecurity } from "./security";
import jwt from "@fastify/jwt";
import { readOnlyGate } from "./gates";
import { ZodError } from "zod";
import type { AccessClaims } from "@hms/auth";
import type { PrismaClient } from "@hms/db";
import type { PaymentGateway } from "@hms/billing-core";
import type { MessageProvider } from "@hms/notifications";
import accessRoutes from "./routes/access";
import accountRoutes from "./routes/account";
import authRoutes from "./routes/auth";
import billingRoutes from "./routes/billing";
import clinicalRoutes from "./routes/clinical";
import doctorRoutes from "./routes/doctors";
import labRoutes from "./routes/lab";
import messagesRoutes from "./routes/messages";
import pharmacyAdminRoutes from "./routes/pharmacyAdmin";
import pharmacyRoutes from "./routes/pharmacy";
import pharmacyReportRoutes from "./routes/pharmacyReports";
import posRoutes from "./routes/pos";
import purchasingRoutes from "./routes/purchasing";
import platformRoutes from "./routes/platform";
import executiveRoutes from "./routes/executive";
import insuranceRoutes from "./routes/insurance";
import otRoutes from "./routes/ot";
import erRoutes from "./routes/er";
import workforceRoutes from "./routes/workforce";
import feedbackRoutes from "./routes/feedback";
import exportRoutes from "./routes/exports";
import mfaRoutes from "./routes/mfa";
import ipdRoutes from "./routes/ipd";
import platformAnalyticsRoutes from "./routes/platformAnalytics";
import platformOpsRoutes, { announcementRoutes } from "./routes/platformOps";
import teamRoutes from "./routes/team";
import webhookRoutes from "./routes/webhooks";
import analyticsRoutes from "./routes/analytics";
import documentRoutes from "./routes/documents";
import historyRoutes from "./routes/history";
import patientClinicalRoutes from "./routes/patientClinical";
import rxRoutes from "./routes/rx";
import printableRoutes from "./routes/printables";
import abdmRoutes from "./routes/abdm";
import scanRoutes from "./routes/scan";
import setupRoutes from "./routes/setup";
import rateLimit from "@fastify/rate-limit";
import taskRoutes from "./routes/tasks";
import teleRoutes from "./routes/tele";
import { createFileStore, type FileStore } from "./storage";
import { configureSyslog, noteError, registerRequestLogging } from "./syslog";
import patientAppRoutes from "./routes/patientApp";
import staffRoutes from "./routes/staff";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

export async function buildApp(db: PrismaClient, opts: { jwtSecret: string; provider: MessageProvider; gateway?: PaymentGateway | null; corsOrigins?: string[]; systemLog?: boolean; store?: FileStore; logger?: boolean; rateLimit?: boolean; messagingLive?: boolean }) {
  if (opts.jwtSecret.length < 32) throw new Error("JWT_SECRET must be 32+ characters");
  configureAuthz(db);
  configureSecurity(db);
  if (opts.systemLog !== false) configureSyslog(db);
  const app = Fastify({ logger: opts.logger ?? true, maxParamLength: 1000 }); // download links carry a signed token in the path

  await app.register(helmet);
  await app.register(cors, { origin: opts.corsOrigins ?? false, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"], credentials: true, allowedHeaders: ["content-type", "authorization", "x-requested-with", "x-branch-id"] });
  await app.register(cookie);
  // Brute force and runaway clients: generous for a busy desk behind one address, strict on sign-in and one-time codes.
  if (opts.rateLimit !== false) await app.register(rateLimit, { global: true, max: 1200, timeWindow: "1 minute", allowList: (req) => req.url === "/health" });
  await app.register(jwt, { secret: opts.jwtSecret, sign: { expiresIn: "15m" } });

  app.addHook("preHandler", readOnlyGate(db));

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "ValidationError", issues: err.issues });
    if (err.code === "P2025") return reply.code(404).send({ error: "Not found" });
    if (err.code === "P2002") return reply.code(409).send({ error: "Already exists" });
    if (err.code === "P2003") return reply.code(409).send({ error: "Invalid reference" });
    const status = err.statusCode ?? 500;
    if (status >= 500) { _req.log.error(err); noteError(_req, err); }
    return reply.code(status).send({ error: status >= 500 ? "Internal Server Error" : err.message, ...((err as { extra?: object }).extra ?? {}) });
  });

  if (opts.systemLog !== false) registerRequestLogging(app);
  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes, { db, secret: opts.jwtSecret, provider: opts.provider });
  await app.register(staffRoutes, { db });
  await app.register(accessRoutes, { db });
  await app.register(doctorRoutes, { db });
  await app.register(teamRoutes, { db });
  await app.register(accountRoutes, { db, gateway: opts.gateway ?? null });
  await app.register(platformRoutes, { db });
  await app.register(ipdRoutes, { db });
  await app.register(mfaRoutes, { db, secret: opts.jwtSecret });
  await app.register(exportRoutes, { db });
  await app.register(feedbackRoutes, { db });
  await app.register(workforceRoutes, { db });
  await app.register(erRoutes, { db });
  await app.register(otRoutes, { db });
  await app.register(insuranceRoutes, { db });
  await app.register(executiveRoutes, { db });
  await app.register(platformOpsRoutes, { db });
  await app.register(platformAnalyticsRoutes, { db });
  await app.register(announcementRoutes, { db });
  await app.register(messagesRoutes, { db });
  await app.register(billingRoutes, { db, gateway: opts.gateway ?? null });
  await app.register(webhookRoutes, { db, gateway: opts.gateway ?? null });
  await app.register(clinicalRoutes, { db });
  await app.register(pharmacyRoutes, { db });
  await app.register(posRoutes, { db });
  await app.register(pharmacyAdminRoutes, { db });
  await app.register(purchasingRoutes, { db });
  await app.register(pharmacyReportRoutes, { db });
  await app.register(labRoutes, { db });
  await app.register(patientAppRoutes, { db, gateway: opts.gateway ?? null });
  const store = opts.store ?? createFileStore();
  await app.register(documentRoutes, { db, store });
  await app.register(historyRoutes, { db });
  await app.register(analyticsRoutes, { db });
  await app.register(taskRoutes, { db });
  await app.register(scanRoutes, { db });
  await app.register(printableRoutes, { db });
  await app.register(abdmRoutes, { db });
  await app.register(setupRoutes, { db, messagingLive: opts.messagingLive ?? false, paymentsLive: !!opts.gateway });
  await app.register(rxRoutes, { db });
  await app.register(teleRoutes, { db });
  await app.register(patientClinicalRoutes, { db, store });
  return app;
}
