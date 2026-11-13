import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addStaff, admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";
import { stayDays } from "../src/routes/ipd";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let adm: string, rec: string, doc: string, nurse: string, other: string;
let patientId = "", p2 = "", wardId = "";

const call = async (token: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.rawPayload };
};

before(async () => {
  app = await makeApp();
  T = await makeTenant("ipd"); O = await makeTenant("ipd2");
  await admin.tenantFeatureOverride.create({ data: { tenantId: T.tenantId, feature: "ipd", enabled: true, setBy: T.doctor.id } });
  adm = await staffToken(app, (await addStaff(T, "ADMIN", "Ward Admin")).phone);
  nurse = await staffToken(app, (await addStaff(T, "NURSE", "Sister")).phone);
  rec = await staffToken(app, T.receptionist.phone); doc = await staffToken(app, T.doctor.phone);
  other = await staffToken(app, (await addStaff(O, "ADMIN", "Other Admin")).phone);
  patientId = (await call(rec, "POST", "/patients", { fullName: "Bed Patient", phone: newPhone() })).body.id;
  p2 = (await call(rec, "POST", "/patients", { fullName: "Second Patient", phone: newPhone() })).body.id;
});
after(async () => { await cleanupTenant(T); await cleanupTenant(O); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("inpatient care", () => {
  it("counts a stay in 24-hour blocks with a short grace and a one-day minimum", () => {
    const t = new Date("2026-10-01T10:00:00Z");
    const after = (h: number) => new Date(t.getTime() + h * 3_600_000);
    assert.equal(stayDays(t, after(1)), 1);
    assert.equal(stayDays(t, after(25)), 1, "two hours' grace");
    assert.equal(stayDays(t, after(27)), 2);
    assert.equal(stayDays(t, after(72)), 3);
  });

  it("is off for a hospital that does not have the feature", async () => {
    assert.equal((await call(other, "GET", "/ipd/overview")).status, 402);
  });

  it("lets a ward manager set up wards, and only that permission", async () => {
    assert.equal((await call(nurse, "POST", "/ipd/wards", { name: "Nope", kind: "GENERAL", dailyRatePaise: 100_000, bedCount: 2 })).status, 403);
    const w = await call(adm, "POST", "/ipd/wards", { name: "General Ward", kind: "GENERAL", dailyRatePaise: 150_000, bedCount: 3 });
    assert.equal(w.status, 201); wardId = w.body.id;
    assert.equal((await call(adm, "POST", "/ipd/wards", { name: "  General   Ward ", kind: "GENERAL", dailyRatePaise: 1 })).status, 409, "the same name, however it is spaced, is refused");
    const o = (await call(nurse, "GET", "/ipd/overview")).body;
    assert.equal(o.totals.beds, 3);
    assert.equal(o.totals.available, 3);
    const more = await call(adm, "POST", `/ipd/wards/${wardId}/beds`, { count: 2 });
    assert.equal(more.body.added.length, 2);
  });

  it("admits a patient into a bed, and refuses a second admission or a taken bed", async () => {
    const ov = (await call(rec, "GET", "/ipd/overview")).body;
    const beds = ov.wards.find((w: { id: string }) => w.id === wardId).beds;
    const a = await call(rec, "POST", "/ipd/admissions", { patientId, bedId: beds[0].id, doctorId: T.doctor.id, reason: "Fever and dehydration" });
    assert.equal(a.status, 201);
    assert.match(a.body.admissionNo, /^ADM-\d{4}-\d{5}$/);
    assert.equal((await call(rec, "POST", "/ipd/admissions", { patientId, bedId: beds[1].id, doctorId: T.doctor.id, reason: "again" })).status, 409, "already admitted");
    assert.equal((await call(rec, "POST", "/ipd/admissions", { patientId: p2, bedId: beds[0].id, doctorId: T.doctor.id, reason: "same bed" })).status, 409, "bed taken");
    assert.equal((await call(rec, "POST", "/ipd/admissions", { patientId: p2, bedId: beds[1].id, doctorId: T.receptionist.id, reason: "not a doctor" })).status, 400);
    const o = (await call(rec, "GET", "/ipd/overview")).body;
    assert.equal(o.totals.occupied, 1);
    assert.equal(o.wards.find((w: { id: string }) => w.id === wardId).beds.find((b: { code: string }) => b.code === beds[0].code).admission.patientName, "Bed Patient");
    assert.equal(o.today.admissions, 1);
  });

  it("two nurses racing for one bed: exactly one wins", async () => {
    const beds = (await call(rec, "GET", "/ipd/overview")).body.wards.find((w: { id: string }) => w.id === wardId).beds.filter((b: { status: string }) => b.status === "AVAILABLE");
    const [x, y] = await Promise.all([
      call(rec, "POST", "/ipd/admissions", { patientId: p2, bedId: beds[0].id, doctorId: T.doctor.id, reason: "race A" }),
      call(nurse, "POST", "/ipd/admissions", { patientId: p2, bedId: beds[1].id, doctorId: T.doctor.id, reason: "race B" }),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409], "one patient, one bed");
    const cur = (await call(rec, "GET", "/ipd/admissions?status=ADMITTED")).body;
    assert.equal(cur.filter((r: { patient: { id: string } }) => r.patient.id === p2).length, 1);
  });

  it("records vitals and notes, validates readings, and keeps them in order", async () => {
    const id = (await call(rec, "GET", "/ipd/admissions?q=Bed Patient")).body[0].id;
    assert.equal((await call(nurse, "POST", `/ipd/admissions/${id}/notes`, { kind: "VITALS", vitals: { pulse: 400 } })).status, 400);
    assert.equal((await call(nurse, "POST", `/ipd/admissions/${id}/notes`, { kind: "VITALS", vitals: { pulse: 88, systolic: 122, diastolic: 80, spo2: 97, temperatureC: 38.1 } })).status, 201);
    assert.equal((await call(doc, "POST", `/ipd/admissions/${id}/notes`, { kind: "ROUND", text: "Improving, continue IV fluids" })).status, 201);
    const d = (await call(rec, "GET", `/ipd/admissions/${id}`)).body;
    assert.equal(d.notes.length, 2);
    assert.equal(d.notes[0].kind, "ROUND", "newest first");
    assert.equal(d.stays.length, 1);
    assert.equal((await call(other, "GET", `/ipd/admissions/${id}`)).status, 402);
  });

  it("transfers to another bed, frees the old one for cleaning, and keeps the stay history", async () => {
    const id = (await call(rec, "GET", "/ipd/admissions?q=Bed Patient")).body[0].id;
    const w2 = (await call(adm, "POST", "/ipd/wards", { name: "Private Ward", kind: "PRIVATE", dailyRatePaise: 400_000, bedCount: 1 })).body;
    const bed2 = (await call(rec, "GET", "/ipd/overview")).body.wards.find((w: { id: string }) => w.id === w2.id).beds[0];
    assert.equal((await call(rec, "POST", `/ipd/admissions/${id}/transfer`, { bedId: bed2.id, reason: "Wants a private room" })).status, 200);
    const d = (await call(rec, "GET", `/ipd/admissions/${id}`)).body;
    assert.equal(d.stays.length, 2);
    assert.ok(d.stays[0].toAt && !d.stays[1].toAt);
    assert.equal(d.bed.ward, "Private Ward");
    const o = (await call(rec, "GET", "/ipd/overview")).body;
    assert.equal(o.wards.flatMap((w: { beds: { status: string }[] }) => w.beds).filter((b: { status: string }) => b.status === "CLEANING").length, 1);
    const cleaning = o.wards.flatMap((w: { beds: { id: string; status: string }[] }) => w.beds).find((b: { status: string }) => b.status === "CLEANING");
    assert.equal((await call(nurse, "PATCH", `/ipd/beds/${cleaning.id}`, { status: "AVAILABLE" })).status, 200, "housekeeping frees it");
    assert.equal((await call(nurse, "PATCH", `/ipd/beds/${bed2.id}`, { status: "AVAILABLE" })).status, 409, "an occupied bed cannot be freed by hand");
  });

  it("discharges with a summary, bills the stay, frees the bed and produces a PDF", async () => {
    const id = (await call(rec, "GET", "/ipd/admissions?q=Bed Patient")).body[0].id;
    assert.equal((await call(adm, "GET", `/ipd/admissions/${id}/summary.pdf`)).status, 409, "not before discharge");
    assert.equal((await call(doc, "POST", `/ipd/admissions/${id}/discharge`, { type: "RECOVERED", summary: { diagnosis: "x" } })).status, 400);
    const r = await call(doc, "POST", `/ipd/admissions/${id}/discharge`, {
      type: "RECOVERED", summary: { diagnosis: "Viral fever with dehydration", course: "Responded to IV fluids", advice: "Rest, plenty of fluids", medicines: "Paracetamol 500 mg SOS", followUpOn: "2026-11-01" },
      extraCharges: [{ description: "Nursing and procedures", amountPaise: 50_000 }], payment: { method: "CASH", amountPaise: 100_000 },
    });
    assert.equal(r.status, 200);
    const inv = r.body.invoice;
    assert.equal(inv.source, "IPD");
    // two stays each at least one day: 1 x 1,500 (general) + 1 x 4,000 (private) + 500 extra
    assert.equal(inv.totalPaise, 150_000 + 400_000 + 50_000);
    assert.equal(inv.status, "PARTIAL");
    assert.ok(r.body.outstandingPaise >= 500_000);
    assert.equal((await call(doc, "POST", `/ipd/admissions/${id}/discharge`, { type: "RECOVERED", summary: { diagnosis: "Again" } })).status, 409);
    assert.equal((await call(nurse, "POST", `/ipd/admissions/${id}/notes`, { kind: "NOTE", text: "late" })).status, 409, "closed");
    const pdf = await app.inject({ method: "GET", url: `/ipd/admissions/${id}/summary.pdf`, headers: auth(adm) });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.ok(pdf.rawPayload.subarray(0, 4).toString() === "%PDF");
    const o = (await call(rec, "GET", "/ipd/overview")).body;
    assert.equal(o.today.discharges, 1);
    assert.equal(o.totals.occupied, 1, "only the other patient is left");
    assert.equal((await call(rec, "GET", "/ipd/admissions?status=DISCHARGED")).body.length, 1);
  });

  it("stores and finds a patient by ABHA number, and rejects a malformed or duplicate one", async () => {
    assert.equal((await call(doc, "PUT", `/patients/${patientId}/clinical-profile`, { abhaNumber: "123" })).status, 400);
    const ok = await call(doc, "PUT", `/patients/${patientId}/clinical-profile`, { abhaNumber: "12-3456-7890-1234", abhaAddress: "bed.patient@abdm" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.abhaNumber, "12345678901234");
    assert.equal((await call(doc, "PUT", `/patients/${p2}/clinical-profile`, { abhaNumber: "12345678901234" })).status, 409);
    const scan = await call(rec, "POST", "/scan", { code: "12-3456-7890-1234" });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.kind, "PATIENT");
    assert.equal(scan.body.patient.id, patientId, "scanning an ABHA card finds the patient");
  });

  it("gives the chairman a dashboard with plain-language flags, and keeps it from everyone else", async () => {
    const e = await call(adm, "GET", "/analytics/executive");
    assert.equal(e.status, 200);
    assert.equal(e.body.trend.length, 30);
    assert.ok(e.body.inpatient.beds >= 5);
    assert.ok(e.body.revenueBySource.some((s: { source: string }) => s.source === "IPD"));
    assert.ok(Array.isArray(e.body.insights));
    assert.equal((await call(rec, "GET", "/analytics/executive")).status, 403);
    assert.equal((await call(other, "GET", "/analytics/executive")).status, 200, "another hospital sees only its own (empty) numbers");
    const mine = (await call(other, "GET", "/analytics/executive")).body;
    assert.equal(mine.inpatient.beds, 0);
    assert.equal(mine.kpis.billedPaise, 0);
  });
});
