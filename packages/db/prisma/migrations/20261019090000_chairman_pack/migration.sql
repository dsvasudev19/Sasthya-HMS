-- AlterEnum
ALTER TYPE "hms"."PaymentMethod" ADD VALUE 'INSURANCE';

-- CreateTable
CREATE TABLE "hms"."payers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."patient_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "policy_no" TEXT NOT NULL,
    "member_id" TEXT,
    "valid_until" DATE,
    "sum_insured_paise" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "claim_no" TEXT NOT NULL,
    "patient_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "policy_id" UUID,
    "admission_id" UUID,
    "invoice_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "diagnosis" TEXT,
    "preauth_requested_paise" INTEGER NOT NULL DEFAULT 0,
    "preauth_approved_paise" INTEGER NOT NULL DEFAULT 0,
    "billed_paise" INTEGER NOT NULL DEFAULT 0,
    "approved_paise" INTEGER NOT NULL DEFAULT 0,
    "settled_paise" INTEGER NOT NULL DEFAULT 0,
    "disallowed_paise" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."claim_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount_paise" INTEGER,
    "note" TEXT,
    "by_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."theatres" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theatres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."surgeries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "theatre_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "procedure" TEXT NOT NULL,
    "surgeon_id" UUID NOT NULL,
    "anaesthetist_id" UUID,
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "anaesthesia" TEXT,
    "notes" TEXT,
    "outcome" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."er_visits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "arrival_no" TEXT NOT NULL,
    "patient_id" UUID,
    "patient_label" TEXT NOT NULL,
    "complaint" TEXT NOT NULL,
    "triage" INTEGER NOT NULL,
    "arrival_mode" TEXT NOT NULL,
    "vitals" JSONB,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "arrived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "doctor_id" UUID,
    "admission_id" UUID,
    "notes" TEXT,
    "created_by" UUID NOT NULL,

    CONSTRAINT "er_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DAY',
    "created_by" UUID NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL,
    "check_out_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."doctor_shares" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "basis_points" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."doctor_payouts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "gross_paise" INTEGER NOT NULL,
    "share_paise" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "approved_by" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "reference" TEXT,

    CONSTRAINT "doctor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "patient_id" UUID,
    "token" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "doctor_id" UUID,
    "score" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."report_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."report_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID,
    "report" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "rows" INTEGER NOT NULL,
    "csv" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_mfa" (
    "identity_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(3),
    "last_step" INTEGER,
    "recovery_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_mfa_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "tenant_security" (
    "tenant_id" UUID NOT NULL,
    "require_2fa" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_security_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payers_tenant_id_id_key" ON "hms"."payers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payers_tenant_id_name_key" ON "hms"."payers"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_policies_tenant_id_id_key" ON "hms"."patient_policies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_policies_tenant_id_patient_id_payer_id_policy_no_key" ON "hms"."patient_policies"("tenant_id", "patient_id", "payer_id", "policy_no");

