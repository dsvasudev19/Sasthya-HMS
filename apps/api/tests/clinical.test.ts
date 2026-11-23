import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, patientToken, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let rec: string, doc: string, nurse: string, pharm: string, lab: string, owner: string, other: string;
const patientPhone = newPhone();

const call = async (token: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  app = await makeApp();
  T = await makeTenant("clin");
  O = await makeTenant("clin2");
  const n = await addStaff(T, "NURSE", "Nurse");
  const p = await addStaff(T, "PHARMACIST", "Pharmacist");
  const l = await addStaff(T, "LAB_TECH", "Lab");
  const w = await addStaff(T, "OWNER", "Owner");
  rec = await staffToken(app, T.receptionist.phone);
  doc = await staffToken(app, T.doctor.phone);
  nurse = await staffToken(app, n.phone);
  pharm = await staffToken(app, p.phone);
  lab = await staffToken(app, l.phone);
  owner = await staffToken(app, w.phone);
  other = await staffToken(app, O.receptionist.phone);
});
after(async () => {
  await cleanupTenant(T);
  await cleanupTenant(O);
  await cleanupIdentities([patientPhone]);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

const newPatient = async (name: string, phone = newPhone()) => (await call(rec, "POST", "/patients", { fullName: name, phone })).body as { id: string };
const checkedIn = async (patientId: string) => {
  const a = (await call(rec, "POST", "/appointments", { patientId, scheduledAt: new Date(Date.now() + 3600_000).toISOString() })).body as { id: string };
  await call(rec, "PATCH", `/appointments/${a.id}`, { status: "CHECKED_IN" });
  return a.id;
};
const newMedicine = async (name: string, price = 500, reorder = 5) => (await call(pharm, "POST", "/medicines", { name, strength: "10 mg", pricePaise: price, reorderLevel: reorder })).body as { id: string };
const receive = (medicineId: string, batchNo: string, expiryDate: string, qty: number) => call(pharm, "POST", "/pharmacy/receipts", { medicineId, batchNo, expiryDate, qty });

describe("consultation", () => {
  it("nurse records vitals, doctor writes the prescription, visit completes; roles are enforced", async () => {
    const p = await newPatient("Consult One");
    const a = await checkedIn(p.id);
    assert.equal((await call(nurse, "PUT", `/appointments/${a}/vitals`, { bpSystolic: 130, bpDiastolic: 85, pulse: 78, weightKg: 62 })).status, 200);
    assert.equal((await call(rec, "PUT", `/appointments/${a}/consultation`, { diagnosis: "x" })).status, 403, "reception cannot write clinical notes");
    assert.equal((await call(nurse, "PUT", `/appointments/${a}/consultation`, { diagnosis: "x" })).status, 403, "nurse cannot diagnose");
    assert.equal((await call(doc, "PUT", `/appointments/${a}/vitals`, { bpSystolic: 500 })).status, 400, "implausible vitals are rejected");

    const saved = await call(doc, "PUT", `/appointments/${a}/consultation`, {
      complaints: "Fever 3 days", diagnosis: "Viral fever", advice: "Rest and fluids", followUpOn: day(5),
      items: [{ name: "Paracetamol 500 mg", dose: "1 tab", frequency: "1-1-1", durationDays: 3, quantity: 9 }],
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.vitals.bpSystolic, 130, "nurse vitals are kept when the doctor saves");
    assert.equal(saved.body.items.length, 1);

    const appt = (await call(doc, "GET", `/appointments/${a}/consultation`)).body;
    assert.equal(appt.appointment.status, "IN_PROGRESS");

    const noDx = await newPatient("No Dx");
    const a2 = await checkedIn(noDx.id);
    await call(doc, "PUT", `/appointments/${a2}/consultation`, { complaints: "cough" });
    assert.equal((await call(doc, "POST", `/appointments/${a2}/consultation/complete`)).status, 400, "diagnosis is required to complete");

    assert.equal((await call(doc, "POST", `/appointments/${a}/consultation/complete`)).status, 200);
    assert.equal((await call(doc, "PUT", `/appointments/${a}/consultation`, { diagnosis: "changed" })).status, 409, "completed notes are locked");
    assert.equal((await call(doc, "GET", `/appointments/${a}/consultation`)).body.appointment.status, "COMPLETED");
  });

  it("keeps consultations inside the hospital", async () => {
    const p = await newPatient("Private Notes");
    const a = await checkedIn(p.id);
    await call(doc, "PUT", `/appointments/${a}/consultation`, { diagnosis: "Secret" });
    assert.equal((await call(other, "GET", `/appointments/${a}/consultation`)).status, 403, "other hospital's receptionist has no clinical access");
    const doc2 = await addStaff(O, "DOCTOR", "Doc Other");
    assert.equal((await call(await staffToken(app, doc2.phone), "GET", `/appointments/${a}/consultation`)).status, 404);
  });
});

describe("pharmacy", () => {
  it("dispenses first-expiry-first-out, bills it, and writes the stock ledger", async () => {
    const m = await newMedicine("Fefo Tab", 1000);
    await receive(m.id, "LATE", day(300), 10);
    await receive(m.id, "SOON", day(90), 4);
    const p = await newPatient("Counter Customer");
    const r = await call(pharm, "POST", "/pharmacy/dispense", { patientId: p.id, items: [{ medicineId: m.id, qty: 6 }], payment: { method: "CASH" } });
    assert.equal(r.status, 201);
    assert.equal(r.body.invoice.totalPaise, 6_000);
    assert.equal(r.body.invoice.status, "PAID");
    const { batches, movements } = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body;
    assert.equal(batches.find((b: { batchNo: string }) => b.batchNo === "SOON").qtyOnHand, 0, "the batch expiring first is used up first");
    assert.equal(batches.find((b: { batchNo: string }) => b.batchNo === "LATE").qtyOnHand, 8);
    assert.equal(movements.filter((x: { type: string }) => x.type === "DISPENSE").reduce((s: number, x: { qty: number }) => s + x.qty, 0), -6);
  });

  it("never sells expired stock and rejects short stock without changing anything", async () => {
    const m = await newMedicine("Expiry Tab");
    await receive(m.id, "OK", day(100), 3);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      const branch = await tx.branch.findFirstOrThrow({ where: { isMain: true } });
      const b = await tx.stockBatch.create({ data: { tenantId: T.tenantId, branchId: branch.id, medicineId: m.id, batchNo: "OLD", expiryDate: new Date(Date.now() - 86_400_000), qtyReceived: 50, qtyOnHand: 50 } });
      assert.ok(b.id);
    });
    const p = await newPatient("Short Stock");
    const r = await call(pharm, "POST", "/pharmacy/dispense", { patientId: p.id, items: [{ medicineId: m.id, qty: 10 }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.short, 7, "only the 3 unexpired tablets count");
    const stock = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body.batches as { batchNo: string; qtyOnHand: number }[];
    assert.equal(stock.find((b) => b.batchNo === "OK")!.qtyOnHand, 3, "a failed sale leaves stock untouched");
    const alerts = (await call(pharm, "GET", "/pharmacy/alerts")).body;
    assert.ok(alerts.expired.some((b: { batchNo: string }) => b.batchNo === "OLD"));
  });

  it("two counters selling the last stock at once cannot oversell", async () => {
    const m = await newMedicine("Race Tab");
    await receive(m.id, "R1", day(200), 10);
    const p = await newPatient("Race Buyer");
    const results = await Promise.all(Array.from({ length: 5 }, () => call(pharm, "POST", "/pharmacy/dispense", { patientId: p.id, items: [{ medicineId: m.id, qty: 6 }] })));
    assert.equal(results.filter((r) => r.status === 201).length, 1, "only one sale of 6 fits in 10");
    const b = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body.batches[0];
    assert.equal(b.qtyOnHand, 4);
  });

  it("dispenses a prescription once, and lists pending prescriptions", async () => {
    const m = await newMedicine("Rx Tab", 300);
    await receive(m.id, "RX1", day(200), 40);
    const p = await newPatient("Rx Patient");
    const a = await checkedIn(p.id);
    await call(doc, "PUT", `/appointments/${a}/consultation`, { diagnosis: "Infection", items: [{ medicineId: m.id, name: "Rx Tab 10 mg", frequency: "1-0-1", durationDays: 5, quantity: 10 }] });
    await call(doc, "POST", `/appointments/${a}/consultation/complete`);
    const pending = (await call(pharm, "GET", "/pharmacy/prescriptions")).body as { id: string; patient: { id: string }; items: { available: number }[] }[];
    const mine = pending.find((x) => x.patient.id === p.id)!;
    assert.ok(mine, "completed prescription is waiting at the counter");
    assert.equal(mine.items[0]!.available, 40);
    const d = await call(pharm, "POST", "/pharmacy/dispense", { patientId: p.id, consultationId: mine.id, items: [{ medicineId: m.id, qty: 10 }], payment: { method: "UPI" } });
    assert.equal(d.status, 201);
    assert.equal((await call(pharm, "POST", "/pharmacy/dispense", { patientId: p.id, consultationId: mine.id, items: [{ medicineId: m.id, qty: 10 }] })).status, 409, "second dispense of the same prescription is refused");
    assert.ok(!((await call(pharm, "GET", "/pharmacy/prescriptions")).body as { id: string }[]).some((x) => x.id === mine.id));
  });

  it("adjustments cannot go below zero, low stock is flagged, and the ledger is append-only", async () => {
    const m = await newMedicine("Adjust Tab", 100, 20);
    const b = (await receive(m.id, "A1", day(100), 10)).body as { id: string };
    assert.equal((await call(pharm, "POST", "/pharmacy/adjustments", { batchId: b.id, qtyDelta: -11, reason: "DAMAGE" })).status, 409);
    assert.equal((await call(pharm, "POST", "/pharmacy/adjustments", { batchId: b.id, qtyDelta: -2, reason: "DAMAGE", note: "dropped" })).status, 201);
    assert.ok(((await call(pharm, "GET", "/pharmacy/alerts")).body.lowStock as { id: string }[]).some((x) => x.id === m.id), "8 on hand is under the reorder level of 20");
    assert.equal((await call(doc, "POST", "/medicines", { name: "Doctor Added", pricePaise: 1 })).status, 403, "doctors cannot edit the catalogue");
    await assert.rejects(appDb.$executeRawUnsafe(`UPDATE hms.stock_movements SET qty = 0`), /permission denied/);
    await assert.rejects(appDb.$executeRawUnsafe(`DELETE FROM hms.dispense_lines`), /permission denied/);
  });

  it("other hospitals cannot see or sell this stock", async () => {
    const m = await newMedicine("Isolated Tab");
    await receive(m.id, "ISO", day(100), 5);
    const list = (await call(other, "GET", "/medicines")).status;
    assert.equal(list, 403, "reception has no pharmacy access");
    const p2 = await addStaff(O, "PHARMACIST", "Other Pharm");
    const t2 = await staffToken(app, p2.phone);
    assert.ok(!((await call(t2, "GET", "/medicines")).body as { id: string }[]).some((x) => x.id === m.id));
    const op = (await call(other, "POST", "/patients", { fullName: "Other Patient", phone: newPhone() })).body as { id: string };
    assert.equal((await call(t2, "POST", "/pharmacy/dispense", { patientId: op.id, items: [{ medicineId: m.id, qty: 1 }] })).status, 404);
  });
});

describe("laboratory", () => {
  it("orders, collects, flags results, gates release on payment, and shows released reports to the patient", async () => {
    const p = await newPatient("Lab Patient", patientPhone);
    const a = await checkedIn(p.id);
    const tests = (await call(lab, "GET", "/lab/tests")).body as { id: string; code: string; pricePaise: number }[];
    const by = (c: string) => tests.find((t) => t.code === c)!;
    assert.equal((await call(rec, "POST", `/appointments/${a}/lab-orders`, { testIds: [by("HB").id] })).status, 403, "only doctors order in a visit");

    const order = await call(doc, "POST", `/appointments/${a}/lab-orders`, { testIds: [by("HB").id, by("FBS").id, by("MALARIA").id] });
    assert.equal(order.status, 201);
    const id = order.body.id as string;
    assert.equal(order.body.invoice.totalPaise, by("HB").pricePaise + by("FBS").pricePaise + by("MALARIA").pricePaise);
    assert.equal(order.body.invoice.status, "UNPAID");

    const items = order.body.items as { id: string; testName: string }[];
    const item = (name: string) => items.find((i) => i.testName.startsWith(name))!.id;
    assert.equal((await call(lab, "PUT", `/lab/orders/${id}/results`, { results: [{ itemId: item("Haemoglobin"), resultValue: 10 }] })).status, 409, "collect the sample first");
    assert.equal((await call(lab, "POST", `/lab/orders/${id}/collect`)).status, 200);

    const part = await call(lab, "PUT", `/lab/orders/${id}/results`, { results: [{ itemId: item("Haemoglobin"), resultValue: 6.5 }, { itemId: item("Blood sugar"), resultValue: 120 }] });
    assert.equal(part.body.status, "COLLECTED", "still waiting for the malaria result");
    const flags = Object.fromEntries((part.body.items as { testName: string; flag: string | null }[]).map((i) => [i.testName, i.flag]));
    assert.equal(flags["Haemoglobin"], "CRITICAL_LOW");
    assert.equal(flags["Blood sugar (fasting)"], "HIGH");
    const done = await call(lab, "PUT", `/lab/orders/${id}/results`, { results: [{ itemId: item("Malaria"), resultText: "Negative" }] });
    assert.equal(done.body.status, "RESULTED");

    assert.equal((await call(lab, "POST", `/lab/orders/${id}/release`, {})).status, 409, "unpaid bill blocks release");
    assert.equal((await call(lab, "POST", `/lab/orders/${id}/release`, { force: true })).status, 409, "a lab tech cannot override");

    const ptok = await patientToken(app, patientPhone);
    await app.inject({ method: "POST", url: `/patient/hospitals/${T.tenantId}/join`, headers: auth(ptok), payload: {} });
    assert.equal((await app.inject({ method: "GET", url: "/patient/records", headers: auth(ptok) })).json().labReports.length, 0, "not visible before release");

    await call(rec, "POST", `/invoices/${order.body.invoice.id}/payments`, { amountPaise: order.body.invoice.totalPaise, method: "UPI" });
    assert.equal((await call(lab, "POST", `/lab/orders/${id}/release`, {})).status, 200);
    assert.equal((await call(lab, "PUT", `/lab/orders/${id}/results`, { results: [{ itemId: item("Haemoglobin"), resultValue: 12 }] })).status, 409, "released results are locked");

    const records = (await app.inject({ method: "GET", url: "/patient/records", headers: auth(ptok) })).json();
    assert.equal(records.labReports.length, 1);
    assert.equal(records.labReports[0].items.length, 3);
  });

  it("an owner can release against an unpaid bill, which is audited; unpaid orders can be cancelled", async () => {
    const p = await newPatient("Owner Override");
    const tests = (await call(lab, "GET", "/lab/tests")).body as { id: string; code: string }[];
    const o = (await call(lab, "POST", "/lab/orders", { patientId: p.id, testIds: [tests.find((t) => t.code === "URINE")!.id] })).body;
    await call(lab, "POST", `/lab/orders/${o.id}/collect`);
    await call(lab, "PUT", `/lab/orders/${o.id}/results`, { results: [{ itemId: o.items[0].id, resultText: "Clear" }] });
    assert.equal((await call(owner, "POST", `/lab/orders/${o.id}/release`, { force: true })).status, 200);
    const audit = await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      return tx.auditLog.count({ where: { action: "lab.release_unpaid", entityId: o.id } });
    });
    assert.equal(audit, 1);

    const o2 = (await call(lab, "POST", "/lab/orders", { patientId: p.id, testIds: [tests.find((t) => t.code === "TSH")!.id] })).body;
    assert.equal((await call(lab, "POST", `/lab/orders/${o2.id}/cancel`)).body.status, "CANCELLED");
    assert.equal((await call(rec, "GET", `/invoices/${o2.invoice.id}`)).body.status, "VOID");
  });

  it("other hospitals cannot read lab orders", async () => {
    const l2 = await addStaff(O, "LAB_TECH", "Other Lab");
    const t2 = await staffToken(app, l2.phone);
    assert.equal(((await call(t2, "GET", "/lab/orders")).body as unknown[]).length, 0);
  });

  it("handles sample barcode, sample rejection and recollection, stats, and report PDF", async () => {
    const p = await newPatient("Lab Advanced Patient");
    const tests = (await call(lab, "GET", "/lab/tests")).body as { id: string; code: string }[];
    const hbTest = tests.find((t) => t.code === "HB")!;

    // 1. Order lab test
    const orderRes = await call(lab, "POST", "/lab/orders", {
      patientId: p.id,
      testIds: [hbTest.id],
      sampleBarcode: "SPEC-2026-001",
    });
    assert.equal(orderRes.status, 201);
    const orderId = orderRes.body.id as string;

    // 2. Collect sample with barcode
    const collectRes = await call(lab, "POST", `/lab/orders/${orderId}/collect`, {
      sampleBarcode: "SPEC-BAR-999",
    });
    assert.equal(collectRes.status, 200);
    assert.equal(collectRes.body.status, "COLLECTED");
    assert.equal(collectRes.body.sampleBarcode, "SPEC-BAR-999");

    // 3. Reject sample (e.g. Hemolyzed specimen)
    const rejectRes = await call(lab, "POST", `/lab/orders/${orderId}/sample-reject`, {
      reason: "Grossly hemolyzed, recollection required",
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.status, "ORDERED", "reverts to ORDERED so tech can recollect");
    assert.equal(rejectRes.body.rejectionReason, "Grossly hemolyzed, recollection required");

    // 4. Recollect sample
    const recollectRes = await call(lab, "POST", `/lab/orders/${orderId}/collect`, {
      sampleBarcode: "SPEC-BAR-1000",
    });
    assert.equal(recollectRes.status, 200);
    assert.equal(recollectRes.body.status, "COLLECTED");

    // 5. Result the test with critical value
    const resultRes = await call(lab, "PUT", `/lab/orders/${orderId}/results`, {
      results: [{ itemId: recollectRes.body.items[0].id, resultValue: 5.2, notes: "Confirmed on repeat" }],
    });
    assert.equal(resultRes.status, 200);
    assert.equal(resultRes.body.status, "RESULTED");
    assert.equal(resultRes.body.items[0].flag, "CRITICAL_LOW");

    // 6. Check lab stats
    const statsRes = await call(lab, "GET", "/lab/stats");
    assert.equal(statsRes.status, 200);
    assert.ok(typeof statsRes.body.critical === "number");
    assert.ok(statsRes.body.critical >= 1, "at least one critical flag observed");

    // 7. Pay bill and release
    await call(rec, "POST", `/invoices/${orderRes.body.invoice.id}/payments`, {
      amountPaise: orderRes.body.invoice.totalPaise,
      method: "CASH",
    });
    const releaseRes = await call(lab, "POST", `/lab/orders/${orderId}/release`, {});
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseRes.body.status, "RELEASED");

    // 8. Stream high-fidelity diagnostic lab report PDF
    const pdfRes = await app.inject({
      method: "GET",
      url: `/lab/orders/${orderId}/report.pdf`,
      headers: auth(lab),
    });
    assert.equal(pdfRes.statusCode, 200);
    assert.equal(pdfRes.headers["content-type"], "application/pdf");
    assert.ok(pdfRes.rawPayload.length > 500, "valid PDF buffer");
  });
});
