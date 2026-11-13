-- A discharged admission carries its time and outcome; an open one carries neither.
ALTER TABLE "hms"."admissions" DROP CONSTRAINT "admissions_chk";
ALTER TABLE "hms"."admissions" ADD CONSTRAINT "admissions_chk" CHECK ((status = 'DISCHARGED') = (discharged_at IS NOT NULL AND discharge_type IS NOT NULL));
-- One ABHA number belongs to one patient in a hospital.
DROP INDEX "hms"."patients_abha_idx";
CREATE UNIQUE INDEX "patients_abha_unique" ON "hms"."patients"("tenant_id", "abha_number") WHERE "abha_number" IS NOT NULL;
