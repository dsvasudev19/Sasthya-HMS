-- CreateEnum
CREATE TYPE "hms"."InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "hms"."InvoiceSource" AS ENUM ('MANUAL', 'CONSULTATION', 'HEALTH_CARD');

-- CreateEnum
CREATE TYPE "hms"."LineKind" AS ENUM ('CONSULTATION', 'CARD_ISSUE', 'CARD_PLAN', 'SERVICE', 'OTHER');

-- CreateTable
CREATE TABLE "hms"."fee_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "hms"."LineKind" NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."counters" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "hms"."invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "source" "hms"."InvoiceSource" NOT NULL DEFAULT 'MANUAL',
    "status" "hms"."InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal_paise" INTEGER NOT NULL,
    "discount_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "paid_paise" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "hms"."LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_paise" INTEGER NOT NULL,
    "amount_paise" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "method" "hms"."PaymentMethod" NOT NULL,
    "reference" TEXT,
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."daily_closings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "expected_cash_paise" INTEGER NOT NULL,
    "counted_cash_paise" INTEGER NOT NULL,
    "total_collected_paise" INTEGER NOT NULL,
    "notes" TEXT,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_tenant_id_id_key" ON "hms"."fee_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_tenant_id_code_key" ON "hms"."fee_items"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_created_at_idx" ON "hms"."invoices"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_patient_id_idx" ON "hms"."invoices"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "hms"."invoices"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_no_key" ON "hms"."invoices"("tenant_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_appointment_id_key" ON "hms"."invoices"("tenant_id", "appointment_id");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_idx" ON "hms"."invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_received_at_idx" ON "hms"."payments"("tenant_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "hms"."payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_tenant_id_date_key" ON "hms"."daily_closings"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "hms"."fee_items" ADD CONSTRAINT "fee_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."counters" ADD CONSTRAINT "counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "hms"."appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."payments" ADD CONSTRAINT "payments_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."daily_closings" ADD CONSTRAINT "daily_closings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS) for billing tables.
ALTER TABLE "hms"."fee_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."fee_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."fee_items"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."counters"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."invoices"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."invoice_lines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."payments"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."daily_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."daily_closings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."daily_closings"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- Money integrity (all amounts are integer paise).
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_amounts_chk"
  CHECK (subtotal_paise >= 0 AND discount_paise >= 0 AND discount_paise <= subtotal_paise
         AND total_paise = subtotal_paise - discount_paise AND paid_paise >= 0 AND paid_paise <= total_paise);
ALTER TABLE "hms"."invoice_lines" ADD CONSTRAINT "invoice_lines_chk"
  CHECK (quantity > 0 AND unit_paise >= 0 AND amount_paise = quantity * unit_paise);
ALTER TABLE "hms"."payments" ADD CONSTRAINT "payments_amount_chk" CHECK (amount_paise > 0);
ALTER TABLE "hms"."fee_items" ADD CONSTRAINT "fee_items_price_chk" CHECK (price_paise >= 0);
ALTER TABLE "hms"."daily_closings" ADD CONSTRAINT "daily_closings_chk" CHECK (expected_cash_paise >= 0 AND counted_cash_paise >= 0);

-- Financial records are append-only for the app role: payments and closings cannot be edited or deleted.
REVOKE UPDATE, DELETE ON "hms"."payments", "hms"."daily_closings" FROM "hms_app";
REVOKE DELETE ON "hms"."invoices", "hms"."invoice_lines" FROM "hms_app";
