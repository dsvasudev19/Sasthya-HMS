-- CreateEnum
CREATE TYPE "hms"."DocumentKind" AS ENUM ('PRESCRIPTION_SCAN', 'LAB_REPORT', 'IMAGING', 'DISCHARGE_SUMMARY', 'ID_PROOF', 'CONSENT', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "hms"."TeleStatus" AS ENUM ('WAITING', 'LIVE', 'ENDED', 'MISSED');

-- AlterTable
ALTER TABLE "hms"."consultations" ADD COLUMN     "rx_code" TEXT,
ADD COLUMN     "rx_no" TEXT;

-- AlterTable
ALTER TABLE "hms"."patients" ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "blood_group" TEXT,
ADD COLUMN     "chronic_conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clinical_notes" TEXT;

-- CreateTable
CREATE TABLE "hms"."documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "consultation_id" UUID,
    "kind" "hms"."DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "visible_to_patient" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."tele_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "room" TEXT NOT NULL,
    "status" "hms"."TeleStatus" NOT NULL DEFAULT 'WAITING',
    "patient_joined_at" TIMESTAMPTZ(3),
    "doctor_joined_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tele_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_tenant_id_patient_id_created_at_idx" ON "hms"."documents"("tenant_id", "patient_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_tenant_id_kind_created_at_idx" ON "hms"."documents"("tenant_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenant_id_id_key" ON "hms"."documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tele_sessions_tenant_id_id_key" ON "hms"."tele_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tele_sessions_tenant_id_appointment_id_key" ON "hms"."tele_sessions"("tenant_id", "appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tele_sessions_room_key" ON "hms"."tele_sessions"("room");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_rx_code_key" ON "hms"."consultations"("rx_code");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_tenant_id_rx_no_key" ON "hms"."consultations"("tenant_id", "rx_no");

-- AddForeignKey
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "hms"."appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_tenant_id_consultation_id_fkey" FOREIGN KEY ("tenant_id", "consultation_id") REFERENCES "hms"."consultations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."tele_sessions" ADD CONSTRAINT "tele_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."tele_sessions" ADD CONSTRAINT "tele_sessions_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "hms"."appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════ Row level security ═════════
ALTER TABLE "hms"."documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."documents"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."tele_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."tele_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."tele_sessions"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- ═════════ Integrity ═════════
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_size_chk" CHECK (size_bytes > 0 AND size_bytes <= 26214400);
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_mime_chk" CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "hms"."documents" ADD CONSTRAINT "documents_removal_chk" CHECK ((removed_at IS NULL) = (removed_by IS NULL));

-- Medical records are kept: a document can be hidden (removed_at) but the row is never deleted.
REVOKE DELETE ON "hms"."documents" FROM "hms_app";
