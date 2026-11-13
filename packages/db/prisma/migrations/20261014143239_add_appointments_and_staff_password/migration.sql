-- CreateEnum
CREATE TYPE "hms"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "hms"."VisitChannel" AS ENUM ('IN_PERSON', 'TELE');

-- AlterTable
ALTER TABLE "identities" ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "hms"."appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "token_no" INTEGER,
    "channel" "hms"."VisitChannel" NOT NULL DEFAULT 'IN_PERSON',
    "status" "hms"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_scheduled_at_idx" ON "hms"."appointments"("tenant_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_doctor_id_scheduled_at_idx" ON "hms"."appointments"("tenant_id", "doctor_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "hms"."appointments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "hms"."appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation for appointments (grants come from the default privileges set in the first migration).
ALTER TABLE "hms"."appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."appointments"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
