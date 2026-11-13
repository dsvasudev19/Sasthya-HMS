-- CreateEnum
CREATE TYPE "hms"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "hms"."StockMoveType" ADD VALUE 'RETURN';
ALTER TYPE "hms"."StockMoveType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "hms"."StockMoveType" ADD VALUE 'TRANSFER_IN';

-- DropIndex
DROP INDEX "hms"."appointments_tenant_id_scheduled_at_idx";

-- DropIndex
DROP INDEX "hms"."daily_closings_tenant_id_date_key";

-- DropIndex
DROP INDEX "hms"."dispenses_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "hms"."invoices_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "hms"."lab_orders_tenant_id_status_created_at_idx";

-- DropIndex
DROP INDEX "hms"."stock_batches_tenant_id_medicine_id_batch_no_key";

-- DropIndex
DROP INDEX "hms"."stock_batches_tenant_id_medicine_id_expiry_date_idx";

-- DropIndex
DROP INDEX "hms"."stock_movements_tenant_id_medicine_id_created_at_idx";

-- AlterTable
ALTER TABLE "hms"."appointments" ADD COLUMN     "branch_id" UUID;

-- AlterTable
ALTER TABLE "hms"."daily_closings" ADD COLUMN     "branch_id" UUID;

-- AlterTable
ALTER TABLE "hms"."dispenses" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "customer_name" TEXT,
ADD COLUMN     "customer_phone" TEXT,
ADD COLUMN     "shift_id" UUID,
ALTER COLUMN "patient_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "hms"."invoices" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "customer_name" TEXT,
ADD COLUMN     "customer_phone" TEXT,
ALTER COLUMN "patient_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "hms"."lab_orders" ADD COLUMN     "branch_id" UUID;

-- AlterTable
ALTER TABLE "hms"."medicines" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "hsn_code" TEXT,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "rack" TEXT,
ADD COLUMN     "schedule_drug" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "hms"."stock_batches" ADD COLUMN     "branch_id" UUID;

-- AlterTable
ALTER TABLE "hms"."stock_movements" ADD COLUMN     "branch_id" UUID;

-- AlterTable
ALTER TABLE "platform_invoices" ADD COLUMN     "gateway_ref" TEXT,
ADD COLUMN     "payment_link_url" TEXT;

-- AlterTable
ALTER TABLE "tenant_memberships" ALTER COLUMN "role" TYPE TEXT USING "role"::text;

-- DropEnum
DROP TYPE "MemberRole";

-- CreateTable
CREATE TABLE "tenant_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "customized" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "permission" TEXT NOT NULL,
    "applies_to_roles" TEXT[],
    "conditions" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_branches" (
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "staff_branches_pkey" PRIMARY KEY ("tenant_id","identity_id","branch_id")
);

-- CreateTable
CREATE TABLE "hms"."branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."doctor_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "specialty" TEXT,
    "qualification" TEXT,
    "registration_no" TEXT,
    "fee_in_person_paise" INTEGER,
    "fee_tele_paise" INTEGER,
    "slot_minutes" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."doctor_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "branch_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."doctor_leaves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "doctor_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "supplier_id" UUID NOT NULL,
    "po_no" TEXT NOT NULL,
    "status" "hms"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordered_at" TIMESTAMPTZ(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost_paise" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "supplier_id" UUID NOT NULL,
    "po_id" UUID,
    "grn_no" TEXT NOT NULL,
    "bill_no" TEXT,
    "bill_date" DATE,
    "total_paise" INTEGER NOT NULL,
    "paid_paise" INTEGER NOT NULL DEFAULT 0,
    "received_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."goods_receipt_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost_paise" INTEGER NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."supplier_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "grn_id" UUID,
    "amount_paise" INTEGER NOT NULL,
    "method" "hms"."PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paid_by" UUID,
    "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."sale_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "dispense_id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_method" "hms"."PaymentMethod" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."sale_return_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "dispense_line_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount_paise" INTEGER NOT NULL,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."pos_shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cash_paise" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "expected_cash_paise" INTEGER,
    "counted_cash_paise" INTEGER,
    "notes" TEXT,

    CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_roles_tenant_id_id_key" ON "tenant_roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_roles_tenant_id_key_key" ON "tenant_roles"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "tenant_policies_tenant_id_enabled_idx" ON "tenant_policies"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "hms"."branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "hms"."branches"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profiles_tenant_id_id_key" ON "hms"."doctor_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profiles_tenant_id_identity_id_key" ON "hms"."doctor_profiles"("tenant_id", "identity_id");

