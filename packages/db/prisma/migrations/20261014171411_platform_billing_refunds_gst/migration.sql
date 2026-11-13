-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DUE', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "hms"."PaymentLinkStatus" AS ENUM ('CREATED', 'PAID', 'EXPIRED');

-- AlterEnum
ALTER TYPE "hms"."InvoiceStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "hms"."invoice_lines" ADD COLUMN     "gst_percent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hms"."invoices" ADD COLUMN     "refunded_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_paise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hms"."medicines" ADD COLUMN     "gst_percent" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "hms"."payments" ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "identities" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "suspended_reason" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "platform_admins" (
    "identity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "plan_code" "PlanCode" NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal_paise" INTEGER NOT NULL,
    "gst_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "payment_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "tenant_id" UUID,
    "role" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'staff',
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "method" "hms"."PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."payment_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "gateway_ref" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "hms"."PaymentLinkStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_invoice_no_key" ON "platform_invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_date_idx" ON "platform_invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_tenant_id_period_start_key" ON "platform_invoices"("tenant_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_identity_id_idx" ON "refresh_tokens"("identity_id");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_created_at_idx" ON "hms"."refunds"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_invoice_id_idx" ON "hms"."refunds"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_links_tenant_id_invoice_id_idx" ON "hms"."payment_links"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_tenant_id_gateway_ref_key" ON "hms"."payment_links"("tenant_id", "gateway_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_external_id_key" ON "hms"."payments"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."refunds" ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."refunds" ADD CONSTRAINT "refunds_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."payment_links" ADD CONSTRAINT "payment_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."payment_links" ADD CONSTRAINT "payment_links_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tenant isolation (RLS) for refunds and payment links.
ALTER TABLE "hms"."refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."refunds"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."payment_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."payment_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."payment_links"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- Money integrity.
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_refund_chk" CHECK (refunded_paise >= 0 AND refunded_paise <= paid_paise AND tax_paise >= 0 AND tax_paise <= total_paise);
ALTER TABLE "hms"."refunds" ADD CONSTRAINT "refunds_amount_chk" CHECK (amount_paise > 0 AND char_length(reason) > 0);
ALTER TABLE "hms"."invoice_lines" ADD CONSTRAINT "invoice_lines_gst_chk" CHECK (gst_percent IN (0, 5, 12, 18, 28));
ALTER TABLE "hms"."medicines" ADD CONSTRAINT "medicines_gst_chk" CHECK (gst_percent IN (0, 5, 12, 18, 28));
ALTER TABLE "platform"."platform_invoices" ADD CONSTRAINT "platform_invoices_chk" CHECK (subtotal_paise >= 0 AND gst_paise >= 0 AND total_paise = subtotal_paise + gst_paise);

-- Refunds are append-only for the app role; payment links are never deleted.
REVOKE UPDATE, DELETE ON "hms"."refunds" FROM "hms_app";
REVOKE DELETE ON "hms"."payment_links" FROM "hms_app";
-- Platform admins are managed outside the app; sessions can be written and revoked but not rewritten in bulk.
REVOKE INSERT, UPDATE ON "platform"."platform_admins" FROM "hms_app";
REVOKE DELETE ON "platform"."platform_invoices" FROM "hms_app";
GRANT DELETE ON "platform"."refresh_tokens" TO "hms_app";
