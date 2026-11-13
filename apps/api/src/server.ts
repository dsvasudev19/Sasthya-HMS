import { createDb } from "@hms/db";
import { syncSystemRoles } from "@hms/db/access";
import { createGateway } from "@hms/billing-core";
import { createProvider } from "@hms/notifications";
import { buildApp } from "./app";
import { runDueSchedules } from "./exports";
import { flushLogs, purgeLogs } from "./syslog";

const jwtSecret = process.env["JWT_SECRET"];
if (!jwtSecret) throw new Error("JWT_SECRET must be set");

const db = createDb();
await syncSystemRoles(db); // brings every hospital's built-in roles up to date with the product defaults
const app = await buildApp(db, { jwtSecret, provider: createProvider(), gateway: createGateway(), corsOrigins: process.env["CORS_ORIGINS"]?.split(","), messagingLive: (process.env["MESSAGING_PROVIDER"] ?? "console") !== "console" });
// Keep the system log to its retention window, and write out what is buffered when the server is asked to stop.
setInterval(() => void purgeLogs(db).catch(() => undefined), 3_600_000).unref();
setInterval(() => void runDueSchedules(db).catch(() => undefined), 900_000).unref();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { void flushLogs().finally(() => process.exit(0)); });
await app.listen({ port: Number(process.env["PORT"] ?? 4000), host: "0.0.0.0" });
