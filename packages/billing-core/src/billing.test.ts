import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePlatformInvoice, hasFeature, monthOf, seatLimit, taxInside } from "./index";

describe("billing-core", () => {
  it("pay-per-patient: Rs 200 per new patient plus 18% GST", () => {
    const i = computePlatformInvoice({ plan: "PAY_PER_PATIENT", patientsAdded: 40, messagesSent: 0 });
    assert.equal(i.subtotalPaise, 800_000);
    assert.equal(i.gstPaise, 144_000);
    assert.equal(i.totalPaise, 944_000);
    assert.equal(i.lines.length, 1);
  });
  it("starter: flat Rs 10,000, free messages up to 500, overage at 25 paise", () => {
    assert.equal(computePlatformInvoice({ plan: "STARTER", patientsAdded: 999, messagesSent: 500 }).subtotalPaise, 1_000_000);
    const i = computePlatformInvoice({ plan: "STARTER", patientsAdded: 0, messagesSent: 620 });
    assert.equal(i.subtotalPaise, 1_000_000 + 120 * 25);
    assert.equal(i.totalPaise, i.subtotalPaise + Math.round(i.subtotalPaise * 0.18));
  });
  it("unlimited is Rs 20,000 and an empty pay-per-patient month is free", () => {
    assert.equal(computePlatformInvoice({ plan: "UNLIMITED", patientsAdded: 5000, messagesSent: 100 }).subtotalPaise, 2_000_000);
    assert.equal(computePlatformInvoice({ plan: "PAY_PER_PATIENT", patientsAdded: 0, messagesSent: 0 }).totalPaise, 0);
  });
  it("feature flags and seats follow the plan", () => {
    assert.ok(!hasFeature("PAY_PER_PATIENT", "pharmacy"));
    assert.ok(hasFeature("STARTER", "lab") && hasFeature("STARTER", "messaging"));
    assert.ok(!hasFeature("STARTER", "multi_branch") && hasFeature("UNLIMITED", "multi_branch"));
    assert.equal(seatLimit("PAY_PER_PATIENT"), 3);
    assert.equal(seatLimit("STARTER"), 10);
  });
  it("GST inside a tax-inclusive price", () => {
    assert.equal(taxInside(11_200, 12), 1_200);
    assert.equal(taxInside(10_500, 5), 500);
    assert.equal(taxInside(10_000, 0), 0);
  });
  it("month boundaries use IST", () => {
    const m = monthOf(new Date("2026-10-31T20:00:00Z")); // 1 Nov 01:30 IST
    assert.equal(m.label, "2026-11");
    assert.equal(m.start.toISOString().slice(0, 10), "2026-11-01");
    assert.equal(m.end.toISOString().slice(0, 10), "2026-11-30");
  });
});
