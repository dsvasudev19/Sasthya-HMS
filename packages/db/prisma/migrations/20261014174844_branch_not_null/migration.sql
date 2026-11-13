-- AlterTable
ALTER TABLE "hms"."doctor_schedules" ALTER COLUMN "branch_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "hms"."goods_receipts" ALTER COLUMN "branch_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "hms"."pos_shifts" ALTER COLUMN "branch_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "hms"."purchase_orders" ALTER COLUMN "branch_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "hms"."sale_returns" ALTER COLUMN "branch_id" SET NOT NULL;

