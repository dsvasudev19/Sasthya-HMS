import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hashPassword } from "@hms/auth";
import { buildApp } from "../src/app";
import { flushLogs } from "../src/syslog";
import { PASSWORD, addStaff, admin, appDb, auth, cleanupTenant, cleanupIdentities, makeApp, makeTenant, newPhone, provider, staffToken, testStore, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, op = "", opId = "", T: Fixture;
const opPhone = newPhone();
const made: Fixture[] = [];
const phones: string[] = [];

const call = async (token: string, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : null };
};
const keep = (tenantId: string, ownerId: string) => made.push({ tenantId, slug: "", receptionist: { id: ownerId, phone: "" }, doctor: { id: ownerId, phone: "" }, extra: [] });
const flag = (key: string, enabled: boolean, value?: object) => call(op, "PUT", `/platform/flags/${key}`, { enabled, ...(value ? { value } : {}) });

before(async () => {
  app = await makeApp();
  const id = await admin.identity.create({ data: { phone: opPhone, fullName: "Ops Person", passwordHash: await hashPassword(PASSWORD) } });
  opId = id.id;
  await admin.platformAdmin.create({ data: { identityId: id.id } });
  op = (await app.inject({ method: "POST", url: "/auth/platform/login", payload: { phone: opPhone, password: PASSWORD } })).json().token;
  T = await makeTenant("ops");
});
after(async () => {
  await flag("maintenance_mode", false); await flag("signup_open", true);
  for (const f of [...made, T]) await cleanupTenant(f).catch(() => undefined);
  await admin.announcement.deleteMany({ where: { createdBy: opId } });
  await admin.systemLog.deleteMany({ where: { source: { in: ["platform", "test"] } } });
  await admin.platformAudit.deleteMany({ where: { operatorId: opId } });
  await admin.platformAdmin.deleteMany({ where: { identityId: opId } });
  await admin.refreshToken.deleteMany({ where: { identityId: opId } });
  await admin.identity.delete({ where: { id: opId } }).catch(() => undefined);
  await cleanupIdentities(phones);
  await app.close(); await admin.$disconnect(); await appDb.$disconnect();
});

