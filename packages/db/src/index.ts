import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";

export * from "../generated/prisma/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client that connects as the DML-only app role (DATABASE_URL). It cannot run DDL or bypass RLS. */
export function createDb(connectionString = process.env["DATABASE_URL"]): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type TenantTx = Prisma.TransactionClient;

/**
 * Runs `fn` in one transaction pinned to a tenant. `set_config(..., true)` is transaction-local, so it is safe
 * behind PgBouncer; row-level security then hides every other tenant's rows in `hms`.
 * The tenant id must come from the verified token + membership, never from the request body.
 */
export async function withTenant<T>(
  db: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("Invalid tenant id");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/** Owner-role client for migrations tooling, seeds and test fixtures. Never use it in request handling. */
export function createAdminDb(connectionString = process.env["MIGRATOR_DATABASE_URL"]): PrismaClient {
  if (!connectionString) throw new Error("MIGRATOR_DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString.replace(/\?schema=.*$/, "") }) });
}

/** Next value of a per-tenant sequence. Atomic, so concurrent requests never get the same number. */
export async function nextSeq(tx: TenantTx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO hms.counters (tenant_id, key, value) VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = hms.counters.value + 1
    RETURNING value`;
  return rows[0]!.value;
}
