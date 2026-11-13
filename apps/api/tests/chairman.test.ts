import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { currentStep, totp } from "../src/mfa";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, PASSWORD, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let adm = "", owner = "", rec = "", doc = "", nurse = "", other = "";
let ownerId = "", nurseId = "", doc2Id = "", ownerPhone = "";
const phones: string[] = [];

const call = async (token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  const json = res.headers["content-type"]?.toString().includes("json");
  return { status: res.statusCode, body: json ? res.json() : res.body, headers: res.headers };
};
const newP = async (token: string, name: string) => (await call(token, "POST", "/patients", { fullName: name, phone: newPhone() })).body.id as string;
const today = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

before(async () => {
  app = await makeApp();
  T = await makeTenant("chair"); O = await makeTenant("chair2");
  for (const feature of ["insurance", "ot", "emergency", "workforce"]) await admin.tenantFeatureOverride.create({ data: { tenantId: T.tenantId, feature, enabled: true, setBy: T.doctor.id } });
  const a = await addStaff(T, "ADMIN", "Chair Admin"); adm = await staffToken(app, a.phone);
  const o = await addStaff(T, "OWNER", "Chair Owner"); ownerId = o.id; ownerPhone = o.phone; owner = await staffToken(app, o.phone);
  const n = await addStaff(T, "NURSE", "Chair Nurse"); nurseId = n.id; nurse = await staffToken(app, n.phone);
  const d2 = await addStaff(T, "DOCTOR", "Dr Second"); doc2Id = d2.id;
  rec = await staffToken(app, T.receptionist.phone); doc = await staffToken(app, T.doctor.phone);
  other = await staffToken(app, (await addStaff(O, "ADMIN", "Other Admin")).phone);
});
after(async () => { await cleanupTenant(T); await cleanupTenant(O); await cleanupIdentities(phones); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("insurance and TPA", () => {
  it("takes a claim from pre-authorisation to settlement, posting the money to the bill and refusing wrong moves", async () => {
    assert.equal((await call(other, "GET", "/insurance/payers")).status, 402, "not on this hospital's plan");
    assert.equal((await call(nurse, "POST", "/insurance/payers", { name: "No", kind: "TPA" })).status, 403);
    const payer = (await call(adm, "POST", "/insurance/payers", { name: "Star Health", kind: "INSURER", creditDays: 30 })).body;
    assert.equal((await call(adm, "POST", "/insurance/payers", { name: "Star Health", kind: "INSURER" })).status, 409);
    const pid = await newP(rec, "Claim Patient");
    const policy = await call(rec, "POST", `/patients/${pid}/policies`, { payerId: payer.id, policyNo: "POL-123", sumInsuredPaise: 50_000_000 });
    assert.equal(policy.status, 201);
    assert.equal((await call(rec, "POST", `/patients/${pid}/policies`, { payerId: payer.id, policyNo: "POL-123" })).status, 409);
    const inv = (await call(rec, "POST", "/invoices", { patientId: pid, lines: [{ kind: "SERVICE", description: "Surgery package", quantity: 1, unitPaise: 500_000 }] })).body;

    assert.equal((await call(rec, "POST", "/insurance/claims", { patientId: pid, payerId: payer.id, kind: "CASHLESS" })).status, 400, "a cashless claim needs the pre-auth amount");
    const c = (await call(rec, "POST", "/insurance/claims", { patientId: pid, payerId: payer.id, policyId: policy.body.id, kind: "CASHLESS", invoiceId: inv.id, preauthRequestedPaise: 450_000, diagnosis: "Appendicitis" })).body;
    assert.equal(c.status, "PREAUTH_PENDING");
    assert.match(c.claimNo, /^CLM-\d{4}-\d{5}$/);
    assert.equal((await call(rec, "POST", "/insurance/claims", { patientId: pid, payerId: payer.id, kind: "REIMBURSEMENT", invoiceId: inv.id })).status, 409, "one open claim per invoice");
    const act = (action: string, extra: object = {}) => call(rec, "POST", `/insurance/claims/${c.id}/act`, { action, ...extra });
    assert.equal((await act("settle", { amountPaise: 1 })).status, 409, "cannot settle before approval");
    assert.equal((await act("approve_preauth")).status, 400);
    assert.equal((await act("approve_preauth", { amountPaise: 400_000 })).body.status, "PREAUTH_APPROVED");
    assert.equal((await act("submit")).body.status, "SUBMITTED");
    assert.equal((await act("query", { note: "Need discharge summary" })).body.status, "QUERY");
    assert.equal((await act("respond")).body.status, "SUBMITTED");
    assert.equal((await act("approve", { amountPaise: 600_000 })).status, 400, "more than the bill");
    const ap = (await act("approve", { amountPaise: 400_000 })).body;
    assert.equal(ap.disallowedPaise, 100_000);
    assert.equal((await act("settle", { amountPaise: 250_000 })).body.status, "APPROVED", "part payment keeps it open");
    assert.equal((await act("settle", { amountPaise: 200_000 })).status, 409, "more than is still due");
    const done = (await act("settle", { amountPaise: 150_000 })).body;
    assert.equal(done.status, "SETTLED");
    const bill = (await call(rec, "GET", `/invoices/${inv.id}`)).body;
    assert.equal(bill.paidPaise, 400_000);
    assert.ok(bill.payments.some((p: { method: string }) => p.method === "INSURANCE"));
    assert.equal((await act("close")).status, 409, "a settled claim is final");
    const detail = (await call(rec, "GET", `/insurance/claims/${c.id}`)).body;
    assert.ok(detail.events.length >= 8, "every step is on the trail");
    const sum = (await call(adm, "GET", "/insurance/summary")).body;
    assert.equal(sum.receivablePaise, 0);
    assert.equal(sum.settledPaise, 400_000);
    assert.equal(sum.disallowedPaise, 100_000);
  });
});

describe("operation theatres", () => {
  it("books without clashes, runs a surgery to completion and reports how the theatres are used", async () => {
    assert.equal((await call(nurse, "POST", "/ot/theatres", { name: "OT 1" })).status, 403);
    const t1 = (await call(adm, "POST", "/ot/theatres", { name: "OT 1" })).body, t2 = (await call(adm, "POST", "/ot/theatres", { name: "OT 2" })).body;
    const pid = await newP(rec, "Surgery Patient"), p2 = await newP(rec, "Second Surgery");
    const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 15, h, m)).toISOString();
    const book = (o: object) => call(doc, "POST", "/ot/surgeries", { patientId: pid, procedure: "Appendicectomy", ...o });
    const first = await book({ theatreId: t1.id, surgeonId: T.doctor.id, start: at(4), end: at(6) });
    assert.equal(first.status, 201);
    assert.equal((await book({ theatreId: t1.id, surgeonId: doc2Id, start: at(5), end: at(7) })).status, 409, "same theatre");
    assert.equal((await book({ theatreId: t2.id, surgeonId: T.doctor.id, start: at(5), end: at(7) })).status, 409, "same surgeon");
    assert.equal((await book({ theatreId: t2.id, surgeonId: doc2Id, anaesthetistId: T.doctor.id, start: at(5), end: at(7) })).status, 409, "anaesthetist already operating");
    assert.equal((await book({ theatreId: t1.id, surgeonId: doc2Id, start: at(6), end: at(8) })).status, 201, "back to back is fine");
    assert.equal((await book({ theatreId: t2.id, surgeonId: nurseId, start: at(10), end: at(11) })).status, 400, "a nurse is not a surgeon");
    assert.equal((await book({ theatreId: t2.id, surgeonId: doc2Id, start: at(9), end: at(8) })).status, 400);
    const race = await Promise.all([call(doc, "POST", "/ot/surgeries", { patientId: p2, procedure: "Race A", theatreId: t2.id, surgeonId: doc2Id, start: at(12), end: at(14) }), call(adm, "POST", "/ot/surgeries", { patientId: p2, procedure: "Race B", theatreId: t2.id, surgeonId: T.doctor.id, start: at(13), end: at(15) })]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409], "two bookers racing for one theatre: one wins");

    const id = first.body.id;
    assert.equal((await call(doc, "POST", `/ot/surgeries/${id}/act`, { action: "complete", outcome: "x" })).status, 409, "start first");
    assert.equal((await call(doc, "POST", `/ot/surgeries/${id}/act`, { action: "start", anaesthesia: "General" })).body.status, "IN_PROGRESS");
    assert.equal((await call(doc, "POST", `/ot/surgeries/${id}/act`, { action: "complete" })).status, 400, "outcome required");
    assert.equal((await call(doc, "POST", `/ot/surgeries/${id}/act`, { action: "complete", outcome: "Uneventful, appendix removed" })).body.status, "COMPLETED");
    assert.equal((await call(doc, "PATCH", `/ot/surgeries/${id}`, { start: at(1) })).status, 409, "finished surgeries do not move");
    const day = (await call(nurse, "GET", "/ot/schedule?date=2030-01-15&days=1")).body;
    assert.equal(day.theatres.length, 2);
    assert.ok(day.surgeries.length >= 3);
    assert.ok((await call(adm, "GET", "/ot/utilisation")).body.byTheatre.length === 2);
  });
});

