-- CreateEnum
CREATE TYPE "hms"."TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "hms"."TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "hms"."tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "patient_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" "hms"."TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "hms"."TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "due_at" TIMESTAMPTZ(3),
    "assigned_to" UUID,
    "created_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_due_at_idx" ON "hms"."tasks"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assigned_to_status_idx" ON "hms"."tasks"("tenant_id", "assigned_to", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_tenant_id_id_key" ON "hms"."tasks"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "hms"."tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."tasks" ADD CONSTRAINT "tasks_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════ Row level security ═════════
ALTER TABLE "hms"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."tasks"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
-- Tasks are worked and closed, never erased: the history of who did what stays.
REVOKE DELETE ON "hms"."tasks" FROM "hms_app";
ALTER TABLE "hms"."tasks" ADD CONSTRAINT "tasks_done_chk" CHECK ((status = 'DONE') = (completed_at IS NOT NULL));
