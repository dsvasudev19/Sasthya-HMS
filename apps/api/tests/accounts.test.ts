import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hashPassword } from "@hms/auth";
import { generateInvoices, enforceBilling } from "@hms/db/platform-billing";
import { monthOf } from "@hms/billing-core";
import { addStaff, admin, appDb, auth, cleanupTenant, cleanupIdentities, makeApp, makeTenant, newPhone, PASSWORD, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App;
const created: Fixture[] = [];
const phones: string[] = [];
const platformPhone = newPhone();
let platformId = "";

const call = async (token: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const setTenant = (id: string, data: Record<string, unknown>) => admin.tenant.update({ where: { id }, data });
const otp = async (phone: string) => (await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone } })).json().devCode as string;

async function signup(name: string, kind: "HOSPITAL" | "CLINIC" = "HOSPITAL", planCode = "PAY_PER_PATIENT") {
  const phone = newPhone();
  phones.push(phone);
  const res = await app.inject({ method: "POST", url: "/signup", payload: { hospitalName: name, kind, ownerName: "Owner Person", phone, code: await otp(phone), password: "Secret123", planCode } });
  if (res.statusCode === 201) {
    const b = res.json();
    created.push({ tenantId: b.tenant.id, slug: "", receptionist: { phone, id: b.user.id }, doctor: { phone, id: b.user.id }, extra: [] });
  }
  return { res, phone, body: res.json() };
}

