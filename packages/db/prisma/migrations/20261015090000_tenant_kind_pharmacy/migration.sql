-- A standalone pharmacy is a tenant kind of its own.
ALTER TYPE "platform"."TenantKind" ADD VALUE IF NOT EXISTS 'PHARMACY';