-- CreateIndex
CREATE INDEX "doctor_schedules_tenant_id_branch_id_weekday_idx" ON "hms"."doctor_schedules"("tenant_id", "branch_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_schedules_tenant_id_doctor_id_branch_id_weekday_star_key" ON "hms"."doctor_schedules"("tenant_id", "doctor_id", "branch_id", "weekday", "start_minute");

-- CreateIndex
CREATE INDEX "doctor_leaves_tenant_id_doctor_id_from_date_idx" ON "hms"."doctor_leaves"("tenant_id", "doctor_id", "from_date");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "hms"."suppliers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_name_key" ON "hms"."suppliers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_branch_id_status_idx" ON "hms"."purchase_orders"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "hms"."purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_no_key" ON "hms"."purchase_orders"("tenant_id", "po_no");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_po_id_idx" ON "hms"."purchase_order_lines"("tenant_id", "po_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_supplier_id_idx" ON "hms"."goods_receipts"("tenant_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_id_key" ON "hms"."goods_receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_grn_no_key" ON "hms"."goods_receipts"("tenant_id", "grn_no");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_grn_id_idx" ON "hms"."goods_receipt_lines"("tenant_id", "grn_id");

-- CreateIndex
CREATE INDEX "supplier_payments_tenant_id_supplier_id_idx" ON "hms"."supplier_payments"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "sale_returns_tenant_id_branch_id_created_at_idx" ON "hms"."sale_returns"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenant_id_id_key" ON "hms"."sale_returns"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenant_id_return_no_key" ON "hms"."sale_returns"("tenant_id", "return_no");

-- CreateIndex
CREATE INDEX "sale_return_lines_tenant_id_return_id_idx" ON "hms"."sale_return_lines"("tenant_id", "return_id");

-- CreateIndex
CREATE INDEX "pos_shifts_tenant_id_branch_id_opened_at_idx" ON "hms"."pos_shifts"("tenant_id", "branch_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "pos_shifts_tenant_id_id_key" ON "hms"."pos_shifts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_branch_id_scheduled_at_idx" ON "hms"."appointments"("tenant_id", "branch_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_tenant_id_branch_id_date_key" ON "hms"."daily_closings"("tenant_id", "branch_id", "date");

-- CreateIndex
CREATE INDEX "dispenses_tenant_id_branch_id_created_at_idx" ON "hms"."dispenses"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_branch_id_created_at_idx" ON "hms"."invoices"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "lab_orders_tenant_id_branch_id_status_created_at_idx" ON "hms"."lab_orders"("tenant_id", "branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "medicines_tenant_id_barcode_key" ON "hms"."medicines"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "stock_batches_tenant_id_branch_id_medicine_id_expiry_date_idx" ON "hms"."stock_batches"("tenant_id", "branch_id", "medicine_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_tenant_id_branch_id_medicine_id_batch_no_key" ON "hms"."stock_batches"("tenant_id", "branch_id", "medicine_id", "batch_no");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_branch_id_medicine_id_created_at_idx" ON "hms"."stock_movements"("tenant_id", "branch_id", "medicine_id", "created_at");


-- ═════════ Backfill: every existing hospital gets a main branch and the default system roles ═════════
INSERT INTO "hms"."branches" ("id", "tenant_id", "code", "name", "is_main", "active")
SELECT gen_random_uuid(), t."id", 'MAIN', t."name", true, true FROM "platform"."tenants" t;

INSERT INTO "platform"."tenant_roles" ("id", "tenant_id", "key", "name", "is_system", "customized", "permissions")
SELECT gen_random_uuid(), t."id", r.key, r.name, true, false, '{}'::text[]
FROM "platform"."tenants" t
CROSS JOIN (VALUES ('OWNER','Owner'),('ADMIN','Admin'),('DOCTOR','Doctor'),('NURSE','Nurse'),('RECEPTIONIST','Reception'),('PHARMACIST','Pharmacist'),('LAB_TECH','Lab technician')) AS r(key, name);
-- Permissions of system roles are filled from the product defaults when the API starts (syncSystemRoles).

ALTER TABLE "hms"."appointments" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."appointments" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."appointments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."appointments" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."daily_closings" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."daily_closings" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."daily_closings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."daily_closings" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."dispenses" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."dispenses" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."dispenses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."dispenses" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."invoices" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."invoices" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."invoices" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."lab_orders" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."lab_orders" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."lab_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."lab_orders" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."stock_batches" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."stock_batches" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."stock_batches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."stock_batches" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "hms"."stock_movements" NO FORCE ROW LEVEL SECURITY;
UPDATE "hms"."stock_movements" x SET "branch_id" = b."id" FROM "hms"."branches" b WHERE b."tenant_id" = x."tenant_id" AND b."is_main";
ALTER TABLE "hms"."stock_movements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hms"."stock_movements" ALTER COLUMN "branch_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_role_fkey" FOREIGN KEY ("tenant_id", "role") REFERENCES "tenant_roles"("tenant_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."daily_closings" ADD CONSTRAINT "daily_closings_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."dispenses" ADD CONSTRAINT "dispenses_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "hms"."pos_shifts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_profiles" ADD CONSTRAINT "doctor_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_schedules" ADD CONSTRAINT "doctor_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_schedules" ADD CONSTRAINT "doctor_schedules_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "hms"."doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_schedules" ADD CONSTRAINT "doctor_schedules_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_leaves" ADD CONSTRAINT "doctor_leaves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_leaves" ADD CONSTRAINT "doctor_leaves_tenant_id_doctor_id_fkey" FOREIGN KEY ("tenant_id", "doctor_id") REFERENCES "hms"."doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "hms"."suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_po_id_fkey" FOREIGN KEY ("tenant_id", "po_id") REFERENCES "hms"."purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "hms"."suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_po_id_fkey" FOREIGN KEY ("tenant_id", "po_id") REFERENCES "hms"."purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_grn_id_fkey" FOREIGN KEY ("tenant_id", "grn_id") REFERENCES "hms"."goods_receipts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_medicine_id_fkey" FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "hms"."medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "hms"."stock_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "hms"."suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_grn_id_fkey" FOREIGN KEY ("tenant_id", "grn_id") REFERENCES "hms"."goods_receipts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_dispense_id_fkey" FOREIGN KEY ("tenant_id", "dispense_id") REFERENCES "hms"."dispenses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "hms"."sale_returns"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."pos_shifts" ADD CONSTRAINT "pos_shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."pos_shifts" ADD CONSTRAINT "pos_shifts_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════ Tenant isolation (RLS) for the new hospital tables ═════════
ALTER TABLE "hms"."branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."branches"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."doctor_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."doctor_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."doctor_profiles"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."doctor_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."doctor_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."doctor_schedules"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."doctor_leaves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."doctor_leaves" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."doctor_leaves"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."suppliers"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."purchase_orders"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."purchase_order_lines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."goods_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."goods_receipts"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."goods_receipt_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."goods_receipt_lines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."supplier_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."supplier_payments"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."sale_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."sale_returns" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."sale_returns"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."sale_return_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."sale_return_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."sale_return_lines"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."pos_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."pos_shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."pos_shifts"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- ═════════ Integrity ═════════
ALTER TABLE "hms"."branches" ADD CONSTRAINT "branches_code_chk" CHECK (code ~ '^[A-Z0-9]{2,8}$');
ALTER TABLE "hms"."doctor_schedules" ADD CONSTRAINT "doctor_schedules_chk" CHECK (weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE "hms"."doctor_profiles" ADD CONSTRAINT "doctor_profiles_chk" CHECK (slot_minutes BETWEEN 5 AND 120 AND (fee_in_person_paise IS NULL OR fee_in_person_paise >= 0) AND (fee_tele_paise IS NULL OR fee_tele_paise >= 0));
ALTER TABLE "hms"."doctor_leaves" ADD CONSTRAINT "doctor_leaves_chk" CHECK (to_date >= from_date);
ALTER TABLE "hms"."purchase_order_lines" ADD CONSTRAINT "po_lines_chk" CHECK (qty > 0 AND cost_paise >= 0);
ALTER TABLE "hms"."goods_receipt_lines" ADD CONSTRAINT "grn_lines_chk" CHECK (qty > 0 AND cost_paise >= 0);
ALTER TABLE "hms"."goods_receipts" ADD CONSTRAINT "grn_amounts_chk" CHECK (total_paise >= 0 AND paid_paise >= 0 AND paid_paise <= total_paise);
ALTER TABLE "hms"."supplier_payments" ADD CONSTRAINT "supplier_payments_chk" CHECK (amount_paise > 0);
ALTER TABLE "hms"."sale_return_lines" ADD CONSTRAINT "sale_return_lines_chk" CHECK (qty > 0 AND amount_paise >= 0);
ALTER TABLE "hms"."sale_returns" ADD CONSTRAINT "sale_returns_chk" CHECK (amount_paise >= 0);
ALTER TABLE "hms"."pos_shifts" ADD CONSTRAINT "pos_shifts_chk" CHECK (opening_cash_paise >= 0 AND (counted_cash_paise IS NULL OR counted_cash_paise >= 0));
ALTER TABLE "hms"."invoices" ADD CONSTRAINT "invoices_customer_chk" CHECK (patient_id IS NOT NULL OR customer_name IS NOT NULL OR source = 'PHARMACY');
ALTER TABLE "platform"."tenant_roles" ADD CONSTRAINT "tenant_roles_key_chk" CHECK (key ~ '^[A-Z][A-Z0-9_]{1,30}$');

-- ═════════ Grants: ledgers stay append-only; roles, policies and branch access can be deleted ═════════
GRANT DELETE ON "platform"."tenant_roles", "platform"."tenant_policies", "platform"."staff_branches" TO "hms_app";
REVOKE DELETE ON "hms"."branches", "hms"."pos_shifts", "hms"."purchase_orders", "hms"."goods_receipts" FROM "hms_app";
REVOKE UPDATE, DELETE ON "hms"."goods_receipt_lines", "hms"."supplier_payments", "hms"."sale_returns", "hms"."sale_return_lines" FROM "hms_app";