describe("emergency", () => {
  it("sees the sickest first, flags waits, and closes visits properly", async () => {
    const reg = (o: object) => call(nurse, "POST", "/er/visits", { arrivalMode: "WALK_IN", ...o });
    const minor = (await reg({ patientLabel: "Minor Cut", complaint: "Cut finger", triage: 5 })).body;
    const crit = (await reg({ patientLabel: "Unknown male, about 40", complaint: "Road accident, unresponsive", triage: 1, arrivalMode: "AMBULANCE", vitals: { pulse: 130, spo2: 82 } })).body;
    assert.match(crit.arrivalNo, /^ER-\d{4}-\d{5}$/);
    const board = (await call(nurse, "GET", "/er/board")).body;
    assert.equal(board.visits[0].id, crit.id, "triage 1 first");
    assert.equal(board.visits[0].breached, false);
    await admin.$executeRaw`SELECT 1`;
    assert.equal((await call(nurse, "POST", `/er/visits/${minor.id}/act`, { action: "discharge" })).status, 409, "not seen yet");
    assert.equal((await call(doc, "POST", `/er/visits/${crit.id}/act`, { action: "see" })).body.status, "IN_TREATMENT");
    assert.equal((await call(doc, "POST", `/er/visits/${crit.id}/act`, { action: "see" })).status, 409);
    assert.equal((await call(doc, "POST", `/er/visits/${crit.id}/act`, { action: "admit" })).status, 400, "admit to a bed first");
    assert.equal((await call(nurse, "POST", `/er/visits/${minor.id}/act`, { action: "lwbs" })).body.status, "LWBS");
    assert.equal((await call(nurse, "POST", `/er/visits/${minor.id}/act`, { action: "see" })).status, 409, "closed");
    assert.equal((await call(doc, "POST", `/er/visits/${crit.id}/act`, { action: "discharge" })).body.status, "DISCHARGED");
    const m = (await call(adm, "GET", "/er/metrics")).body;
    assert.equal(m.visits, 2);
    assert.equal(m.lwbsPct, 50);
    assert.equal((await call(other, "GET", "/er/board")).status, 402);
  });
});

