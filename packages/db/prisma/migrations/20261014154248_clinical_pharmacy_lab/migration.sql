-- CreateEnum
CREATE TYPE "hms"."MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'OINTMENT', 'DROPS', 'OTHER');

-- CreateEnum
CREATE TYPE "hms"."StockMoveType" AS ENUM ('RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "hms"."SampleType" AS ENUM ('BLOOD', 'URINE', 'STOOL', 'SWAB', 'OTHER');

-- CreateEnum
CREATE TYPE "hms"."ResultFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH');

-- CreateEnum
CREATE TYPE "hms"."LabOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'RESULTED', 'RELEASED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "hms"."InvoiceSource" ADD VALUE 'PHARMACY';
ALTER TYPE "hms"."InvoiceSource" ADD VALUE 'LAB';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "hms"."LineKind" ADD VALUE 'MEDICINE';
ALTER TYPE "hms"."LineKind" ADD VALUE 'LAB';

-- CreateTable
CREATE TABLE "hms"."consultations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "complaints" TEXT,
    "vitals" JSONB,
    "diagnosis" TEXT,
    "advice" TEXT,
    "follow_up_on" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."prescription_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "medicine_id" UUID,
    "name" TEXT NOT NULL,
    "dose" TEXT,
    "frequency" TEXT,
    "duration_days" INTEGER,
    "instructions" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."medicines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "generic_name" TEXT,
    "form" "hms"."MedicineForm" NOT NULL DEFAULT 'TABLET',
    "strength" TEXT,
    "unit_label" TEXT NOT NULL DEFAULT 'tablet',
    "price_paise" INTEGER NOT NULL,
    "reorder_level" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."stock_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "qty_received" INTEGER NOT NULL,
    "qty_on_hand" INTEGER NOT NULL,
    "cost_paise" INTEGER,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "type" "hms"."StockMoveType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."dispenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "consultation_id" UUID,
    "invoice_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."dispense_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dispense_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_paise" INTEGER NOT NULL,
    "amount_paise" INTEGER NOT NULL,

    CONSTRAINT "dispense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."lab_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sample_type" "hms"."SampleType" NOT NULL DEFAULT 'BLOOD',
    "price_paise" INTEGER NOT NULL,
    "unit" TEXT,
    "ref_low" DECIMAL(12,3),
    "ref_high" DECIMAL(12,3),
    "crit_low" DECIMAL(12,3),
    "crit_high" DECIMAL(12,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."lab_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "patient_id" UUID NOT NULL,
    "consultation_id" UUID,
    "invoice_id" UUID,
    "ordered_by" UUID,
    "status" "hms"."LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collected_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "released_by" UUID,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."lab_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "test_name" TEXT NOT NULL,
    "unit" TEXT,
    "ref_range" TEXT,
    "price_paise" INTEGER NOT NULL,
    "result_text" TEXT,
    "result_value" DECIMAL(12,3),
    "flag" "hms"."ResultFlag",
    "notes" TEXT,
    "resulted_by" UUID,
    "resulted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultations_tenant_id_patient_id_created_at_idx" ON "hms"."consultations"("tenant_id", "patient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_tenant_id_id_key" ON "hms"."consultations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_tenant_id_appointment_id_key" ON "hms"."consultations"("tenant_id", "appointment_id");

-- CreateIndex
CREATE INDEX "prescription_items_tenant_id_consultation_id_idx" ON "hms"."prescription_items"("tenant_id", "consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "medicines_tenant_id_id_key" ON "hms"."medicines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "medicines_tenant_id_name_strength_key" ON "hms"."medicines"("tenant_id", "name", "strength");

-- CreateIndex
CREATE INDEX "stock_batches_tenant_id_medicine_id_expiry_date_idx" ON "hms"."stock_batches"("tenant_id", "medicine_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_id_key" ON "hms"."stock_batches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_medicine_id_batch_no_key" ON "hms"."stock_batches"("tenant_id", "medicine_id", "batch_no");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_medicine_id_created_at_idx" ON "hms"."stock_movements"("tenant_id", "medicine_id", "created_at");

-- CreateIndex
CREATE INDEX "dispenses_tenant_id_created_at_idx" ON "hms"."dispenses"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispenses_tenant_id_id_key" ON "hms"."dispenses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dispenses_tenant_id_invoice_id_key" ON "hms"."dispenses"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "dispense_lines_tenant_id_dispense_id_idx" ON "hms"."dispense_lines"("tenant_id", "dispense_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_tenant_id_id_key" ON "hms"."lab_tests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_tenant_id_code_key" ON "hms"."lab_tests"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "lab_orders_tenant_id_status_created_at_idx" ON "hms"."lab_orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "lab_orders_tenant_id_patient_id_idx" ON "hms"."lab_orders"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_id_key" ON "hms"."lab_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_order_no_key" ON "hms"."lab_orders"("tenant_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_tenant_id_invoice_id_key" ON "hms"."lab_orders"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "lab_order_items_tenant_id_order_id_idx" ON "hms"."lab_order_items"("tenant_id", "order_id");

-- AddForeignKey
ALTER TABLE "hms"."consultations" ADD CONSTRAINT "consultations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."consultations" ADD CONSTRAINT "consultations_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "hms"."appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."consultations" ADD CONSTRAINT "consultations_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."consultations" ADD CONSTRAINT "consultations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."prescription_items" ADD CONSTRAINT "prescription_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."prescription_items" ADD CONSTRAINT "prescription_items_tenant_id_consultation_id_fkey" FOREIGN KEY ("tenant_id", "consultation_id") REFERENCES "hms"."consultations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."prescription_items" ADD CONSTRAINT "prescription_items_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."medicines" ADD CONSTRAINT "medicines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "hms"."stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_consultation_id_fkey" FOREIGN KEY ("tenant_id", "consultation_id") REFERENCES "hms"."consultations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispense_lines" ADD CONSTRAINT "dispense_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispense_lines" ADD CONSTRAINT "dispense_lines_tenant_id_dispense_id_fkey" FOREIGN KEY ("tenant_id", "dispense_id") REFERENCES "hms"."dispenses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispense_lines" ADD CONSTRAINT "dispense_lines_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispense_lines" ADD CONSTRAINT "dispense_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "hms"."stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_tests" ADD CONSTRAINT "lab_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_consultation_id_fkey" FOREIGN KEY ("tenant_id", "consultation_id") REFERENCES "hms"."consultations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "hms"."lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_order_items" ADD CONSTRAINT "lab_order_items_tenant_id_test_id_fkey" FOREIGN KEY ("tenant_id", "test_id") REFERENCES "hms"."lab_tests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS) for clinical, pharmacy and lab tables.
ALTER TABLE "hms"."consultations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."consultations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."consultations"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."prescription_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."prescription_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."prescription_items"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."medicines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."medicines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."medicines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."stock_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."stock_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."stock_batches"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."stock_movements"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."dispenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."dispenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."dispenses"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."dispense_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."dispense_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."dispense_lines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."lab_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."lab_tests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."lab_tests"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."lab_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."lab_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."lab_orders"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."lab_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."lab_order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."lab_order_items"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- Integrity: stock can never go negative, quantities and prices are sane.
ALTER TABLE "hms"."stock_batches" ADD CONSTRAINT "stock_batches_qty_chk"
  CHECK (qty_received > 0 AND qty_on_hand >= 0 AND qty_on_hand <= qty_received AND (cost_paise IS NULL OR cost_paise >= 0));
ALTER TABLE "hms"."medicines" ADD CONSTRAINT "medicines_price_chk" CHECK (price_paise >= 0 AND reorder_level >= 0);
ALTER TABLE "hms"."dispense_lines" ADD CONSTRAINT "dispense_lines_chk" CHECK (qty > 0 AND unit_paise >= 0 AND amount_paise = qty * unit_paise);
ALTER TABLE "hms"."prescription_items" ADD CONSTRAINT "prescription_items_chk" CHECK (quantity > 0 AND (duration_days IS NULL OR duration_days > 0));
ALTER TABLE "hms"."lab_tests" ADD CONSTRAINT "lab_tests_price_chk" CHECK (price_paise >= 0);
ALTER TABLE "hms"."lab_order_items" ADD CONSTRAINT "lab_order_items_price_chk" CHECK (price_paise >= 0);

-- The stock ledger and dispensing records are append-only for the app role.
REVOKE UPDATE, DELETE ON "hms"."stock_movements", "hms"."dispenses", "hms"."dispense_lines" FROM "hms_app";
-- Clinical and lab records are never hard-deleted by the app.
REVOKE DELETE ON "hms"."consultations", "hms"."lab_orders", "hms"."lab_order_items", "hms"."stock_batches" FROM "hms_app";
