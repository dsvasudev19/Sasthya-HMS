import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, patientToken, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, H1: Fixture, H2: Fixture;
const phone = newPhone();
const deskPhone = newPhone();

before(async () => {
  app = await makeApp();
  H1 = await makeTenant("h1");
  H2 = await makeTenant("h2");
});
after(async () => {
  await cleanupTenant(H1);
  await cleanupTenant(H2);
  await cleanupIdentities([phone, deskPhone]);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("patient app", () => {
  it("rejects a wrong or reused OTP", async () => {
    const r = await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone } });
    const code = r.json().devCode as string;
    const wrong = await app.inject({ method: "POST", url: "/patient/otp/verify", payload: { phone, code: code === "000000" ? "111111" : "000000" } });
    assert.equal(wrong.statusCode, 401);
    const ok = await app.inject({ method: "POST", url: "/patient/otp/verify", payload: { phone, code } });
    assert.equal(ok.statusCode, 200);
    const reuse = await app.inject({ method: "POST", url: "/patient/otp/verify", payload: { phone, code } });
    assert.equal(reuse.statusCode, 401);
  });

  it("rate limits OTP requests", async () => {
    const p = newPhone();
    for (let i = 0; i < 3; i++) assert.equal((await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone: p } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone: p } })).statusCode, 429);
    await cleanupIdentities([p]);
  });

  it("registers at a hospital, books, sees the queue, and cannot touch an unlinked hospital", async () => {
    const tok = await patientToken(app, phone);
    const hospitals = (await app.inject({ method: "GET", url: "/public/hospitals?q=Test" })).json() as { id: string }[];
    assert.ok(hospitals.some((h) => h.id === H1.tenantId));

    const noName = await app.inject({ method: "POST", url: `/patient/hospitals/${H1.tenantId}/join`, headers: auth(tok), payload: {} });
    assert.equal(noName.statusCode, 400);
    const join = await app.inject({ method: "POST", url: `/patient/hospitals/${H1.tenantId}/join`, headers: auth(tok), payload: { fullName: "Rural Patient" } });
    assert.equal(join.statusCode, 201);

    const book = await app.inject({ method: "POST", url: "/patient/appointments", headers: auth(tok), payload: { tenantId: H1.tenantId, doctorId: H1.doctor.id, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), channel: "IN_PERSON", reason: "Fever" } });
    assert.equal(book.statusCode, 201);

    const forbidden = await app.inject({ method: "POST", url: "/patient/appointments", headers: auth(tok), payload: { tenantId: H2.tenantId, scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    assert.equal(forbidden.statusCode, 403);

    const mine = (await app.inject({ method: "GET", url: "/patient/appointments", headers: auth(tok) })).json() as { hospital: { id: string }; reason: string }[];
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.hospital.id, H1.tenantId);

    const staffTok = await staffToken(app, H1.receptionist.phone);
    const seen = (await app.inject({ method: "GET", url: "/patients?q=Rural", headers: auth(staffTok) })).json() as unknown[];
    assert.equal(seen.length, 1, "the hospital sees the self-registered patient");

    const cancel = await app.inject({ method: "POST", url: `/patient/appointments/${H1.tenantId}/${(book.json() as { id: string }).id}/cancel`, headers: auth(tok) });
    assert.equal(cancel.statusCode, 200);
  });

  it("links to the record the front desk already created for the same phone number", async () => {
    const staffTok = await staffToken(app, H2.receptionist.phone);
    const desk = (await app.inject({ method: "POST", url: "/patients", headers: auth(staffTok), payload: { fullName: "Desk Registered", phone: deskPhone } })).json() as { id: string };
    const tok = await patientToken(app, deskPhone);
    const join = await app.inject({ method: "POST", url: `/patient/hospitals/${H2.tenantId}/join`, headers: auth(tok), payload: {} });
    assert.equal(join.statusCode, 201);
    assert.equal(join.json().patientId, desk.id, "reuses the existing record instead of duplicating");
  });
});
