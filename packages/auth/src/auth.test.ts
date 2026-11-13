import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_PERMISSIONS, DEFAULT_ROLES, can, deniedBy, effectivePermissions, expandPermissions, type Policy } from "./index";

const policy = (over: Partial<Policy>): Policy => ({ id: "p", name: "p", enabled: true, permission: "*", appliesToRoles: [], conditions: [], message: "blocked", ...over });

describe("permissions", () => {
  it("wildcards: * grants everything, group:* a whole group", () => {
    assert.ok(can(["*"], "billing:refund"));
    assert.ok(can(["billing:*"], "billing:write") && !can(["billing:*"], "pharmacy:pos"));
    assert.ok(can(new Set(["patients:read"]), "patients:read") && !can(["patients:read"], "patients:write"));
  });
  it("default roles only use catalogued permissions and owner-only keys stay out of admin", () => {
    for (const r of DEFAULT_ROLES) for (const p of r.permissions) assert.ok(p === "*" || ALL_PERMISSIONS.includes(p), `${r.key}: ${p}`);
    const admin = DEFAULT_ROLES.find((r) => r.key === "ADMIN")!;
    assert.ok(!admin.permissions.includes("roles:manage") && !admin.permissions.includes("subscription:manage"));
    assert.ok(admin.permissions.includes("billing:refund"));
  });
});

describe("policies", () => {
  const refundCap = policy({ permission: "billing:refund", appliesToRoles: ["ADMIN"], conditions: [{ attr: "amountPaise", op: "gt", value: 200_000 }], message: "Refunds above Rs 2,000 need the owner" });
  it("fires only when the permission, the role and every condition match", () => {
    assert.equal(deniedBy([refundCap], { permission: "billing:refund", roles: ["ADMIN"], attrs: { amountPaise: 250_000 } })?.message, "Refunds above Rs 2,000 need the owner");
    assert.equal(deniedBy([refundCap], { permission: "billing:refund", roles: ["ADMIN"], attrs: { amountPaise: 100_000 } }), null);
    assert.equal(deniedBy([refundCap], { permission: "billing:refund", roles: ["OWNER"], attrs: { amountPaise: 250_000 } }), null, "does not apply to other roles");
    assert.equal(deniedBy([refundCap], { permission: "billing:write", roles: ["ADMIN"], attrs: { amountPaise: 250_000 } }), null);
  });
  it("a condition on an attribute the action does not supply is false", () => {
    assert.equal(deniedBy([refundCap], { permission: "billing:refund", roles: ["ADMIN"], attrs: {} }), null);
  });
  it("working-hours and role-list rules, prefix permissions, disabled rules", () => {
    const hours = policy({ permission: "billing:*", appliesToRoles: ["RECEPTIONIST"], conditions: [{ attr: "hour", op: "lt", value: 6 }], message: "Billing is closed overnight" });
    assert.ok(deniedBy([hours], { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { hour: 3 } }));
    assert.equal(deniedBy([hours], { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { hour: 9 } }), null);
    assert.equal(deniedBy([{ ...hours, enabled: false }], { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { hour: 3 } }), null);
    const notOwner = policy({ permission: "pharmacy:write", conditions: [{ attr: "roles", op: "notContainsAny", value: ["OWNER"] }, { attr: "quantity", op: "gte", value: 100 }], message: "Large write-offs need the owner" });
    assert.ok(deniedBy([notOwner], { permission: "pharmacy:write", roles: ["PHARMACIST"], attrs: { quantity: 150 } }));
    assert.equal(deniedBy([notOwner], { permission: "pharmacy:write", roles: ["PHARMACIST", "OWNER"], attrs: { quantity: 150 } }), null);
  });
  it("a rule with no conditions applies to everything it targets", () => {
    assert.ok(deniedBy([policy({ permission: "lab:release_override", conditions: [] })], { permission: "lab:release_override", roles: ["ADMIN"], attrs: {} }));
  });
});

describe("policy v2", () => {
  const ctx = { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { discountPercent: 20, hour: 22 } };
  it("ANY fires on one matching condition, ALL needs every one", () => {
    const conds = [{ attr: "discountPercent", op: "gt" as const, value: 10 }, { attr: "hour", op: "lt" as const, value: 6 }];
    assert.ok(deniedBy([policy({ match: "ANY", conditions: conds })], ctx));
    assert.equal(deniedBy([policy({ match: "ALL", conditions: conds })], ctx), null);
  });
  it("skips people in exceptRoles and runs only inside its window", () => {
    const p = policy({ exceptRoles: ["OWNER"], validFrom: new Date("2026-10-01"), validUntil: new Date("2026-11-01"), conditions: [{ attr: "discountPercent", op: "gt", value: 10 }] });
    assert.ok(deniedBy([p], { ...ctx, now: new Date("2026-10-15") }));
    assert.equal(deniedBy([p], { ...ctx, roles: ["OWNER"], now: new Date("2026-10-15") }), null);
    assert.equal(deniedBy([p], { ...ctx, now: new Date("2026-09-30") }), null, "not yet in force");
    assert.equal(deniedBy([p], { ...ctx, now: new Date("2026-11-01") }), null, "no longer in force");
  });
});

describe("per-person overrides", () => {
  const rec = DEFAULT_ROLES.find((r) => r.key === "RECEPTIONIST")!.permissions;
  const soon = new Date(Date.now() + 3600_000), past = new Date(Date.now() - 3600_000);
  it("a grant adds a permission until it expires", () => {
    assert.ok(!effectivePermissions(rec, []).has("billing:refund"));
    assert.ok(effectivePermissions(rec, [{ permission: "billing:refund", effect: "GRANT", expiresAt: soon }]).has("billing:refund"));
    assert.ok(!effectivePermissions(rec, [{ permission: "billing:refund", effect: "GRANT", expiresAt: past }]).has("billing:refund"));
  });
  it("a revoke removes one permission, even from a wildcard role, and beats a grant", () => {
    const owner = effectivePermissions(["*"], [{ permission: "billing:refund", effect: "REVOKE" }]);
    assert.ok(!owner.has("billing:refund") && owner.has("billing:write"));
    assert.ok(!effectivePermissions(rec, [{ permission: "billing:write", effect: "REVOKE" }, { permission: "billing:write", effect: "GRANT" }]).has("billing:write"));
    assert.ok(!effectivePermissions(rec, [{ permission: "billing:*", effect: "REVOKE" }]).has("billing:read"), "a group revoke removes the whole group");
  });
  it("expandPermissions turns wildcards into the concrete catalogue", () => {
    assert.equal(expandPermissions(["*"]).size, ALL_PERMISSIONS.length);
  });
});