before(async () => {
  app = await makeApp();
  const id = await admin.identity.create({ data: { phone: platformPhone, fullName: "Platform Admin", passwordHash: await hashPassword(PASSWORD) } });
  platformId = id.id;
  await admin.platformAdmin.create({ data: { identityId: id.id } });
});
after(async () => {
  for (const f of created) await cleanupTenant(f).catch(() => undefined);
  await admin.platformAdmin.deleteMany({ where: { identityId: platformId } });
  await admin.refreshToken.deleteMany({ where: { identityId: platformId } });
  await admin.identity.delete({ where: { id: platformId } }).catch(() => undefined);
  await cleanupIdentities(phones);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("signup and trial", () => {
  it("creates a trial hospital with defaults; a clinic owner is also the doctor; the trial unlocks every feature", async () => {
    const { res, body } = await signup("Trial Hospital", "CLINIC", "PAY_PER_PATIENT");
    assert.equal(res.statusCode, 201);
    assert.equal(body.tenant.status, "TRIAL");
    assert.deepEqual([...body.user.roles].sort(), ["DOCTOR", "OWNER"]);
    const t = await call(body.token, "GET", "/card-plans");
    assert.equal(t.body.length, 2, "default health card plans are created");
    assert.equal((await call(body.token, "GET", "/medicines")).status, 200, "pay-per-patient plan, but the trial unlocks the pharmacy");
    const sub = (await call(body.token, "GET", "/subscription")).body;
    assert.equal(sub.status, "TRIAL");
    assert.ok(sub.trialDaysLeft >= 29);
    assert.equal(sub.effectivePlan, "UNLIMITED");
  });

  it("rejects a wrong code and a reused phone with a different password", async () => {
    const phone = newPhone();
    phones.push(phone);
    await otp(phone);
    const bad = await app.inject({ method: "POST", url: "/signup", payload: { hospitalName: "Bad Code", kind: "HOSPITAL", ownerName: "X Y", phone, code: "000000", password: "Secret123" } });
    assert.equal(bad.statusCode, 401);
    const first = await signup("First Hospital");
    const second = await app.inject({ method: "POST", url: "/signup", payload: { hospitalName: "Second Hospital", kind: "HOSPITAL", ownerName: "Owner Person", phone: first.phone, code: await otp(first.phone), password: "Different999" } });
    assert.equal(second.statusCode, 409);
  });

  it("after the trial a pay-per-patient hospital loses the pharmacy and becomes read-only until it picks up", async () => {
    const { body } = await signup("Expiring Hospital");
    await setTenant(body.tenant.id, { trialEndsAt: new Date(Date.now() - 1000) });
    const { clearTenantCache } = await import("../src/gates");
    clearTenantCache();
    assert.equal((await call(body.token, "GET", "/patients")).status, 200, "reading still works");
    const write = await call(body.token, "POST", "/patients", { fullName: "Blocked Person" });
    assert.equal(write.status, 402);
    assert.equal(write.body.code, "READ_ONLY");
    assert.equal((await call(body.token, "GET", "/subscription")).status, 200, "the subscription page stays open so they can pay");
    const r = await enforceBilling(appDb, new Date(), [body.tenant.id]);
    assert.ok(r.trialsEnded >= 1, "the worker moves the trial to active billing");
    clearTenantCache();
    assert.equal((await call(body.token, "POST", "/patients", { fullName: "Allowed Again" })).status, 201);
    assert.equal((await call(body.token, "GET", "/medicines")).status, 402, "but pay-per-patient has no pharmacy");
  });
});

describe("plans and seats", () => {
  it("gates pharmacy, lab and messaging by plan, and enforces the seat limit", async () => {
    const T = await makeTenant("ppp");
    created.push(T);
    await setTenant(T.tenantId, { planCode: "PAY_PER_PATIENT" });
    const { clearTenantCache } = await import("../src/gates");
    clearTenantCache();
    const w = await addStaff(T, "OWNER", "Owner");
    const owner = await staffToken(app, w.phone);
    for (const url of ["/medicines", "/lab/tests", "/messages"]) {
      const r = await call(owner, "GET", url);
      assert.equal(r.status, 402, `${url} needs a higher plan`);
      assert.equal(r.body.code, "UPGRADE");
    }
    assert.equal((await call(owner, "GET", "/card-plans")).status, 200, "health cards are on every plan");

    // seats: receptionist + doctor + owner already = 3 = the limit
    const full = await call(owner, "POST", "/team", { phone: newPhone(), fullName: "Fourth Person", roles: ["NURSE"] });
    assert.equal(full.status, 402);
    assert.equal(full.body.feature, "seats");
    await setTenant(T.tenantId, { planCode: "STARTER" });
    clearTenantCache();
    assert.equal((await call(owner, "POST", "/team", { phone: newPhone(), fullName: "Fourth Person", roles: ["NURSE"] })).status, 201);
    assert.equal((await call(owner, "GET", "/medicines")).status, 200);
    const down = await call(owner, "POST", "/subscription/plan", { planCode: "PAY_PER_PATIENT" });
    assert.equal(down.status, 409, "cannot downgrade below the number of staff");
  });
});

describe("team and passwords", () => {
  it("adds staff with a temporary password that must be changed, and protects owners", async () => {
    const { body, phone } = await signup("Team Hospital", "HOSPITAL", "STARTER");
    const owner = body.token as string;
    const addPhone = newPhone();
    phones.push(addPhone);
    const add = await call(owner, "POST", "/team", { phone: addPhone, fullName: "New Nurse", roles: ["NURSE"] });
    assert.equal(add.status, 201);
    const temp = add.body.temporaryPassword as string;
    assert.ok(temp && temp.length >= 12);

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { phone: addPhone, password: temp } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().mustChangePassword, true);
    const weak = await app.inject({ method: "POST", url: "/auth/change-password", headers: auth(login.json().token), payload: { currentPassword: temp, newPassword: "short" } });
    assert.equal(weak.statusCode, 400);
    const changed = await app.inject({ method: "POST", url: "/auth/change-password", headers: auth(login.json().token), payload: { currentPassword: temp, newPassword: "NewSecret42" } });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().mustChangePassword, false);
    assert.equal((await app.inject({ method: "POST", url: "/auth/login", payload: { phone: addPhone, password: temp } })).statusCode, 401, "the temporary password no longer works");

    // owner protections
    const ownerId = body.user.id as string;
    assert.equal((await call(owner, "DELETE", `/team/${ownerId}`)).status, 409, "cannot remove yourself");
    const adminPhone = newPhone();
    phones.push(adminPhone);
    const adminAdd = await call(owner, "POST", "/team", { phone: adminPhone, fullName: "Admin Person", roles: ["ADMIN"] });
    const adminTok = (await app.inject({ method: "POST", url: "/auth/login", payload: { phone: adminPhone, password: adminAdd.body.temporaryPassword } })).json().token as string;
    assert.equal((await call(adminTok, "POST", "/team", { phone: newPhone(), fullName: "Another Owner", roles: ["OWNER"] })).status, 403, "admins cannot create owners");
    assert.equal((await call(adminTok, "DELETE", `/team/${ownerId}`)).status, 403, "admins cannot remove owners");
    assert.equal((await call(adminTok, "GET", "/team")).status, 200);
    void phone;

    // removing staff ends their sessions
    const nurse = add.body.identityId as string;
    const nurseLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { phone: addPhone, password: "NewSecret42", client: "mobile" } });
    const refreshTok = nurseLogin.json().refreshToken as string;
    assert.equal((await call(owner, "DELETE", `/team/${nurse}`)).status, 200);
    assert.equal((await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: refreshTok } })).statusCode, 401);
  });
});

