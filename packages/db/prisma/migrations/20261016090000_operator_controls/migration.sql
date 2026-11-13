-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'SECURITY');

-- CreateTable
CREATE TABLE "tenant_feature_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "set_by" UUID NOT NULL,
    "set_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_feature_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_limits" (
    "tenant_id" UUID NOT NULL,
    "max_seats" INTEGER,
    "max_branches" INTEGER,
    "notes" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_limits_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "platform_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "value" JSONB,
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'INFO',
    "all_tenants" BOOLEAN NOT NULL DEFAULT true,
    "tenant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "tenant_id" UUID,
    "identity_id" UUID,
    "request_id" TEXT,
    "method" TEXT,
    "route" TEXT,
    "status" INTEGER,
    "duration_ms" INTEGER,
    "ip" TEXT,
    "user_agent" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_tenant_id" UUID,
    "target_type" TEXT,
    "target_id" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_feature_overrides_tenant_id_feature_key" ON "tenant_feature_overrides"("tenant_id", "feature");

-- CreateIndex
CREATE INDEX "announcements_starts_at_ends_at_idx" ON "announcements"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "system_logs_created_at_idx" ON "system_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at" DESC);

-- CreateIndex
CREATE INDEX "system_logs_tenant_id_created_at_idx" ON "system_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_created_at_idx" ON "platform_audit"("created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_target_tenant_id_created_at_idx" ON "platform_audit"("target_tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_limits" ADD CONSTRAINT "tenant_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════ Integrity and grants ═════════
-- The operator audit trail can only grow; logs can be purged by the retention job but never edited.
REVOKE UPDATE, DELETE ON "platform"."platform_audit" FROM "hms_app";
REVOKE UPDATE ON "platform"."system_logs" FROM "hms_app";
GRANT DELETE ON "platform"."system_logs", "platform"."announcements", "platform"."tenant_feature_overrides" TO "hms_app";
ALTER TABLE "platform"."tenant_limits" ADD CONSTRAINT "tenant_limits_chk" CHECK ((max_seats IS NULL OR max_seats >= 1) AND (max_branches IS NULL OR max_branches >= 1));
INSERT INTO "platform"."platform_flags" ("key", "enabled", "value", "description") VALUES
  ('maintenance_mode', false, '{"message":"We are doing scheduled maintenance. You can look at records but cannot change them for a short while."}'::jsonb, 'Hospitals become read-only; sign-in still works'),
  ('signup_open', true, NULL, 'Anyone can start a free trial from the sign-up page'),
  ('log_retention_days', true, '{"days":30}'::jsonb, 'How long system logs are kept'),
  ('trial_days', true, '{"days":30}'::jsonb, 'Length of the free trial for new sign-ups')
ON CONFLICT DO NOTHING;