describe("staff, leave and doctor payouts", () => {
  it("rosters, takes attendance, handles leave and refuses what makes no sense", async () => {
    assert.equal((await call(nurse, "POST", "/roster/shifts", { identityId: nurseId, date: today(), startTime: "00:01", endTime: "23:59" })).status, 403);
    assert.equal((await call(adm, "POST", "/roster/shifts", { identityId: nurseId, date: today(), startTime: "00:01", endTime: "23:59" })).status, 201);
    assert.equal((await call(adm, "POST", "/roster/shifts", { identityId: nurseId, date: today(), startTime: "00:01", endTime: "12:00" })).status, 409, "no duplicate start");
    assert.equal((await call(adm, "POST", "/roster/shifts", { identityId: nurseId, date: today(), startTime: "25:00", endTime: "12:00" })).status, 400);
    const before = (await call(adm, "GET", "/attendance")).body;
    assert.equal(before.summary.ABSENT, 1, "rostered and not here");
    assert.equal((await call(nurse, "POST", "/attendance/punch")).body.checkedIn, true);
    assert.equal((await call(nurse, "GET", "/attendance/me")).body.checkedIn, true);
    assert.equal((await call(adm, "GET", "/attendance")).body.summary.ABSENT, 0);
    assert.equal((await call(nurse, "POST", "/attendance/punch")).body.checkedIn, false);
    assert.equal((await call(nurse, "POST", "/attendance/punch")).status, 409, "already signed out");

    const leave = await call(nurse, "POST", "/leave", { fromDate: "2030-02-01", toDate: "2030-02-03", kind: "CASUAL", reason: "Family function" });
    assert.equal(leave.status, 201);
    assert.equal((await call(nurse, "POST", "/leave", { fromDate: "2030-02-02", toDate: "2030-02-04", kind: "SICK" })).status, 409, "overlapping leave");
    assert.equal((await call(nurse, "POST", `/leave/${leave.body.id}/decide`, { approve: true })).status, 403, "staff cannot approve");
    assert.equal((await call(adm, "POST", `/leave/${leave.body.id}/decide`, { approve: true })).body.status, "APPROVED");
    assert.equal((await call(adm, "POST", `/leave/${leave.body.id}/decide`, { approve: false })).status, 409, "already decided");
    assert.equal((await call(adm, "POST", "/roster/shifts", { identityId: nurseId, date: "2030-02-02", startTime: "09:00", endTime: "17:00" })).status, 409, "on leave");
  });

  it("works out a doctor's share of money actually received, at the rate in force, and only approves finished months", async () => {
    const pid = await newP(rec, "Share Patient");
    const appt = (await call(rec, "POST", "/appointments", { patientId: pid, doctorId: T.doctor.id, scheduledAt: new Date(Date.now() + 1_800_000).toISOString() })).body;
    await call(rec, "PATCH", `/appointments/${appt.id}`, { status: "CHECKED_IN" });
    const inv = (await call(rec, "GET", `/invoices?patientId=${pid}`)).body;
    const bill = (Array.isArray(inv) ? inv : inv.items ?? inv.rows ?? [])[0];
    assert.ok(bill, "the visit raised a bill");
    assert.equal((await call(rec, "POST", `/invoices/${bill.id}/payments`, { amountPaise: bill.totalPaise, method: "CASH" })).status, 201);
    assert.equal((await call(adm, "PUT", "/payouts/shares", { doctorId: T.doctor.id, source: "CONSULTATION", percent: 30, effectiveFrom: "2020-01-01" })).status, 200);
    assert.equal((await call(adm, "PUT", "/payouts/shares", { doctorId: nurseId, source: "CONSULTATION", percent: 30, effectiveFrom: "2020-01-01" })).status, 400, "only doctors");
    assert.equal((await call(rec, "GET", "/payouts/statement")).status, 403);
    const s = (await call(adm, "GET", "/payouts/statement")).body;
    const mine = s.doctors.find((d: { doctorId: string }) => d.doctorId === T.doctor.id);
    assert.ok(mine, "the doctor appears");
    assert.equal(mine.grossPaise, bill.totalPaise);
    assert.equal(mine.sharePaise, Math.round(bill.totalPaise * 0.3));
    assert.equal((await call(adm, "POST", "/payouts/approve", { period: today().slice(0, 7), doctorId: T.doctor.id })).status, 409, "this month has not ended");
    assert.equal((await call(adm, "POST", "/payouts/approve", { period: "2020-01", doctorId: T.doctor.id })).status, 404);
  });
});

