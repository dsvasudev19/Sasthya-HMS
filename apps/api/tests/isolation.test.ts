import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, A: Fixture, B: Fixture, tokA: string, tokB: string;
let patientA: { id: string }, patientB: { id: string };

before(async () => {
  app = await makeApp();
  A = await makeTenant("a");
  B = await makeTenant("b");
  tokA = await staffToken(app, A.receptionist.phone);
  tokB = await staffToken(app, B.receptionist.phone);
  patientA = (await app.inject({ method: "POST", url: "/patients", headers: auth(tokA), payload: { fullName: "Patient Of A", phone: newPhone() } })).json();
  patientB = (await app.inject({ method: "POST", url: "/patients", headers: auth(tokB), payload: { fullName: "Patient Of B", phone: newPhone() } })).json();
});

after(async () => {
  await cleanupTenant(A);
  await cleanupTenant(B);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("tenant isolation", () => {
  it("every hms table returns no rows without a tenant, and none for a different tenant", async () => {
    const tables = (await admin.$queryRaw<{ relname: string }[]>`SELECT relname FROM pg_class WHERE relnamespace = 'hms'::regnamespace AND relkind = 'r'`).map((r) => r.relname);
    assert.ok(tables.length >= 8);
    for (const t of tables) {
      const none = await appDb.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM hms."${t}"`);
      assert.equal(Number(none[0]!.n), 0, `${t} leaked rows with no tenant set`);
      const other = await appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', '00000000-0000-7000-8000-000000000000', true)`;
        return tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM hms."${t}"`);
      });
      assert.equal(Number(other[0]!.n), 0, `${t} leaked rows to an unknown tenant`);
    }
  });

  it("staff only see their own hospital's patients", async () => {
    const a = (await app.inject({ method: "GET", url: "/patients", headers: auth(tokA) })).json() as { id: string }[];
    assert.ok(a.some((p) => p.id === patientA.id));
    assert.ok(!a.some((p) => p.id === patientB.id));
  });

  it("cannot book an appointment for another hospital's patient", async () => {
    const res = await app.inject({ method: "POST", url: "/appointments", headers: auth(tokA), payload: { patientId: patientB.id, scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected a client error, got ${res.statusCode}`);
  });

  it("cannot issue a card to another hospital's patient or use another hospital's plan", async () => {
    const plansB = (await app.inject({ method: "GET", url: "/card-plans", headers: auth(tokB) })).json() as { id: string }[];
    const res1 = await app.inject({ method: "POST", url: "/cards", headers: auth(tokA), payload: { planId: plansB[0]!.id, ownerPatientId: patientA.id, paymentMethod: "CASH" } });
    assert.equal(res1.statusCode, 404);
    const plansA = (await app.inject({ method: "GET", url: "/card-plans", headers: auth(tokA) })).json() as { id: string }[];
    const res2 = await app.inject({ method: "POST", url: "/cards", headers: auth(tokA), payload: { planId: plansA[0]!.id, ownerPatientId: patientB.id, paymentMethod: "CASH" } });
    assert.equal(res2.statusCode, 404);
  });

  it("rejects requests without a token and tokens of the wrong kind", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/patients" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/patient/me" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/patient/me", headers: auth(tokA) })).statusCode, 403);
  });
});