-- CreateIndex
CREATE INDEX "claims_tenant_id_status_created_at_idx" ON "hms"."claims"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "claims_tenant_id_payer_id_status_idx" ON "hms"."claims"("tenant_id", "payer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "claims_tenant_id_id_key" ON "hms"."claims"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_tenant_id_claim_no_key" ON "hms"."claims"("tenant_id", "claim_no");

-- CreateIndex
CREATE INDEX "claim_events_tenant_id_claim_id_at_idx" ON "hms"."claim_events"("tenant_id", "claim_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "theatres_tenant_id_id_key" ON "hms"."theatres"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "theatres_tenant_id_branch_id_name_key" ON "hms"."theatres"("tenant_id", "branch_id", "name");

-- CreateIndex
CREATE INDEX "surgeries_tenant_id_theatre_id_scheduled_start_idx" ON "hms"."surgeries"("tenant_id", "theatre_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "surgeries_tenant_id_surgeon_id_scheduled_start_idx" ON "hms"."surgeries"("tenant_id", "surgeon_id", "scheduled_start");

-- CreateIndex
CREATE UNIQUE INDEX "surgeries_tenant_id_id_key" ON "hms"."surgeries"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "er_visits_tenant_id_status_triage_arrived_at_idx" ON "hms"."er_visits"("tenant_id", "status", "triage", "arrived_at");

-- CreateIndex
CREATE UNIQUE INDEX "er_visits_tenant_id_id_key" ON "hms"."er_visits"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "er_visits_tenant_id_arrival_no_key" ON "hms"."er_visits"("tenant_id", "arrival_no");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_branch_id_date_idx" ON "hms"."shifts"("tenant_id", "branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_identity_id_date_start_time_key" ON "hms"."shifts"("tenant_id", "identity_id", "date", "start_time");

-- CreateIndex
CREATE INDEX "attendance_tenant_id_branch_id_date_idx" ON "hms"."attendance"("tenant_id", "branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_tenant_id_identity_id_date_key" ON "hms"."attendance"("tenant_id", "identity_id", "date");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_status_from_date_idx" ON "hms"."leave_requests"("tenant_id", "status", "from_date");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_shares_tenant_id_doctor_id_source_effective_from_key" ON "hms"."doctor_shares"("tenant_id", "doctor_id", "source", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_payouts_tenant_id_doctor_id_period_key" ON "hms"."doctor_payouts"("tenant_id", "doctor_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_token_key" ON "hms"."feedback"("token");

-- CreateIndex
CREATE INDEX "feedback_tenant_id_answered_at_idx" ON "hms"."feedback"("tenant_id", "answered_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_tenant_id_id_key" ON "hms"."report_schedules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "report_runs_tenant_id_created_at_idx" ON "hms"."report_runs"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "hms"."payers" ADD CONSTRAINT "payers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."patient_policies" ADD CONSTRAINT "patient_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."patient_policies" ADD CONSTRAINT "patient_policies_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."patient_policies" ADD CONSTRAINT "patient_policies_tenant_id_payer_id_fkey" FOREIGN KEY ("tenant_id", "payer_id") REFERENCES "hms"."payers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_payer_id_fkey" FOREIGN KEY ("tenant_id", "payer_id") REFERENCES "hms"."payers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_policy_id_fkey" FOREIGN KEY ("tenant_id", "policy_id") REFERENCES "hms"."patient_policies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_admission_id_fkey" FOREIGN KEY ("tenant_id", "admission_id") REFERENCES "hms"."admissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "hms"."invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claim_events" ADD CONSTRAINT "claim_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."claim_events" ADD CONSTRAINT "claim_events_tenant_id_claim_id_fkey" FOREIGN KEY ("tenant_id", "claim_id") REFERENCES "hms"."claims"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."theatres" ADD CONSTRAINT "theatres_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."theatres" ADD CONSTRAINT "theatres_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_tenant_id_theatre_id_fkey" FOREIGN KEY ("tenant_id", "theatre_id") REFERENCES "hms"."theatres"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_tenant_id_admission_id_fkey" FOREIGN KEY ("tenant_id", "admission_id") REFERENCES "hms"."admissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."er_visits" ADD CONSTRAINT "er_visits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."er_visits" ADD CONSTRAINT "er_visits_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."er_visits" ADD CONSTRAINT "er_visits_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."er_visits" ADD CONSTRAINT "er_visits_tenant_id_admission_id_fkey" FOREIGN KEY ("tenant_id", "admission_id") REFERENCES "hms"."admissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."attendance" ADD CONSTRAINT "attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_shares" ADD CONSTRAINT "doctor_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."doctor_payouts" ADD CONSTRAINT "doctor_payouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."feedback" ADD CONSTRAINT "feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."feedback" ADD CONSTRAINT "feedback_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."report_runs" ADD CONSTRAINT "report_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."report_runs" ADD CONSTRAINT "report_runs_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "hms"."report_schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_mfa" ADD CONSTRAINT "identity_mfa_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_security" ADD CONSTRAINT "tenant_security_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═════════ Row level security ═════════
ALTER TABLE "hms"."payers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."payers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."payers"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."patient_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."patient_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."patient_policies"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."claims"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."claim_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."claim_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."claim_events"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."theatres" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."theatres" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."theatres"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."surgeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."surgeries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."surgeries"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."er_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."er_visits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."er_visits"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."shifts"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."attendance"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."leave_requests"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."doctor_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."doctor_shares" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."doctor_shares"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."doctor_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."doctor_payouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."doctor_payouts"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."feedback"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."report_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."report_schedules"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."report_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."report_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."report_runs"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- ═════════ Integrity ═════════
-- Money trails and clinical records are closed or superseded, never erased.
REVOKE DELETE ON "hms"."payers", "hms"."patient_policies", "hms"."claims", "hms"."claim_events", "hms"."surgeries", "hms"."er_visits", "hms"."attendance", "hms"."leave_requests", "hms"."doctor_shares", "hms"."doctor_payouts", "hms"."feedback", "hms"."report_runs" FROM "hms_app";
REVOKE UPDATE, DELETE ON "hms"."claim_events" FROM "hms_app";
ALTER TABLE "hms"."payers" ADD CONSTRAINT "payers_chk" CHECK (kind IN ('INSURER', 'TPA', 'GOVERNMENT', 'CORPORATE') AND credit_days BETWEEN 0 AND 365);
ALTER TABLE "hms"."claims" ADD CONSTRAINT "claims_chk" CHECK (
  kind IN ('CASHLESS', 'REIMBURSEMENT')
  AND status IN ('DRAFT', 'PREAUTH_PENDING', 'PREAUTH_APPROVED', 'PREAUTH_REJECTED', 'SUBMITTED', 'QUERY', 'APPROVED', 'SETTLED', 'REJECTED', 'CLOSED')
  AND preauth_requested_paise >= 0 AND preauth_approved_paise >= 0 AND billed_paise >= 0 AND approved_paise >= 0 AND settled_paise >= 0 AND disallowed_paise >= 0
  AND settled_paise <= approved_paise);
CREATE UNIQUE INDEX "claims_one_open_per_invoice" ON "hms"."claims"("tenant_id", "invoice_id") WHERE "invoice_id" IS NOT NULL AND "status" NOT IN ('REJECTED', 'CLOSED', 'PREAUTH_REJECTED');
ALTER TABLE "hms"."surgeries" ADD CONSTRAINT "surgeries_chk" CHECK (scheduled_end > scheduled_start AND status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'POSTPONED'));
ALTER TABLE "hms"."er_visits" ADD CONSTRAINT "er_visits_chk" CHECK (triage BETWEEN 1 AND 5 AND arrival_mode IN ('WALK_IN', 'AMBULANCE', 'POLICE', 'REFERRED') AND status IN ('WAITING', 'IN_TREATMENT', 'OBSERVATION', 'ADMITTED', 'DISCHARGED', 'REFERRED', 'LWBS', 'DEATH'));
ALTER TABLE "hms"."shifts" ADD CONSTRAINT "shifts_chk" CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND kind IN ('DAY', 'EVENING', 'NIGHT', 'ON_CALL'));
ALTER TABLE "hms"."attendance" ADD CONSTRAINT "attendance_chk" CHECK (check_out_at IS NULL OR check_out_at >= check_in_at);
ALTER TABLE "hms"."leave_requests" ADD CONSTRAINT "leave_requests_chk" CHECK (to_date >= from_date AND status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') AND kind IN ('CASUAL', 'SICK', 'EARNED', 'OTHER'));
ALTER TABLE "hms"."doctor_shares" ADD CONSTRAINT "doctor_shares_chk" CHECK (basis_points BETWEEN 0 AND 10000 AND source IN ('CONSULTATION', 'IPD'));
ALTER TABLE "hms"."doctor_payouts" ADD CONSTRAINT "doctor_payouts_chk" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND status IN ('APPROVED', 'PAID') AND share_paise >= 0 AND share_paise <= gross_paise);
ALTER TABLE "hms"."feedback" ADD CONSTRAINT "feedback_chk" CHECK ((score IS NULL) = (answered_at IS NULL) AND (score IS NULL OR score BETWEEN 0 AND 10) AND context IN ('VISIT', 'ADMISSION', 'OTHER'));
ALTER TABLE "hms"."report_schedules" ADD CONSTRAINT "report_schedules_chk" CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY') AND report IN ('COLLECTIONS', 'GST_REGISTER', 'DOCTOR_SHARE', 'RECEIVABLES', 'CLAIMS'));

-- Existing hospitals: the built-in roles gain the new permissions.
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['insurance:read', 'insurance:write', 'insurance:manage', 'ot:read', 'ot:write', 'ot:manage', 'er:read', 'er:write', 'roster:read', 'roster:manage', 'payouts:read', 'payouts:manage', 'feedback:read', 'exports:read', 'security:manage']))) WHERE "is_system" AND "key" = 'ADMIN';
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['er:read', 'er:write', 'ot:read', 'ot:write']))) WHERE "is_system" AND "key" = 'DOCTOR';
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['er:read', 'er:write', 'ot:read']))) WHERE "is_system" AND "key" = 'NURSE';
UPDATE "platform"."tenant_roles" SET "permissions" = (SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['er:read', 'er:write', 'insurance:read', 'insurance:write']))) WHERE "is_system" AND "key" = 'RECEPTIONIST';
