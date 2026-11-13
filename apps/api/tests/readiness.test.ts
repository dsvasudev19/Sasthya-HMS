import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app";
import { addStaff, admin, appDb, auth, cleanupTenant, makeApp, makeTenant, provider, staffToken, testStore, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, owner: string, rec: string;
const call = async (a: App, token: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
  const res = await a.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};

before(async () => {
  app = await makeApp();
  T = await makeTenant("ready");
  owner = await staffToken(app, (await addStaff(T, "OWNER", "Owner")).phone);
  rec = await staffToken(app, T.receptionist.phone);
});
after(async () => { await cleanupTenant(T); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("go-live checklist", () => {
  it("reports what is still to do from the hospital's own data, and ticks things off as they happen", async () => {
    const s = (await call(app, owner, "GET", "/setup/status")).body;
    const done = (k: string) => s.steps.find((x: { key: string }) => x.key === k).done;
    assert.equal(done("profile"), false);
    assert.equal(done("patients"), false);
    assert.equal(s.ready, false);
    await call(app, owner, "PUT", "/settings/profile", { legalName: "Ready Hospital", address: "1 Road", phone: "9000011111" });
    await call(app, rec, "POST", "/patients", { fullName: "First Patient", phone: "9811122233" });
    const after = (await call(app, owner, "GET", "/setup/status")).body;
    assert.equal(after.steps.find((x: { key: string }) => x.key === "profile").done, true);
    assert.equal(after.steps.find((x: { key: string }) => x.key === "patients").done, true);
    assert.ok(after.percent > s.percent);
    assert.equal(after.steps.find((x: { key: string }) => x.key === "messages").optional, true, "messaging is flagged but does not block going live");
  });

  it("imports a patient register, skipping duplicates and bad rows, and dry runs change nothing", async () => {
    const rows = [
      { fullName: "Imported One", phone: "9822200001", gender: "FEMALE", dateOfBirth: "1980-02-03" },
      { fullName: "Imported Two", phone: "9822200002" },
      { fullName: "Imported One", phone: "9822200001" },
      { fullName: "First Patient", phone: "9811122233" },
      { fullName: "X", phone: "123" },
    ];
    const dry = (await call(app, owner, "POST", "/patients/import", { rows, dryRun: true })).body;
    assert.deepEqual([dry.created, dry.duplicates, dry.errors.length], [2, 2, 1]);
    assert.equal((await call(app, owner, "GET", "/patients?q=Imported")).body.length, 0);
    const real = (await call(app, owner, "POST", "/patients/import", { rows })).body;
    assert.equal(real.created, 2);
    const found = (await call(app, owner, "GET", "/patients?q=Imported")).body as { patientNo: string }[];
    assert.equal(found.length, 2);
    assert.ok(found.every((p) => /^.{3}-\d{6}$/.test(p.patientNo)), "imported patients get proper numbers");
    assert.equal((await call(app, owner, "POST", "/patients/import", { rows })).body.created, 0, "running it again adds nobody");
  });
});

describe("rate limiting", () => {
  it("slows down password guessing on sign-in", async () => {
    const strict = await buildApp(appDb, { jwtSecret: "test-secret-test-secret-test-secret-1234", provider, store: testStore, logger: false });
    let blocked = 0;
    for (let i = 0; i < 16; i++) {
      const r = await strict.inject({ method: "POST", url: "/auth/login", payload: { phone: "9000000099", password: "wrong-password-1" } });
      if (r.statusCode === 429) blocked++;
    }
    assert.ok(blocked >= 3, `expected some attempts to be refused, got ${blocked}`);
    await strict.close();
  });
});