const org = (kind: string, name: string) => ({
  profile: { legalName: `${name} Pvt Ltd`, entityType: "PRIVATE_LIMITED", ...(kind === "PHARMACY" ? { drugLicenceNo: "KA-BNG-20-12345" } : { registrationNo: "KPME/2026/0042" }), gstin: "29ABCDE1234F1Z5", pan: "ABCDE1234F", addressLine1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", contactEmail: "office@example.in" },
  agreements: [{ kind: "MSA", version: "2026.1", signedByName: "Dr Rao", signedByTitle: "Director", signedByEmail: "rao@example.in", signedAt: "2026-10-10T10:00:00.000Z", effectiveFrom: "2026-10-15", termMonths: 12 }],
});

describe("onboarding a hospital or pharmacy", () => {
  it("creates the account, a one-time password and the defaults, and the owner can sign in and must change it", async () => {
    const ownerPhone = newPhone(); phones.push(ownerPhone);
    const r = await call(op, "POST", "/platform/tenants", { name: "Green Cross Pharmacy", kind: "PHARMACY", planCode: "STARTER", trialDays: 14, ...org("PHARMACY", "Green Cross Pharmacy"), owner: { name: "Ravi Kumar", phone: ownerPhone }, features: [{ feature: "tele", enabled: false }], limits: { maxSeats: 3 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    keep(r.body.tenant.id, "");
    assert.equal(r.body.tenant.kind, "PHARMACY");
    assert.ok(r.body.owner.temporaryPassword && !r.body.owner.existingAccount);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { phone: ownerPhone, password: r.body.owner.temporaryPassword } });
    assert.equal(login.statusCode, 200);
    const me = login.json();
    assert.equal(me.mustChangePassword, true);
    assert.ok(me.tenant.features.includes("pharmacy"), "a pharmacy always has its own module");
    assert.ok(!me.tenant.features.includes("tele"), "the feature switched off at onboarding is off");
    assert.equal(me.branches.length, 1, "a main branch exists");
    assert.ok(me.permissions.length > 20);
    keep(r.body.tenant.id, me.user.id);
    assert.equal((await call(op, "POST", "/platform/tenants", { name: "Bad", kind: "HOSPITAL", planCode: "STARTER", owner: { name: "X Y", phone: "12345" } })).status, 400);
    const noMsa = org("HOSPITAL", "No Msa"); noMsa.agreements = [{ ...noMsa.agreements[0]!, kind: "DPA" }];
    assert.equal((await call(op, "POST", "/platform/tenants", { name: "No Msa Hospital", kind: "HOSPITAL", planCode: "STARTER", ...noMsa, owner: { name: "Some One", phone: newPhone() } })).status, 400, "the master agreement is mandatory");
    const noLic = org("PHARMACY", "No Lic"); delete (noLic.profile as Record<string, unknown>)["drugLicenceNo"];
    assert.equal((await call(op, "POST", "/platform/tenants", { name: "No Licence Pharmacy", kind: "PHARMACY", planCode: "STARTER", ...noLic, owner: { name: "Some One", phone: newPhone() } })).status, 400, "a pharmacy needs its drug licence");
    assert.equal((await call(op, "POST", "/platform/tenants", { name: "Bad Gst Hospital", kind: "HOSPITAL", planCode: "STARTER", ...org("HOSPITAL", "Bad"), profile: { ...org("HOSPITAL", "Bad").profile, gstin: "NOTAGSTIN" }, owner: { name: "Some One", phone: newPhone() } })).status, 400);
    assert.equal((await call(me.token, "GET", "/platform/tenants")).status, 403, "hospital staff are not operators");
  });

  it("reuses an existing person's account without touching their password", async () => {
    const first = await call(op, "POST", "/platform/tenants", { name: "Chain One Hospital", kind: "HOSPITAL", planCode: "UNLIMITED", ...org("HOSPITAL", "Chain One Hospital"), owner: { name: "Chain Owner", phone: newPhone() } });
    const phone = (await admin.identity.findFirstOrThrow({ where: { memberships: { some: { tenantId: first.body.tenant.id } } } })).phone; phones.push(phone);
    const second = await call(op, "POST", "/platform/tenants", { name: "Chain Two Hospital", kind: "HOSPITAL", planCode: "STARTER", ...org("HOSPITAL", "Chain Two Hospital"), owner: { name: "Chain Owner", phone } });
    assert.equal(second.body.owner.existingAccount, true);
    assert.equal(second.body.owner.temporaryPassword, undefined);
    keep(first.body.tenant.id, ""); keep(second.body.tenant.id, "");
  });
});

describe("feature switches and limits", () => {
  it("switches one module off for one hospital, says so plainly, and puts it back; every change is audited", async () => {
    const owner = await staffToken(app, (await addStaff(T, "OWNER", "Owner")).phone);
    const p = (await call(owner, "POST", "/patients", { fullName: "Switch Patient", phone: newPhone() })).body;
    assert.equal((await call(owner, "GET", `/patients/${p.id}/documents`)).status, 200);
    assert.equal((await call(op, "PUT", `/platform/tenants/${T.tenantId}/features`, { changes: [{ feature: "documents", enabled: false }] })).status, 400, "a reason is required");
    assert.equal((await call(op, "PUT", `/platform/tenants/${T.tenantId}/features`, { changes: [{ feature: "documents", enabled: false }], reason: "Not on their contract" })).status, 200);
    const blocked = await call(owner, "GET", `/patients/${p.id}/documents`);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "DISABLED");
    const view = (await call(op, "GET", `/platform/tenants/${T.tenantId}/features`)).body;
    const doc = view.features.find((f: { key: string }) => f.key === "documents");
    assert.deepEqual([doc.plan, doc.override, doc.effective, doc.reason], [true, false, false, "Not on their contract"]);
    assert.ok((await call(owner, "GET", "/me")).body.tenant.features.every((f: string) => f !== "documents"), "the app hides it");
    assert.equal((await call(op, "PUT", `/platform/tenants/${T.tenantId}/features`, { changes: [{ feature: "documents", enabled: null }], reason: "Contract updated" })).status, 200);
    assert.equal((await call(owner, "GET", `/patients/${p.id}/documents`)).status, 200, "back to what the plan gives");
    const audit = (await call(op, "GET", `/platform/audit?tenantId=${T.tenantId}`)).body.rows as { action: string; operatorName: string; meta: { changes: { to: boolean | null }[] } }[];
    assert.equal(audit.filter((a) => a.action === "tenant.features").length, 2);
    assert.equal(audit[0]!.operatorName, "Ops Person");
  });

  it("can turn a module ON that the plan does not include, and enforces seat and branch ceilings", async () => {
    const t = (await call(op, "POST", "/platform/tenants", { name: "Small Plan Clinic", kind: "CLINIC", planCode: "PAY_PER_PATIENT", status: "ACTIVE", ...org("CLINIC", "Small Plan Clinic"), owner: { name: "Small Owner", phone: newPhone() } })).body;
    const row = await admin.identity.findFirstOrThrow({ where: { memberships: { some: { tenantId: t.tenant.id } } } }); phones.push(row.phone);
    keep(t.tenant.id, row.id);
    const tok = (await app.inject({ method: "POST", url: "/auth/login", payload: { phone: row.phone, password: t.owner.temporaryPassword } })).json().token as string;
    assert.equal((await call(tok, "GET", "/medicines")).status, 402, "pay-per-patient has no pharmacy");
    await call(op, "PUT", `/platform/tenants/${t.tenant.id}/features`, { changes: [{ feature: "pharmacy", enabled: true }], reason: "Pilot" });
    assert.equal((await call(tok, "GET", "/medicines")).status, 200);
    await call(op, "PUT", `/platform/tenants/${t.tenant.id}/limits`, { maxSeats: 2, maxBranches: 1 });
    assert.equal((await call(tok, "POST", "/team", { fullName: "Second Person", phone: newPhone(), roles: ["RECEPTIONIST"] })).status, 201);
    assert.equal((await call(tok, "POST", "/team", { fullName: "Third Person", phone: newPhone(), roles: ["RECEPTIONIST"] })).status, 402, "the ceiling is two");
    await call(op, "PUT", `/platform/tenants/${t.tenant.id}/limits`, { maxSeats: 5, maxBranches: 3 });
    assert.equal((await call(tok, "POST", "/team", { fullName: "Third Person", phone: newPhone(), roles: ["RECEPTIONIST"] })).status, 201);
    await call(op, "PUT", `/platform/tenants/${t.tenant.id}/features`, { changes: [{ feature: "multi_branch", enabled: true }], reason: "Second branch" });
    assert.equal((await call(tok, "POST", "/branches", { code: "EAST", name: "East" })).status, 201);
  });
});

describe("people and activity", () => {
  it("lists a hospital's staff, resets a password (old one stops working) and signs someone out everywhere", async () => {
    const staffer = await addStaff(T, "NURSE", "Nurse Joy");
    const tok = await staffToken(app, staffer.phone);
    const users = (await call(op, "GET", `/platform/tenants/${T.tenantId}/users`)).body as { identityId: string; name: string; activeSessions: number }[];
    const row = users.find((u) => u.identityId === staffer.id)!;
    assert.equal(row.name, "Nurse Joy");
    assert.ok(row.activeSessions >= 1);
    assert.equal((await call(op, "POST", `/platform/tenants/${T.tenantId}/users/${staffer.id}/sign-out`)).status, 200);
    assert.equal((await call(op, "POST", `/platform/tenants/${T.tenantId}/users/${T.receptionist.id}/reset-password`)).status, 200);
    const rec = await app.inject({ method: "POST", url: "/auth/login", payload: { phone: T.receptionist.phone, password: PASSWORD } });
    assert.equal(rec.statusCode, 401, "the old password no longer works");
    assert.equal((await call(op, "POST", `/platform/tenants/${T.tenantId}/users/${opId}/reset-password`)).status, 404, "only that hospital's staff");
    void tok;
    const found = (await call(op, "GET", `/platform/people?q=${staffer.phone.slice(-6)}`)).body;
    assert.equal(found[0].hospitals[0].id, T.tenantId);
  });

  it("shows a hospital's own audit trail to the operator", async () => {
    const owner = await staffToken(app, (await addStaff(T, "ADMIN", "Dr Trail")).phone);
    const p = (await call(owner, "POST", "/patients", { fullName: "Trail Patient", phone: newPhone() })).body;
    await call(owner, "PUT", `/patients/${p.id}/clinical-profile`, { allergies: ["Dust"] });
    const act = (await call(op, "GET", `/platform/tenants/${T.tenantId}/activity?action=clinical_profile`)).body;
    assert.ok(act.rows.some((r: { action: string; actorName: string }) => r.action === "clinical_profile.update" && r.actorName === "Dr Trail"));
  });
});

describe("platform switches, banners and health", () => {
  it("maintenance mode makes every hospital read-only but lets them sign in, and signing up can be paused", async () => {
    const owner = await staffToken(app, (await addStaff(T, "ADMIN", "Admin M")).phone);
    assert.equal((await flag("maintenance_mode", true, { message: "Upgrading the database tonight." })).status, 200);
    const w = await call(owner, "POST", "/patients", { fullName: "Blocked Write", phone: newPhone() });
    assert.equal(w.status, 503);
    assert.equal(w.body.code, "MAINTENANCE");
    assert.equal(w.body.error, "Upgrading the database tonight.");
    assert.equal((await call(owner, "GET", "/patients")).status, 200, "reading still works");
    assert.equal((await app.inject({ method: "POST", url: "/auth/login", payload: { phone: T.doctor.phone, password: PASSWORD } })).statusCode, 200, "sign-in still works");
    assert.equal((await call(owner, "GET", "/announcements/active")).body.maintenance, "Upgrading the database tonight.");
    await flag("maintenance_mode", false);
    assert.equal((await call(owner, "POST", "/patients", { fullName: "Allowed Again", phone: newPhone() })).status, 201);

    await flag("signup_open", false);
    assert.equal((await app.inject({ method: "POST", url: "/signup", payload: { hospitalName: "Paused Hosp", kind: "HOSPITAL", ownerName: "Pa Used", phone: "9000000077", code: "123456", password: "Secret123", planCode: "STARTER" } })).statusCode, 403);
    await flag("signup_open", true);
    assert.equal((await flag("log_retention_days", true, { days: 0 })).status, 400);
  });

  it("shows banners to everyone or to chosen hospitals, only inside their time window", async () => {
    const owner = await staffToken(app, (await addStaff(T, "ADMIN", "Admin B")).phone);
    const O = await makeTenant("ops2"); made.push(O);
    const other = await staffToken(app, O.receptionist.phone);
    await call(op, "POST", "/platform/announcements", { title: "Everyone", body: "Downtime on Sunday", severity: "WARNING" });
    await call(op, "POST", "/platform/announcements", { title: "Only Ops One", body: "Your invoice is ready", allTenants: false, tenantIds: [T.tenantId] });
    await call(op, "POST", "/platform/announcements", { title: "Ended", body: "Old news here", endsAt: new Date(Date.now() - 1000).toISOString() });
    const mine = (await call(owner, "GET", "/announcements/active")).body.announcements.map((a: { title: string }) => a.title);
    const theirs = (await call(other, "GET", "/announcements/active")).body.announcements.map((a: { title: string }) => a.title);
    assert.ok(mine.includes("Everyone") && mine.includes("Only Ops One") && !mine.includes("Ended"));
    assert.ok(theirs.includes("Everyone") && !theirs.includes("Only Ops One"));
    assert.equal((await call(op, "POST", "/platform/announcements", { title: "Nobody", body: "No audience given", allTenants: false })).status, 400);
  });

  it("reports health and keeps the operator audit trail append-only", async () => {
    const h = (await call(op, "GET", "/platform/health")).body;
    assert.equal(h.database.ok, true);
    assert.ok(h.messages.queued >= 0 && typeof h.errors.lastHour === "number");
    const row = await admin.platformAudit.findFirstOrThrow({ where: { operatorId: opId } });
    await assert.rejects(() => appDb.$executeRawUnsafe(`UPDATE platform.platform_audit SET action = 'x' WHERE id = '${row.id}'`), "the app role cannot rewrite the audit trail");
    await assert.rejects(() => appDb.$executeRawUnsafe(`DELETE FROM platform.platform_audit WHERE id = '${row.id}'`));
  });
});

describe("system log", () => {
  it("records refused sign-ins and rate limits, filters and summarises them, and purges what is old", async () => {
    const logging = await buildApp(appDb, { jwtSecret: "test-secret-test-secret-test-secret-1234", provider, store: testStore, logger: false });
    for (let i = 0; i < 15; i++) await logging.inject({ method: "POST", url: "/auth/login", payload: { phone: "9000012345", password: "nope-nope-1" } });
    await flushLogs();
    await logging.close();
    const sec = (await call(op, "GET", "/platform/logs?level=SECURITY")).body.rows as { source: string; message: string; meta: { phoneEnding?: string } | null }[];
    assert.ok(sec.some((r) => r.message === "Failed staff sign-in" && r.meta?.phoneEnding === "2345"), "the failed attempt is there, with only the last four digits");
    assert.ok(sec.some((r) => r.source === "rate-limit"), "and the rate limit kicking in");
    assert.ok(!JSON.stringify(sec).includes("nope-nope"), "passwords are never stored");
    const stats = (await call(op, "GET", "/platform/logs/stats?hours=1")).body;
    assert.ok(stats.totals.SECURITY >= 2);
    assert.ok(stats.series.length >= 1);
    const filtered = (await call(op, "GET", "/platform/logs?source=rate-limit&limit=1")).body;
    assert.equal(filtered.rows.length, 1);

    await admin.systemLog.create({ data: { level: "INFO", source: "test", message: "ancient", createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    const purged = (await call(op, "DELETE", "/platform/logs")).body.removed;
    assert.ok(purged >= 1);
    assert.equal((await call(op, "GET", "/platform/logs?q=ancient")).body.rows.length, 0);
  });
});

describe("analytics per organization", () => {
  it("shows one organization's own usage, and a fleet view across all of them", async () => {
    const one = (await call(op, "GET", `/platform/tenants/${T.tenantId}/analytics?days=7`)).body;
    assert.equal(one.series.visits.length, 7, "one point per day");
    assert.equal(typeof one.totals.patients, "number");
    assert.ok(one.staff.accounts >= 1);
    assert.equal((await call(op, "GET", `/platform/tenants/${T.tenantId}/analytics?days=0`)).status, 400);
    assert.equal((await call(op, "GET", "/platform/tenants/00000000-0000-7000-8000-000000000000/analytics")).status, 404);
    const fleet = (await call(op, "GET", "/platform/analytics?days=30")).body;
    const row = fleet.rows.find((r: { id: string }) => r.id === T.tenantId);
    assert.ok(row && ["ACTIVE", "LOW", "DORMANT", "INACTIVE"].includes(row.engagement));
    assert.equal(fleet.signupsByWeek.length, 12);
    assert.equal((await call((await staffToken(app, T.doctor.phone)), "GET", `/platform/tenants/${T.tenantId}/analytics`)).status, 403, "hospital staff cannot read it");
  });
});
