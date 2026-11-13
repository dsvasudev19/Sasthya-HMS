import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { slipCode } from "../src/codes";
import { addStaff, admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let rec: string, doc: string, lab: string, pharm: string, other: string;
const HOUR = 3600_000;

const call = async (token: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  const isJson = String(res.headers["content-type"]).includes("json");
  return { status: res.statusCode, body: isJson ? res.json() : null, raw: res.rawPayload };
};
const scan = (token: string, code: string, extra: object = {}) => call(token, "POST", "/scan", { code, ...extra });
const newPatient = async (name: string, phone = newPhone()) => (await call(rec, "POST", "/patients", { fullName: name, phone })).body as { id: string; patientNo: string; phone: string };
const book = async (patientId: string, at = HOUR) => (await call(rec, "POST", "/appointments", { patientId, scheduledAt: new Date(Date.now() + at).toISOString() })).body as { id: string; tokenNo: number };

before(async () => {
  app = await makeApp();
  T = await makeTenant("scan"); O = await makeTenant("scan2");
  const l = await addStaff(T, "LAB_TECH", "Lab"); const p = await addStaff(T, "PHARMACIST", "Pharm");
  rec = await staffToken(app, T.receptionist.phone); doc = await staffToken(app, T.doctor.phone); lab = await staffToken(app, l.phone); pharm = await staffToken(app, p.phone);
  other = await staffToken(app, O.receptionist.phone);
});
after(async () => { await cleanupTenant(T); await cleanupTenant(O); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("scanning at reception", () => {
  it("a token slip scan checks the patient in with no typing, and a second scan only reports it", async () => {
    const p = await newPatient("Slip Patient");
    const a = await book(p.id);
    const first = (await scan(rec, slipCode(a.id))).body;
    assert.equal(first.outcome, "DONE", JSON.stringify(first));
    assert.equal(first.patient.fullName, "Slip Patient");
    assert.ok(first.message.startsWith("Checked in"));
    assert.ok(first.facts.some((f: { label: string; value: string }) => f.label === "Token" && f.value === `#${a.tokenNo}`));
    assert.equal((await call(rec, "GET", "/appointments")).body.find((x: { id: string }) => x.id === a.id).status, "CHECKED_IN");
    assert.ok((await call(rec, "GET", `/invoices?patientId=${p.id}`)).body.length >= 1, "the consultation bill was raised");
    const again = (await scan(rec, slipCode(a.id))).body;
    assert.equal(again.outcome, "INFO");
    assert.match(again.message, /Already checked in/);
  });

  it("scanning a patient number or phone checks in today's appointment; no appointment offers a walk-in; two appointments ask which", async () => {
    const p = await newPatient("Wristband Patient");
    assert.equal((await scan(rec, p.patientNo)).body.outcome, "NEEDS_BOOKING");
    const walk = (await scan(rec, p.patientNo, { action: "walkin", patientId: p.id })).body;
    assert.equal(walk.outcome, "DONE");
    assert.match(walk.message, /Walk-in/);

    const q = await newPatient("Phone Patient");
    await book(q.id);
    const byPhone = (await scan(rec, q.phone)).body;
    assert.equal(byPhone.outcome, "DONE", "a phone number works like a wristband");

    const r = await newPatient("Two Visits");
    const a1 = await book(r.id, 5 * 60_000), a2 = await book(r.id, 10 * 60_000);
    const ask = (await scan(rec, r.patientNo)).body;
    assert.equal(ask.outcome, "CHOOSE");
    assert.equal(ask.choices.length, 2);
    const picked = (await scan(rec, r.patientNo, { appointmentId: a2.id })).body;
    assert.equal(picked.outcome, "DONE");
    const rows = (await call(rec, "GET", "/appointments")).body as { id: string; status: string }[];
    assert.equal(rows.find((x) => x.id === a2.id)!.status, "CHECKED_IN");
    assert.equal(rows.find((x) => x.id === a1.id)!.status, "SCHEDULED", "only the chosen one was touched");
  });

  it("understands the QR links we print, rejects strangers, and respects permissions and hospitals", async () => {
    assert.equal((await scan(rec, "ZZZ-NOT-A-THING")).body.outcome, "NOT_FOUND");
    const p = await newPatient("Perm Patient");
    await book(p.id);
    assert.equal((await scan(lab, p.patientNo)).body.outcome, "DENIED", "lab staff cannot check people in");
    assert.equal((await scan(other, p.patientNo)).body.outcome, "NOT_FOUND", "another hospital cannot see this patient");
    assert.equal((await scan(other, slipCode((await book(p.id, 3 * HOUR)).id))).body.outcome, "NOT_FOUND");
  });
});

describe("scanning around the hospital", () => {
  it("a sample label scan marks the sample collected, then opens the order for results", async () => {
    const p = await newPatient("Lab Patient");
    const tests = (await call(rec, "GET", "/lab/tests")).body as { id: string }[];
    const order = (await call(lab, "POST", "/lab/orders", { patientId: p.id, testIds: [tests[0]!.id] })).body as { id: string; orderNo: string };
    const first = (await scan(lab, order.orderNo)).body;
    assert.equal(first.outcome, "DONE", JSON.stringify(first));
    assert.match(first.message, /collected/);
    const second = (await scan(lab, order.orderNo)).body;
    assert.equal(second.outcome, "INFO");
    assert.equal(second.open, `/lab?order=${order.id}`);
  });

  it("a bill scan opens it with what is owed; a signed prescription goes to the counter for pharmacists", async () => {
    const p = await newPatient("Bill And Rx");
    const a = await book(p.id);
    await call(rec, "PATCH", `/appointments/${a.id}`, { status: "CHECKED_IN" });
    const inv = (await call(rec, "GET", `/invoices?patientId=${p.id}`)).body[0] as { id: string; invoiceNo: string };
    const bill = (await scan(rec, inv.invoiceNo)).body;
    assert.equal(bill.kind, "INVOICE");
    assert.match(bill.message, /due/);
    assert.equal(bill.open, `/billing?invoice=${inv.id}`);

    const saved = (await call(doc, "POST", "/__none__").catch(() => null), (await app.inject({ method: "PUT", url: `/appointments/${a.id}/consultation`, headers: auth(doc), payload: { diagnosis: "Cold", items: [{ name: "Cetirizine", quantity: 5 }] } })).json());
    await app.inject({ method: "POST", url: `/appointments/${a.id}/consultation/complete`, headers: auth(doc) });
    const full = (await call(doc, "GET", `/patients/${p.id}/history`)).body.events.find((e: { type: string }) => e.type === "VISIT");
    const rxCode = (await import("./helpers")).admin;
    const row = await rxCode.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`; return tx.consultation.findUniqueOrThrow({ where: { id: saved.id } }); });
    void full;
    const asPharmacist = (await scan(pharm, row.rxCode!)).body;
    assert.equal(asPharmacist.kind, "PRESCRIPTION");
    assert.equal(asPharmacist.open, `/pharmacy/pos?rx=${saved.id}`);
    assert.equal((await scan(rec, `https://app.example.in/verify/${T.tenantId}/${row.rxCode}`)).body.open, `/patients/${p.id}`, "the QR link is understood; reception is sent to the record");
  });
});

describe("search and printouts", () => {
  it("finds across the hospital in one box, showing only what the person may see", async () => {
    const p = await newPatient("Searchable Sharma");
    const all = (await call(rec, "GET", "/search?q=Searchable")).body;
    assert.equal(all.patients[0].id, p.id);
    assert.equal(all.medicines.length, 0, "reception does not see the pharmacy");
    const byNo = (await call(rec, "GET", `/search?q=${p.patientNo}`)).body;
    assert.equal(byNo.patients[0].id, p.id);
    assert.equal((await call(other, "GET", "/search?q=Searchable")).body.patients.length, 0);
    const m = (await call(pharm, "POST", "/medicines", { name: "Searchable Tab", pricePaise: 100, reorderLevel: 1 })).body;
    assert.equal((await call(pharm, "GET", "/search?q=Searchable")).body.medicines[0].id, m.id);
  });

  it("prints a token slip, a patient card and sample labels as real PDFs", async () => {
    const p = await newPatient("Print Patient");
    const a = await book(p.id);
    for (const url of [`/appointments/${a.id}/slip.pdf`, `/patients/${p.id}/card.pdf`]) {
      const r = await call(rec, "GET", url);
      assert.equal(r.status, 200, url);
      assert.equal(r.raw.subarray(0, 4).toString(), "%PDF");
      assert.ok(r.raw.toString("latin1").includes("/XObject"), "carries the barcode image");
    }
    const tests = (await call(rec, "GET", "/lab/tests")).body as { id: string }[];
    const order = (await call(lab, "POST", "/lab/orders", { patientId: p.id, testIds: [tests[0]!.id] })).body;
    const labels = await call(lab, "GET", `/lab/orders/${order.id}/labels.pdf?copies=3`);
    assert.equal(labels.status, 200);
    assert.equal((labels.raw.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 3, "one label per tube");
    assert.equal((await call(other, "GET", `/appointments/${a.id}/slip.pdf`)).status, 404, "another hospital cannot print it");
  });
});
