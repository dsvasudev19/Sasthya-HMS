import type { PrismaClient } from "@hms/db";

export interface Flag { enabled: boolean; value: Record<string, unknown> | null }
const TTL = 10_000;
let cache: { at: number; flags: Map<string, Flag> } | null = null;

/** Platform-wide switches set by the operator, cached for a few seconds so every request can look at them cheaply. */
export async function platformFlags(db: PrismaClient): Promise<Map<string, Flag>> {
  if (cache && Date.now() - cache.at < TTL) return cache.flags;
  const rows = await db.platformFlag.findMany();
  cache = { at: Date.now(), flags: new Map(rows.map((r) => [r.key, { enabled: r.enabled, value: (r.value as Record<string, unknown> | null) ?? null }])) };
  return cache.flags;
}
export const clearFlagCache = () => { cache = null; };
