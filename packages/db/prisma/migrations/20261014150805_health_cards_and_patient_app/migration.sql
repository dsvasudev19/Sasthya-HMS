-- CreateEnum
CREATE TYPE "hms"."CardType" AS ENUM ('INDIVIDUAL', 'FAMILY');

-- CreateEnum
CREATE TYPE "hms"."CardStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "hms"."PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');

-- AlterTable
ALTER TABLE "hms"."appointments" ADD COLUMN     "fee_waived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "patient_links" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."health_card_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "hms"."CardType" NOT NULL,
    "issue_fee_paise" INTEGER NOT NULL,
    "plan_price_paise" INTEGER NOT NULL,
    "duration_months" INTEGER NOT NULL DEFAULT 6,
    "max_members" INTEGER NOT NULL DEFAULT 1,
    "in_person_visits" INTEGER NOT NULL DEFAULT 3,
    "tele_visits" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "health_card_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."health_cards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "card_no" TEXT NOT NULL,
    "plan_id" UUID NOT NULL,
    "owner_patient_id" UUID NOT NULL,
    "status" "hms"."CardStatus" NOT NULL DEFAULT 'ACTIVE',
    "issue_fee_paise" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."health_card_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_card_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."card_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "payment_method" "hms"."PaymentMethod" NOT NULL,
    "in_person_limit" INTEGER NOT NULL,
    "tele_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hms"."benefit_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "channel" "hms"."VisitChannel" NOT NULL,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benefit_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_links_identity_id_tenant_id_key" ON "patient_links"("identity_id", "tenant_id");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_card_plans_tenant_id_id_key" ON "hms"."health_card_plans"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "health_cards_tenant_id_owner_patient_id_idx" ON "hms"."health_cards"("tenant_id", "owner_patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_cards_tenant_id_id_key" ON "hms"."health_cards"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "health_cards_tenant_id_card_no_key" ON "hms"."health_cards"("tenant_id", "card_no");

-- CreateIndex
CREATE INDEX "health_card_members_tenant_id_card_id_idx" ON "hms"."health_card_members"("tenant_id", "card_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_card_members_tenant_id_patient_id_key" ON "hms"."health_card_members"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "card_subscriptions_tenant_id_card_id_ends_at_idx" ON "hms"."card_subscriptions"("tenant_id", "card_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "card_subscriptions_tenant_id_id_key" ON "hms"."card_subscriptions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "benefit_usage_tenant_id_subscription_id_channel_idx" ON "hms"."benefit_usage"("tenant_id", "subscription_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "benefit_usage_tenant_id_appointment_id_key" ON "hms"."benefit_usage"("tenant_id", "appointment_id");

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_links" ADD CONSTRAINT "patient_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_card_plans" ADD CONSTRAINT "health_card_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_cards" ADD CONSTRAINT "health_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_cards" ADD CONSTRAINT "health_cards_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "hms"."health_card_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_cards" ADD CONSTRAINT "health_cards_tenant_id_owner_patient_id_fkey" FOREIGN KEY ("tenant_id", "owner_patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_card_members" ADD CONSTRAINT "health_card_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_card_members" ADD CONSTRAINT "health_card_members_tenant_id_card_id_fkey" FOREIGN KEY ("tenant_id", "card_id") REFERENCES "hms"."health_cards"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."health_card_members" ADD CONSTRAINT "health_card_members_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."card_subscriptions" ADD CONSTRAINT "card_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."card_subscriptions" ADD CONSTRAINT "card_subscriptions_tenant_id_card_id_fkey" FOREIGN KEY ("tenant_id", "card_id") REFERENCES "hms"."health_cards"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."benefit_usage" ADD CONSTRAINT "benefit_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."benefit_usage" ADD CONSTRAINT "benefit_usage_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "hms"."card_subscriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."benefit_usage" ADD CONSTRAINT "benefit_usage_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hms"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms"."benefit_usage" ADD CONSTRAINT "benefit_usage_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "hms"."appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS) for the new tenant-owned tables.
ALTER TABLE "hms"."health_card_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."health_card_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."health_card_plans"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."health_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."health_cards" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."health_cards"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."health_card_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."health_card_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."health_card_members"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."card_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."card_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."card_subscriptions"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());
ALTER TABLE "hms"."benefit_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hms"."benefit_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "hms"."benefit_usage"
  USING ("tenant_id" = "hms"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "hms"."current_tenant_id"());

-- Sanity checks on money and limits.
ALTER TABLE "hms"."health_card_plans" ADD CONSTRAINT "health_card_plans_amounts_chk"
  CHECK (issue_fee_paise >= 0 AND plan_price_paise >= 0 AND duration_months > 0 AND max_members > 0 AND in_person_visits >= 0 AND tele_visits >= 0);
ALTER TABLE "hms"."card_subscriptions" ADD CONSTRAINT "card_subscriptions_chk"
  CHECK (price_paise >= 0 AND ends_at > starts_at AND in_person_limit >= 0 AND tele_limit >= 0);

-- Platform tables: OTP challenges are written and expired by the app; links are insert-only plus delete on unlink.
GRANT DELETE ON "platform"."otp_challenges", "platform"."patient_links" TO "hms_app";
