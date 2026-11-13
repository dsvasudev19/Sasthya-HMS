import type { PrismaClient } from "@hms/db";

export const httpError = (statusCode: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { statusCode, extra });

/** Three-letter hospital prefix used in numbers like SUN-2026-00012. */
export const prefixOf = async (db: PrismaClient, tenantId: string) =>
  (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug.slice(0, 3).toUpperCase();
