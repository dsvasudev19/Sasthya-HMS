-- CreateEnum
CREATE TYPE "OverrideEffect" AS ENUM ('GRANT', 'REVOKE');

-- AlterTable
ALTER TABLE "tenant_policies" ADD COLUMN     "description" TEXT,
ADD COLUMN     "except_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "match" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "valid_from" TIMESTAMPTZ(3),
ADD COLUMN     "valid_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_access_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "effect" "OverrideEffect" NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_access_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_access_overrides_tenant_id_identity_id_idx" ON "user_access_overrides"("tenant_id", "identity_id");

-- AddForeignKey
ALTER TABLE "user_access_overrides" ADD CONSTRAINT "user_access_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_overrides" ADD CONSTRAINT "user_access_overrides_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════ Integrity and grants ═════════
ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_match_chk" CHECK (match IN ('ALL', 'ANY'));
ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_window_chk" CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until);
GRANT DELETE ON "platform"."user_access_overrides" TO "hms_app";
