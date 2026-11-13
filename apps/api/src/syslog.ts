import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@hms/db";
import { platformFlags } from "./flags";

export interface LogEntry {
  level: "INFO" | "WARN" | "ERROR" | "SECURITY";
  source: string;
  message: string;
  tenantId?: string | null;
  identityId?: string | null;
  requestId?: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

let db: PrismaClient | null = null;
let buffer: LogEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const MAX = 2000;

/** The platform's own log: failures, slow requests, sign-in attempts. Written in batches so logging never slows a request, and never throws. */
export function configureSyslog(client: PrismaClient, opts: { flushMs?: number } = {}) {
  db = client;
  if (timer) clearInterval(timer);
  timer = setInterval(() => void flushLogs(), opts.flushMs ?? 2000);
  timer.unref?.();
}

export const logEvent = (e: LogEntry) => { if (!db) return; if (buffer.length >= MAX) buffer.shift(); buffer.push(e); };

export async function flushLogs() {
  if (!db || buffer.length === 0) return;
  const batch = buffer; buffer = [];
  try {
    await db.systemLog.createMany({
      data: batch.map((e) => ({
        level: e.level, source: e.source, message: e.message.slice(0, 500), tenantId: e.tenantId ?? null, identityId: e.identityId ?? null, requestId: e.requestId, method: e.method, route: e.route, status: e.status, durationMs: e.durationMs,
        ip: e.ip, userAgent: e.userAgent?.slice(0, 200), meta: e.meta && JSON.stringify(e.meta).length < 6000 ? (e.meta as never) : undefined,
      })),
    });
  } catch { /* a failing log write must never take the app down; the batch is dropped */ }
}

export async function purgeLogs(client: PrismaClient): Promise<number> {
  const days = Number((await platformFlags(client)).get("log_retention_days")?.value?.["days"] ?? 30);
  const r = await client.systemLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - Math.max(1, days) * 86_400_000) } } });
  return r.count;
}

const who = (req: FastifyRequest) => { const u = req.user as { tid?: string; sub?: string } | undefined; return { tenantId: u?.tid ?? null, identityId: u?.sub ?? null }; };
const errors = new WeakMap<object, { message: string; stack?: string }>();
export const noteError = (req: FastifyRequest, err: Error) => errors.set(req, { message: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") });

/** Records what is worth a line: server errors, slow requests and refused sign-ins or rate limits. Healthy fast requests are not stored. */
export function registerRequestLogging(app: FastifyInstance, opts: { slowMs?: number } = {}) {
  const slow = opts.slowMs ?? 2000;
  app.addHook("onResponse", (req, reply, done) => {
    const ms = Math.round(reply.elapsedTime), status = reply.statusCode, route = req.routeOptions?.url ?? req.url.split("?")[0];
    const base = { ...who(req), requestId: req.id, method: req.method, route, status, durationMs: ms, ip: req.ip, userAgent: req.headers["user-agent"] };
    if (status >= 500) { const e = errors.get(req); logEvent({ ...base, level: "ERROR", source: "api", message: e?.message ?? `Server error ${status}`, meta: e?.stack ? { stack: e.stack } : undefined }); }
    else if (status === 429) logEvent({ ...base, level: "SECURITY", source: "rate-limit", message: "Too many requests" });
    else if ((status === 401 || status === 403) && route.startsWith("/auth")) logEvent({ ...base, level: "SECURITY", source: "auth", message: status === 401 ? "Refused sign-in or token" : "Forbidden" });
    else if (ms >= slow) logEvent({ ...base, level: "WARN", source: "api", message: `Slow request (${ms} ms)` });
    done();
  });
}