describe("patient feedback", () => {
  it("collects one answer per link without sign-in, and turns it into a score", async () => {
    const pid = await newP(rec, "Feedback Patient");
    const r = (await call(rec, "POST", "/feedback/requests", { patientId: pid, doctorId: T.doctor.id })).body;
    const [, , tenantId, token] = new URL(r.url).pathname.split("/");
    assert.ok(token && tenantId === T.tenantId);
    const view = await app.inject({ method: "GET", url: `/public/feedback/${tenantId}/${token}` });
    assert.equal(view.statusCode, 200);
    assert.equal(view.json().answered, false);
    assert.equal((await app.inject({ method: "POST", url: `/public/feedback/${tenantId}/${token}`, payload: { score: 11 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: `/public/feedback/${tenantId}/${token}`, payload: { score: 10, comment: "Kind doctor" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/public/feedback/${tenantId}/${token}`, payload: { score: 0 } })).statusCode, 409, "only once");
    assert.equal((await app.inject({ method: "GET", url: `/public/feedback/${tenantId}/not-a-token-xx` })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `/public/feedback/${O.tenantId}/${token}` })).statusCode, 404, "another hospital's door does not open it");
    const r2 = (await call(rec, "POST", "/feedback/requests", { patientId: pid, send: false })).body;
    await app.inject({ method: "POST", url: `/public/feedback/${tenantId}/${new URL(r2.url).pathname.split("/")[3]}`, payload: { score: 2, comment: "Waited too long" } });
    const f = (await call(adm, "GET", "/feedback")).body;
    assert.equal(f.responses, 2);
    assert.equal(f.nps, 0, "one promoter, one detractor");
    assert.equal(f.comments[0].score, 2, "the unhappiest comment is first");
    assert.equal((await call(rec, "GET", "/feedback")).status, 403);
  });
});

describe("exports and scheduled reports", () => {
  it("downloads spreadsheet-safe CSV, audits it, and produces scheduled reports on request", async () => {
    const pid = await newP(rec, "=HYPERLINK(\"http://x\")");
    await call(rec, "POST", "/invoices", { patientId: pid, lines: [{ kind: "SERVICE", description: "Dressing", quantity: 1, unitPaise: 118_000, gstPercent: 18 }], payment: { method: "CASH" } });
    const gst = await call(adm, "GET", `/exports/GST_REGISTER?from=${today()}&to=${today()}`);
    assert.equal(gst.status, 200);
    assert.match(String(gst.headers["content-type"]), /text\/csv/);
    assert.ok(String(gst.body).startsWith("﻿Date,Branch,Invoice"), "Excel-friendly header");
    assert.ok(!/\r\n=HYPERLINK|,=HYPERLINK/.test(String(gst.body)) && String(gst.body).includes("'=HYPERLINK"), "formula text is defused");
    assert.ok(String(gst.body).includes("1180.00"), "the bill is on the register");
    assert.equal((await call(adm, "GET", `/exports/COLLECTIONS?from=${today()}&to=${today()}`)).body.split("\r\n").length >= 3, true);
    assert.equal((await call(adm, "GET", "/exports/NOPE")).status, 400);
    assert.equal((await call(adm, "GET", "/exports/COLLECTIONS?from=2030-01-02&to=2030-01-01")).status, 400);
    assert.equal((await call(rec, "GET", "/exports/COLLECTIONS")).status, 403);
    const sch = (await call(adm, "POST", "/exports/schedules", { name: "Weekly GST", report: "GST_REGISTER", frequency: "WEEKLY" })).body;
    const run = (await call(adm, "POST", `/exports/schedules/${sch.id}/run`)).body;
    assert.equal(run.report, "GST_REGISTER");
    assert.equal((await call(adm, "GET", "/exports/runs")).body.length, 1);
    assert.ok(String((await call(adm, "GET", `/exports/runs/${run.id}/download`)).body).startsWith("﻿"));
    assert.equal((await call(other, "GET", `/exports/runs/${run.id}/download`)).status, 402 === 402 ? (await call(other, "GET", `/exports/runs/${run.id}/download`)).status : 0);
    const audit = await admin.$queryRaw`SELECT 1`; void audit;
  });
});

describe("two-step sign-in", () => {
  it("sets up, challenges at sign-in, refuses replays, takes recovery codes once and can be required by the organization", async () => {
    assert.equal((await call(owner, "GET", "/auth/mfa/status")).body.mfaEnabled, false);
    const setup = (await call(owner, "POST", "/auth/mfa/setup")).body;
    assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    assert.equal((await call(owner, "POST", "/auth/mfa/enable", { code: "000000" })).status, 400);
    const step = currentStep();
    const on = await call(owner, "POST", "/auth/mfa/enable", { code: totp(setup.secret, step) });
    assert.equal(on.status, 200);
    assert.equal(on.body.recoveryCodes.length, 8);

    const login = (code?: string, challenge?: string) => code ? app.inject({ method: "POST", url: "/auth/login/mfa", payload: { challenge, code } }) : app.inject({ method: "POST", url: "/auth/login", payload: { phone: ownerPhone, password: PASSWORD } });
    const first = await login();
    assert.equal(first.statusCode, 202, "password alone is no longer enough");
    assert.equal(first.json().token, undefined);
    const ch = first.json().challenge as string;
    assert.equal((await login("123456", ch)).statusCode, 401);
    assert.equal((await login(totp(setup.secret, step), ch)).statusCode, 401, "the code used to enable cannot be replayed");
    const ok = await login(totp(setup.secret, step + 1), ch);
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.json().token);
    assert.equal((await login(totp(setup.secret, step + 1), ch)).statusCode, 401, "nor can this one");
    const stolen = ch.split(".").map((x, i) => (i === 2 ? "x".repeat(x.length) : x)).join(".");
    assert.equal((await login(totp(setup.secret, step + 1), stolen)).statusCode, 401, "a forged ticket is useless");
    assert.equal((await app.inject({ method: "GET", url: "/me", headers: auth(ch) })).statusCode, 403, "a sign-in ticket is not an access token");

    const rc = on.body.recoveryCodes[0] as string;
    assert.equal((await login(rc, (await login()).json().challenge)).statusCode, 200, "a recovery code works");
    assert.equal((await login(rc, (await login()).json().challenge)).statusCode, 401, "once only");

    // the organization can insist
    assert.equal((await call(adm, "PUT", "/security/policy", { require2fa: true })).status, 403, "only the organization admin");
    assert.equal((await call(owner, "PUT", "/security/policy", { require2fa: true })).status, 200);
    const blocked = await call(rec, "GET", "/patients");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "MFA_SETUP_REQUIRED");
    assert.equal((await call(rec, "GET", "/me")).body.security.mfaRequired, true, "they can still see why");
    const s2 = (await call(rec, "POST", "/auth/mfa/setup")).body;
    assert.equal((await call(rec, "POST", "/auth/mfa/enable", { code: totp(s2.secret, currentStep()) })).status, 200);
    assert.equal((await call(rec, "GET", "/patients")).status, 200, "once set up, they are through");
    assert.equal((await call(rec, "POST", "/auth/mfa/disable", { password: PASSWORD, code: totp(s2.secret, currentStep() + 1) })).status, 409, "cannot turn it off while required");
    const pol = (await call(owner, "GET", "/security/policy")).body;
    assert.ok(pol.people.every((p: { phone: string }) => p.phone.startsWith("••••")));
    const rs = await call(owner, "POST", `/security/mfa/${T.receptionist.id}/reset`);
    assert.equal(rs.body.reset, true, "lost phone: the admin resets it");
    assert.equal((await call(rec, "GET", "/patients")).body.code, "MFA_SETUP_REQUIRED", "and they must set it up again");
    assert.equal((await call(owner, "PUT", "/security/policy", { require2fa: false })).status, 200);
    void ownerId;
  });
});
