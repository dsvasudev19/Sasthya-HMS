-- CreateEnum
CREATE TYPE "hms"."MessageChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "hms"."MessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "hms"."patients" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "reminder_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hms"."messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID,
    "channel" "hms"."MessageChannel" NOT NULL DEFAULT 'SMS',
    "to_phone" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "status" "hms"."MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "provider_ref" TEXT,
    "error" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateIndex
CREATE INDEX "messages_status_next_attempt_at_idx" ON "hms"."messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_created_at_idx" ON "hms"."messages"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_dedupe_key_key" ON "hms"."messages"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "hms"."messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."messages" ADD CONSTRAINT "messages_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS).
ALTER TABLE "hms"."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."messages"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."tenant_settings"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

ALTER TABLE "hms"."messages" ADD CONSTRAINT "messages_chk" CHECK (attempts >= 0 AND char_length(body) <= 1600);
-- Messages are an audit trail: never deleted by the app.
REVOKE DELETE ON "hms"."messages" FROM "hms_app";
