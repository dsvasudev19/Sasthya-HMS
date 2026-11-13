-- Schemas: nothing is ever created in "public". "platform" holds global data, "hms" holds tenant-owned data.
CREATE SCHEMA IF NOT EXISTS "platform";
CREATE SCHEMA IF NOT EXISTS "ext";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hms";

-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('HOSPITAL', 'CLINIC');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('PAY_PER_PATIENT', 'STARTER', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'PHARMACIST', 'LAB_TECH');

-- CreateEnum
CREATE TYPE "hms"."Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TenantKind" NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan_code" "PlanCode" NOT NULL DEFAULT 'PAY_PER_PATIENT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "shard" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."patients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_no" TEXT NOT NULL,
    "identity_id" UUID,
    "full_name" TEXT NOT NULL,
    "gender" "hms"."Gender",
    "date_of_birth" DATE,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_identity_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "identities_phone_key" ON "identities"("phone");

-- CreateIndex
CREATE INDEX "tenant_memberships_identity_id_idx" ON "tenant_memberships"("identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_identity_id_role_key" ON "tenant_memberships"("tenant_id", "identity_id", "role");

-- CreateIndex
CREATE INDEX "patients_tenant_id_phone_idx" ON "hms"."patients"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_id_key" ON "hms"."patients"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_patient_no_key" ON "hms"."patients"("tenant_id", "patient_no");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "hms"."audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_tenant_id_id_key" ON "hms"."audit_logs"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════ Tenant isolation: row-level security (hand-written, not modelled by Prisma) ═════════════

-- The tenant for the current transaction, set by the API with: SELECT set_config('app.tenant_id', '<uuid>', true)
-- Returns NULL when unset, which makes every policy match no rows.
CREATE FUNCTION "hms"."current_tenant_id"() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- patients
ALTER TABLE "hms"."patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."patients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."patients"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- audit_logs (append-only for the app role, see grants below)
ALTER TABLE "hms"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."audit_logs"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- ═════════════ Grants: the app role gets DML only, never DDL, never BYPASSRLS ═════════════

GRANT USAGE ON SCHEMA "platform", "hms", "ext" TO "hms_app";
GRANT EXECUTE ON FUNCTION "hms"."current_tenant_id"() TO "hms_app";

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "platform" TO "hms_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "hms" TO "hms_app";
REVOKE UPDATE, DELETE ON "hms"."audit_logs" FROM "hms_app";

-- Future tables created by migrations get the same grants (RLS must still be added per table; CI checks it).
ALTER DEFAULT PRIVILEGES IN SCHEMA "platform" GRANT SELECT, INSERT, UPDATE ON TABLES TO "hms_app";
ALTER DEFAULT PRIVILEGES IN SCHEMA "hms" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "hms_app";