describe("sessions", () => {
  it("rotates refresh tokens, requires the CSRF header for cookies, and revokes the family on reuse", async () => {
    const { phone } = await signup("Session Hospital", "HOSPITAL", "STARTER");
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { phone, password: "Secret123" } });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.find((c) => c.name === "hms_rt")!;
    assert.ok(cookie.httpOnly && cookie.sameSite === "Strict", "refresh token is an httpOnly SameSite=Strict cookie");
    assert.equal(login.json().refreshToken, undefined, "the browser never sees the refresh token in JSON");
    const jar = (c: string) => ({ cookie: `hms_rt=${c}` });

    assert.equal((await app.inject({ method: "POST", url: "/auth/refresh", headers: jar(cookie.value) })).statusCode, 401, "no CSRF header: refused");
    const r1 = await app.inject({ method: "POST", url: "/auth/refresh", headers: { ...jar(cookie.value), "x-requested-with": "hms" } });
    assert.equal(r1.statusCode, 200);
    const next = r1.cookies.find((c) => c.name === "hms_rt")!;
    assert.notEqual(next.value, cookie.value, "the token rotates");

    // replaying the old token is theft: everything in the family dies
    const replay = await app.inject({ method: "POST", url: "/auth/refresh", headers: { ...jar(cookie.value), "x-requested-with": "hms" } });
    assert.equal(replay.statusCode, 401);
    const after = await app.inject({ method: "POST", url: "/auth/refresh", headers: { ...jar(next.value), "x-requested-with": "hms" } });
    assert.equal(after.statusCode, 401, "the legitimate new token was revoked too");

    const out = await app.inject({ method: "POST", url: "/auth/login", payload: { phone, password: "Secret123" } });
    const c2 = out.cookies.find((c) => c.name === "hms_rt")!;
    await app.inject({ method: "POST", url: "/auth/logout", headers: { ...jar(c2.value), "x-requested-with": "hms" } });
    assert.equal((await app.inject({ method: "POST", url: "/auth/refresh", headers: { ...jar(c2.value), "x-requested-with": "hms" } })).statusCode, 401, "logout ends the session");
  });

  it("access tokens are short-lived and a person in two hospitals chooses one", async () => {
    const { phone, body } = await signup("Two Hospitals A");
    const decoded = JSON.parse(Buffer.from((body.token as string).split(".")[1]!, "base64url").toString());
    assert.ok(decoded.exp - decoded.iat <= 15 * 60, "15 minute access token");
    const second = await app.inject({ method: "POST", url: "/signup", payload: { hospitalName: "Two Hospitals B", kind: "HOSPITAL", ownerName: "Owner Person", phone, code: await otp(phone), password: "Secret123" } });
    assert.equal(second.statusCode, 201);
    created.push({ tenantId: second.json().tenant.id, slug: "", receptionist: { phone, id: body.user.id }, doctor: { phone, id: body.user.id }, extra: [] });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { phone, password: "Secret123" } });
    assert.equal(login.statusCode, 300);
    assert.equal(login.json().choose.length, 2);
    const pick = await app.inject({ method: "POST", url: "/auth/login", payload: { phone, password: "Secret123", tenantId: login.json().choose[0].tenantId } });
    assert.equal(pick.statusCode, 200);
  });
});

