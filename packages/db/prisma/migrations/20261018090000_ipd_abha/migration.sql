-- CreateEnum
CREATE TYPE "hms"."BedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "hms"."AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "hms"."DischargeType" AS ENUM ('RECOVERED', 'REFERRED', 'LAMA', 'ABSCONDED', 'DEATH');

-- AlterEnum
ALTER TYPE "hms"."InvoiceSource" ADD VALUE 'IPD';

-- AlterTable
ALTER TABLE "hms"."patients" ADD COLUMN     "abha_address" TEXT,
ADD COLUMN     "abha_number" TEXT;

-- CreateTable
CREATE TABLE "hms"."wards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "daily_rate_paise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."beds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ward_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "hms"."BedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."admissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_no" TEXT NOT NULL,
    "bed_id" UUID,
    "doctor_id" UUID NOT NULL,
    "admitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "provisional_diagnosis" TEXT,
    "expected_discharge_on" DATE,
    "status" "hms"."AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "discharged_at" TIMESTAMPTZ(3),
    "discharge_type" "hms"."DischargeType",
    "summary" JSONB,
    "discharged_by" UUID,
    "invoice_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."bed_stays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "ward_name" TEXT NOT NULL,
    "bed_code" TEXT NOT NULL,
    "daily_rate_paise" INTEGER NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to_at" TIMESTAMPTZ(3),

    CONSTRAINT "bed_stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."admission_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "vitals" JSONB,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wards_tenant_id_id_key" ON "hms"."wards"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wards_tenant_id_branch_id_name_key" ON "hms"."wards"("tenant_id", "branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "beds_tenant_id_id_key" ON "hms"."beds"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "beds_tenant_id_ward_id_code_key" ON "hms"."beds"("tenant_id", "ward_id", "code");

-- CreateIndex
CREATE INDEX "admissions_tenant_id_status_admitted_at_idx" ON "hms"."admissions"("tenant_id", "status", "admitted_at" DESC);

-- CreateIndex
CREATE INDEX "admissions_tenant_id_patient_id_idx" ON "hms"."admissions"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_tenant_id_id_key" ON "hms"."admissions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_tenant_id_admission_no_key" ON "hms"."admissions"("tenant_id", "admission_no");

-- CreateIndex
CREATE INDEX "bed_stays_tenant_id_admission_id_idx" ON "hms"."bed_stays"("tenant_id", "admission_id");

-- CreateIndex
CREATE INDEX "bed_stays_tenant_id_from_at_idx" ON "hms"."bed_stays"("tenant_id", "from_at");

-- CreateIndex
CREATE INDEX "admission_notes_tenant_id_admission_id_created_at_idx" ON "hms"."admission_notes"("tenant_id", "admission_id", "created_at");

-- AddForeignKey
ALTER TABLE "hms"."wards" ADD CONSTRAINT "wards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."wards" ADD CONSTRAINT "wards_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."beds" ADD CONSTRAINT "beds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."beds" ADD CONSTRAINT "beds_tenant_id_ward_id_fkey" FOREIGN KEY ("tenant_id", "ward_id") REFERENCES "hms"."wards"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_tenant_id_bed_id_fkey" FOREIGN KEY ("tenant_id", "bed_id") REFERENCES "hms"."beds"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."bed_stays" ADD CONSTRAINT "bed_stays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."bed_stays" ADD CONSTRAINT "bed_stays_tenant_id_admission_id_fkey" FOREIGN KEY ("tenant_id", "admission_id") REFERENCES "hms"."admissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admission_notes" ADD CONSTRAINT "admission_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."admission_notes" ADD CONSTRAINT "admission_notes_tenant_id_admission_id_fkey" FOREIGN KEY ("tenant_id", "admission_id") REFERENCES "hms"."admissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═════════ Row level security ═════════
ALTER TABLE "hms"."wards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."wards" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."wards"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."beds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."beds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."beds"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."admissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."admissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."admissions"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."bed_stays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."bed_stays" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."bed_stays"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."admission_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."admission_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."admission_notes"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- ═════════ Integrity ═════════
-- Clinical and billing history is never erased: wards and beds are retired, admissions closed, notes superseded.
REVOKE DELETE ON "hms"."wards", "hms"."beds", "hms"."admissions", "hms"."bed_stays", "hms"."admission_notes" FROM "hms_app";
REVOKE UPDATE, DELETE ON "hms"."admission_notes" FROM "hms_app";
-- A patient is in one bed at a time, and a bed holds one patient at a time. The database refuses a double booking even when two nurses click at once.
CREATE UNIQUE INDEX "admissions_one_active_per_patient" ON "hms"."admissions"("tenant_id", "patient_id") WHERE "status" = 'ADMITTED';
CREATE UNIQUE INDEX "admissions_one_active_per_bed" ON "hms"."admissions"("tenant_id", "bed_id") WHERE "status" = 'ADMITTED' AND "bed_id" IS NOT NULL;
CREATE UNIQUE INDEX "bed_stays_one_open_per_admission" ON "hms"."bed_stays"("tenant_id", "admission_id") WHERE "to_at" IS NULL;
ALTER TABLE "hms"."wards" ADD CONSTRAINT "wards_chk" CHECK (daily_rate_paise >= 0 AND kind IN ('GENERAL', 'SEMI_PRIVATE', 'PRIVATE', 'ICU', 'NICU', 'MATERNITY', 'EMERGENCY', 'DAY_CARE'));
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_chk" CHECK (
  ((status = 'DISCHARGED') = (discharged_at IS NOT NULL AND discharge_type IS NOT NULL))
  AND (status <> 'ADMITTED' OR bed_id IS NOT NULL OR true));
ALTER TABLE "hms"."bed_stays" ADD CONSTRAINT "bed_stays_chk" CHECK (daily_rate_paise >= 0 AND (to_at IS NULL OR to_at >= from_at));
ALTER TABLE "hms"."admission_notes" ADD CONSTRAINT "admission_notes_chk" CHECK (kind IN ('NOTE', 'VITALS', 'ROUND', 'ORDER') AND (text IS NOT NULL OR vitals IS NOT NULL));
ALTER TABLE "hms"."patients" ADD CONSTRAINT "patients_abha_chk" CHECK (abha_number IS NULL OR abha_number ~ '^[0-9]{14}$');
CREATE INDEX "patients_abha_idx" ON "hms"."patients"("tenant_id", "abha_number") WHERE "abha_number" IS NOT NULL;

-- Existing hospitals: the built-in roles gain the new permissions (a hospital that has edited a role keeps its edit and can add them itself).
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['ipd:read', 'ipd:write', 'ipd:manage', 'executive:read']))) WHERE "is_system" AND "key" = 'ADMIN';
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['ipd:read', 'ipd:write']))) WHERE "is_system" AND "key" IN ('DOCTOR', 'NURSE', 'RECEPTIONIST');
