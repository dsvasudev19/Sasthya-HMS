-- CreateTable
CREATE TABLE "tenant_profiles" (
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "registration_no" TEXT,
    "drug_licence_no" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "website" TEXT,
    "bed_count" INTEGER,
    "admin_designation" TEXT,
    "admin_email" TEXT,
    "billing_email" TEXT,
    "billing_contact" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_agreements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "signed_by_name" TEXT NOT NULL,
    "signed_by_title" TEXT NOT NULL,
    "signed_by_email" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "term_months" INTEGER NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "document_ref" TEXT,
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_agreements_tenant_id_created_at_idx" ON "tenant_agreements"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════ Integrity and grants ═════════
-- A signed agreement is evidence: it can be added, never edited or removed.
REVOKE UPDATE, DELETE ON "platform"."tenant_agreements" FROM "hms_app";
ALTER TABLE "platform"."tenant_agreements" ADD CONSTRAINT "tenant_agreements_chk" CHECK (term_months BETWEEN 1 AND 120 AND kind IN ('MSA', 'DPA', 'ORDER_FORM', 'BAA', 'OTHER'));
ALTER TABLE "platform"."tenant_profiles" ADD CONSTRAINT "tenant_profiles_chk" CHECK (
  pincode ~ '^[1-9][0-9]{5}$'
  AND (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
  AND (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
  AND (bed_count IS NULL OR bed_count >= 0));