describe("platform admin and SaaS billing", () => {
  let platform = "";
  before(async () => {
    const r = await app.inject({ method: "POST", url: "/auth/platform/login", payload: { phone: platformPhone, password: PASSWORD } });
    assert.equal(r.statusCode, 200);
    platform = r.json().token;
  });

  it("only platform operators can use platform routes", async () => {
    assert.equal((await call(platform, "GET", "/platform/overview")).status, 200);
    const T = await makeTenant("plat");
    created.push(T);
    const hospital = await staffToken(app, T.receptionist.phone);
    assert.equal((await call(hospital, "GET", "/platform/tenants")).status, 403);
    assert.equal((await app.inject({ method: "GET", url: "/platform/tenants" })).statusCode, 401);
    const asPlatform = await app.inject({ method: "POST", url: "/auth/platform/login", payload: { phone: T.receptionist.phone, password: PASSWORD } });
    assert.equal(asPlatform.statusCode, 401, "a hospital user cannot sign in as an operator");
  });

  it("bills pay-per-patient hospitals Rs 200 per new patient plus 18% GST, once per month", async () => {
    const T = await makeTenant("inv");
    created.push(T);
    await setTenant(T.tenantId, { planCode: "PAY_PER_PATIENT", trialEndsAt: null });
    const tok = await staffToken(app, T.receptionist.phone);
    for (let i = 0; i < 3; i++) await call(tok, "POST", "/patients", { fullName: `Billed Patient ${i}`, phone: newPhone() });
    const label = monthOf(new Date()).label;
    const first = await call(platform, "POST", "/platform/invoices/generate", { month: label, tenantIds: [T.tenantId] });
    assert.equal(first.body.created, 1);
    const second = await call(platform, "POST", "/platform/invoices/generate", { month: label, tenantIds: [T.tenantId] });
    assert.equal(second.body.created, 0, "running again creates no duplicate");
    const inv = (await call(platform, "GET", "/platform/invoices?status=DUE")).body.find((i: { tenant: { id: string } }) => i.tenant.id === T.tenantId);
    assert.equal(inv.subtotalPaise, 3 * 20_000);
    assert.equal(inv.gstPaise, 10_800);
    assert.equal(inv.totalPaise, 70_800);
    const mine = (await call(tok2(T), "GET", "/subscription")).body;
    void mine;
  });

  it("suspends a hospital with an overdue invoice (read-only) and reactivates it when paid", async () => {
    const T = await makeTenant("dun");
    created.push(T);
    await setTenant(T.tenantId, { planCode: "STARTER", trialEndsAt: null });
    const tok = await staffToken(app, T.receptionist.phone);
    const { clearTenantCache } = await import("../src/gates");
    const start = new Date(Date.UTC(2026, 0, 1));
    const inv = await admin.platformInvoice.create({
      data: { tenantId: T.tenantId, invoiceNo: `SWA-TEST-${T.tenantId.slice(-6)}`, periodStart: start, periodEnd: new Date(Date.UTC(2026, 0, 31)), planCode: "STARTER", lines: [], subtotalPaise: 1_000_000, gstPaise: 180_000, totalPaise: 1_180_000, dueDate: new Date(Date.now() - 20 * 86_400_000) },
    });
    const r = await call(platform, "POST", "/platform/enforce", { tenantIds: [T.tenantId] });
    assert.equal(r.body.suspended, 1);
    clearTenantCache();
    const blocked = await call(tok, "POST", "/patients", { fullName: "Suspended Write" });
    assert.equal(blocked.status, 402);
    assert.match(blocked.body.error, /overdue/);
    assert.equal((await call(tok, "GET", "/patients")).status, 200, "data stays readable");

    const pay = await call(platform, "POST", `/platform/invoices/${inv.id}/pay`, { paymentRef: "UPI-REF-12345" });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.reactivated, 1);
    clearTenantCache();
    assert.equal((await call(tok, "POST", "/patients", { fullName: "Back In Business" })).status, 201);
    assert.equal((await call(platform, "POST", `/platform/invoices/${inv.id}/pay`, { paymentRef: "AGAIN-1" })).status, 409, "an invoice is paid once");
  });

  it("operators can change a plan, extend a trial and see usage", async () => {
    const T = await makeTenant("ops");
    created.push(T);
    const t = (await call(platform, "PATCH", `/platform/tenants/${T.tenantId}`, { planCode: "UNLIMITED", extendTrialDays: 14 })).body;
    assert.equal(t.planCode, "UNLIMITED");
    assert.equal(t.status, "TRIAL");
    assert.ok(new Date(t.trialEndsAt).getTime() > Date.now() + 13 * 86_400_000);
    const list = (await call(platform, "GET", "/platform/tenants?q=Test")).body as { id: string; staff: number }[];
    assert.ok(list.find((x) => x.id === T.tenantId)!.staff >= 2);
    const detail = (await call(platform, "GET", `/platform/tenants/${T.tenantId}`)).body;
    assert.equal(detail.usage.patientsAdded, 0);
  });
});

function tok2(_: Fixture) { return ""; }
void generateInvoices;

describe("operator sessions", () => {
  it("keeps the operator cookie separate from hospital sessions", async () => {
    const login = await app.inject({ method: "POST", url: "/auth/platform/login", payload: { phone: platformPhone, password: PASSWORD } });
    const pt = login.cookies.find((c) => c.name === "hms_pt")!;
    assert.ok(pt?.httpOnly && !login.cookies.some((c) => c.name === "hms_rt"));
    const wrong = await app.inject({ method: "POST", url: "/auth/refresh", headers: { cookie: `hms_rt=${pt.value}`, "x-requested-with": "hms" } });
    assert.equal(wrong.statusCode, 401, "an operator token cannot open a hospital session");
    const ok = await app.inject({ method: "POST", url: "/auth/platform/refresh", headers: { cookie: `hms_pt=${pt.value}`, "x-requested-with": "hms" } });
    assert.equal(ok.statusCode, 200);
  });
});
