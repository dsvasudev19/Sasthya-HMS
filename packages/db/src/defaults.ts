import type { TenantTx } from "./index";

/** Default Health Card plans every new hospital starts with. Prices are in paise and editable per hospital. */
export async function ensureDefaultCardPlans(tx: TenantTx, tenantId: string): Promise<void> {
  if ((await tx.healthCardPlan.count()) > 0) return;
  await tx.healthCardPlan.createMany({
    data: [
      { tenantId, name: "Individual Health Card", type: "INDIVIDUAL", issueFeePaise: 20_000, planPricePaise: 200_000, maxMembers: 1, inPersonVisits: 3, teleVisits: 2 },
      { tenantId, name: "Family Health Card (up to 5)", type: "FAMILY", issueFeePaise: 50_000, planPricePaise: 800_000, maxMembers: 5, inPersonVisits: 3, teleVisits: 2 },
    ],
  });
}

/** Default price list. Hospitals edit these amounts (paise) from the dashboard. */
export async function ensureDefaultFeeItems(tx: TenantTx, tenantId: string): Promise<void> {
  if ((await tx.feeItem.count()) > 0) return;
  await tx.feeItem.createMany({
    data: [
      { tenantId, code: "CONSULT_IN_PERSON", name: "Consultation (in person)", kind: "CONSULTATION", pricePaise: 20_000 },
      { tenantId, code: "CONSULT_TELE", name: "Tele-consultation", kind: "CONSULTATION", pricePaise: 15_000 },
    ],
  });
}

/** Starter lab catalogue (single-analyte tests). Hospitals edit prices and ranges. Prices in paise. */
export async function ensureDefaultLabTests(tx: TenantTx, tenantId: string): Promise<void> {
  if ((await tx.labTest.count()) > 0) return;
  const t = (code: string, name: string, pricePaise: number, extra: Record<string, unknown> = {}) => ({ tenantId, code, name, pricePaise, ...extra });
  await tx.labTest.createMany({
    data: [
      t("HB", "Haemoglobin", 8_000, { unit: "g/dL", refLow: 12, refHigh: 16, critLow: 7, critHigh: 20 }),
      t("WBC", "Total WBC count", 10_000, { unit: "cells/µL", refLow: 4000, refHigh: 11000, critLow: 2000, critHigh: 30000 }),
      t("FBS", "Blood sugar (fasting)", 5_000, { unit: "mg/dL", refLow: 70, refHigh: 100, critLow: 40, critHigh: 400 }),
      t("PPBS", "Blood sugar (post-meal)", 5_000, { unit: "mg/dL", refLow: 70, refHigh: 140, critLow: 40, critHigh: 450 }),
      t("HBA1C", "HbA1c", 35_000, { unit: "%", refLow: 4, refHigh: 5.6, critHigh: 14 }),
      t("CHOL", "Total cholesterol", 15_000, { unit: "mg/dL", refLow: 0, refHigh: 200 }),
      t("CREAT", "Serum creatinine", 12_000, { unit: "mg/dL", refLow: 0.6, refHigh: 1.3, critHigh: 10 }),
      t("TSH", "TSH", 30_000, { unit: "mIU/L", refLow: 0.4, refHigh: 4 }),
      t("MALARIA", "Malaria antigen", 25_000, { sampleType: "BLOOD" }),
      t("URINE", "Urine routine", 6_000, { sampleType: "URINE" }),
    ],
  });
}
