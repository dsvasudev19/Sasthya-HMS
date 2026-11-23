import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addStaff, admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture;
let owner: string, ownerId: string, adminTok: string, rec: string, recId: string;

const call = async (token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : null };
};

before(async () => {
  app = await makeApp();
  T = await makeTenant("acv2");
  const ow = await addStaff(T, "OWNER", "Owner"); ownerId = ow.id;
  const ad = await addStaff(T, "ADMIN", "Admin");
  owner = await staffToken(app, ow.phone); adminTok = await staffToken(app, ad.phone);
  rec = await staffToken(app, T.receptionist.phone); recId = T.receptionist.id;
});
after(async () => { await cleanupTenant(T); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("personal grants and revokes", () => {
  it("lets the owner give reception a temporary permission, takes effect at once, and can be removed", async () => {
    assert.equal((await call(rec, "GET", "/pharmacy/dashboard")).status, 403);
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const g = await call(owner, "POST", `/team/${recId}/overrides`, { permission: "pharmacy:read", effect: "GRANT", reason: "Covering the pharmacy this week", expiresAt: soon });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal((await call(rec, "GET", "/medicines")).status, 200, "the grant applies without signing in again");
    const inspect = (await call(owner, "GET", `/team/${recId}/access`)).body;
    const p = inspect.permissions.find((x: { key: string }) => x.key === "pharmacy:read");
    assert.equal(p.allowed, true);
    assert.equal(p.viaGrant, true);
    assert.deepEqual(p.viaRoles, []);
    assert.equal(inspect.permissions.find((x: { key: string }) => x.key === "patients:write").viaRoles[0], "Reception", "the inspector says which role gives it");
    assert.equal((await call(owner, "DELETE", `/team/${recId}/overrides/${g.body.id}`)).status, 200);
    assert.equal((await call(rec, "GET", "/medicines")).status, 403, "gone once removed");
  });

  it("a revoke takes one permission away; an expired grant does nothing", async () => {
    assert.equal((await call(owner, "POST", `/team/${recId}/overrides`, { permission: "billing:write", effect: "REVOKE", reason: "No billing for now" })).status, 201);
    const pat = (await call(rec, "POST", "/patients", { fullName: "Revoke Pat", phone: newPhone() })).body;
    assert.equal((await call(rec, "POST", "/invoices", { patientId: pat.id, lines: [{ kind: "OTHER", description: "x", quantity: 1, unitPaise: 100 }] })).status, 403);
    assert.equal((await call(rec, "GET", "/invoices")).status, 200, "other billing permissions are untouched");
    await admin.userAccessOverride.create({ data: { tenantId: T.tenantId, identityId: recId, permission: "lab:write", effect: "GRANT", reason: "old cover", expiresAt: new Date(Date.now() - 1000), createdBy: ownerId } });
    const { clearAuthzCache } = await import("../src/authz");
    clearAuthzCache(T.tenantId);
    assert.equal((await call(rec, "GET", "/lab/orders")).status, 200, "reception reads lab by role");
    const inspect = (await call(owner, "GET", `/team/${recId}/access`)).body;
    assert.equal(inspect.permissions.find((x: { key: string }) => x.key === "lab:write").allowed, false, "an expired grant is ignored");
    assert.equal(inspect.overrides.find((o: { permission: string }) => o.permission === "lab:write").active, false);
  });

  it("protects the owner, yourself, and what you can hand out", async () => {
    assert.equal((await call(owner, "POST", `/team/${ownerId}/overrides`, { permission: "billing:refund", effect: "REVOKE", reason: "test" })).status, 409, "self");
    assert.equal((await call(adminTok, "POST", `/team/${ownerId}/overrides`, { permission: "billing:refund", effect: "REVOKE", reason: "attack" })).status, 403, "admin cannot manage access at all");
    const other = await addStaff(T, "OWNER", "Second owner");
    assert.equal((await call(owner, "POST", `/team/${other.id}/overrides`, { permission: "billing:refund", effect: "REVOKE", reason: "attack" })).status, 409, "an owner's access cannot be cut");
    assert.equal((await call(owner, "POST", `/team/${recId}/overrides`, { permission: "made:up", effect: "GRANT", reason: "nope" })).status, 400);
    assert.equal((await call(owner, "POST", `/team/${recId}/overrides`, { permission: "*", effect: "GRANT", reason: "everything" })).status, 400, "no blanket grant");
    assert.equal((await call(owner, "POST", `/team/${recId}/overrides`, { permission: "lab:write", effect: "GRANT", reason: "past", expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
  });
});

describe("policy v2", () => {
  it("matches ANY condition, skips excepted roles, and honours its date window", async () => {
    const make = (over: object) => call(owner, "POST", "/policies", {
      name: "Reception limits", permission: "billing:write", appliesToRoles: [], message: "Not allowed right now", match: "ANY",
      conditions: [{ attr: "discountPercent", op: "gt", value: 50 }, { attr: "hour", op: "lt", value: 25 }], ...over,
    });
    const p = await make({ exceptRoles: ["OWNER"] });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const sim = (roles: string[], at?: string) => call(owner, "POST", "/policies/simulate", { permission: "billing:write", roles, attrs: {}, at });
    assert.equal((await sim(["RECEPTIONIST"])).body.allowed, false, "the always-true hour condition fires under ANY");
    assert.equal((await sim(["OWNER"])).body.allowed, true, "owners are excepted");
    await call(owner, "PUT", `/policies/${p.body.id}`, { name: "Reception limits", permission: "billing:write", appliesToRoles: [], message: "Festival week freeze", match: "ANY", exceptRoles: [], conditions: [{ attr: "hour", op: "lt", value: 25 }], validFrom: "2030-01-01T00:00:00Z", validUntil: "2030-01-08T00:00:00Z" });
    assert.equal((await sim(["RECEPTIONIST"])).body.allowed, true, "outside its window it does nothing");
    assert.equal((await sim(["RECEPTIONIST"], "2030-01-03T10:00:00Z")).body.allowed, false, "inside the window it blocks");
    assert.equal((await call(owner, "POST", "/policies", { name: "Bad window", permission: "billing:write", conditions: [], message: "msg", validFrom: "2030-02-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z" })).status, 400);
    await call(owner, "DELETE", `/policies/${p.body.id}`);
  });
});

describe("audit trail", () => {
  it("records who changed access and lets only those with audit:read see it", async () => {
    await call(owner, "POST", "/roles", { key: "AUDITED", name: "Audited", permissions: ["patients:read"] });
    const rows = (await call(owner, "GET", "/audit?action=access.")).body.rows as { action: string; actorName: string }[];
    assert.ok(rows.some((r) => r.action === "access.role.create" && r.actorName === "Owner"));
    assert.ok(rows.some((r) => r.action === "access.override.create"));
    assert.ok(rows.some((r) => r.action === "access.policy.create"));
    assert.equal((await call(rec, "GET", "/audit")).status, 403);
    assert.equal((await call(adminTok, "GET", "/audit")).status, 200, "admins can read it by default");
  });

  it("allows updating staff profile details and returns workforce statistics", async () => {
    // 1. Update staff profile details
    const patchRes = await call(owner, "PATCH", `/team/${recId}`, {
      fullName: "Updated Receptionist Name",
      email: "updated.rec@hospital.com",
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.fullName, "Updated Receptionist Name");
    assert.equal(patchRes.body.email, "updated.rec@hospital.com");

    // 2. Fetch workforce stats
    const statsRes = await call(owner, "GET", "/team/stats");
    assert.equal(statsRes.status, 200);
    assert.ok(typeof statsRes.body.totalStaff === "number");
    assert.ok(statsRes.body.totalStaff >= 2);
    assert.ok(typeof statsRes.body.onDutyNow === "number");
    assert.ok(statsRes.body.byRole.RECEPTIONIST >= 1);
  });
});
