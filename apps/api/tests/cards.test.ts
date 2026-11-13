import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, tok: string;

const call = async (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(tok), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};

before(async () => {
  app = await makeApp();
  T = await makeTenant("cards");
  tok = await staffToken(app, T.receptionist.phone);
});
after(async () => {
  await cleanupTenant(T);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

const newPatient = async (name: string) => (await call("POST", "/patients", { fullName: name, phone: newPhone() })).body as { id: string };
const book = async (patientId: string, channel: "IN_PERSON" | "TELE") =>
  (await call("POST", "/appointments", { patientId, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), channel })).body as { id: string };
const move = (id: string, status: string) => call("PATCH", `/appointments/${id}`, { status });

describe("health cards", () => {
  it("issues a family card: card fee + plan price, up to 5 members, each patient on one card only", async () => {
    const plans = (await call("GET", "/card-plans")).body as { id: string; type: string; issueFeePaise: number; planPricePaise: number }[];
    const family = plans.find((p) => p.type === "FAMILY")!;
    assert.equal(family.issueFeePaise, 50_000);
    assert.equal(family.planPricePaise, 800_000);
    const [p1, p2] = [await newPatient("Fam One"), await newPatient("Fam Two")];
    const res = await call("POST", "/cards", { planId: family.id, ownerPatientId: p1.id, memberPatientIds: [p2.id], paymentMethod: "UPI" });
    assert.equal(res.status, 201);
    assert.equal(res.body.amountDuePaise, 850_000, "first purchase is Rs 8,500");
    assert.equal(res.body.members.length, 2);
    const again = await call("POST", "/cards", { planId: family.id, ownerPatientId: p2.id, paymentMethod: "CASH" });
    assert.equal(again.status, 409, "a patient cannot hold two cards");
  });

  it("covers 3 in-person and 2 tele visits per member, then charges normally", async () => {
    const plans = (await call("GET", "/card-plans")).body as { id: string; type: string }[];
    const p = await newPatient("Solo Card");
    const card = (await call("POST", "/cards", { planId: plans.find((x) => x.type === "INDIVIDUAL")!.id, ownerPatientId: p.id, paymentMethod: "CASH" })).body;
    assert.equal(card.amountDuePaise, 220_000, "first purchase is Rs 2,200");

    const waived: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await book(p.id, "IN_PERSON");
      const r = await move(a.id, "CHECKED_IN");
      assert.equal(r.status, 200);
      waived.push(r.body.feeWaived);
      await move(a.id, "IN_PROGRESS");
      await move(a.id, "COMPLETED");
    }
    assert.deepEqual(waived, [true, true, true, false], "the 4th in-person visit is not covered");

    const tele: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const a = await book(p.id, "TELE");
      tele.push((await move(a.id, "CHECKED_IN")).body.feeWaived);
    }
    assert.deepEqual(tele, [true, true, false], "the 3rd tele visit is not covered");

    const lookup = await call("GET", `/cards/lookup?patientId=${p.id}`);
    assert.equal(lookup.body.members[0].coverage.remaining.inPerson, 0);
    assert.equal(lookup.body.members[0].coverage.remaining.tele, 0);
  });

  it("gives the visit back when a checked-in appointment is cancelled", async () => {
    const plans = (await call("GET", "/card-plans")).body as { id: string; type: string }[];
    const p = await newPatient("Cancel Case");
    await call("POST", "/cards", { planId: plans.find((x) => x.type === "INDIVIDUAL")!.id, ownerPatientId: p.id, paymentMethod: "CASH" });
    const a = await book(p.id, "IN_PERSON");
    assert.equal((await move(a.id, "CHECKED_IN")).body.feeWaived, true);
    assert.equal((await call("GET", `/cards/lookup?patientId=${p.id}`)).body.members[0].coverage.remaining.inPerson, 2);
    assert.equal((await move(a.id, "CANCELLED")).body.feeWaived, false);
    assert.equal((await call("GET", `/cards/lookup?patientId=${p.id}`)).body.members[0].coverage.remaining.inPerson, 3);
  });

  it("renewal costs only the plan price, starts when the current period ends, and resets limits", async () => {
    const plans = (await call("GET", "/card-plans")).body as { id: string; type: string }[];
    const p = await newPatient("Renew Me");
    const card = (await call("POST", "/cards", { planId: plans.find((x) => x.type === "INDIVIDUAL")!.id, ownerPatientId: p.id, paymentMethod: "CASH" })).body;
    const firstEnd = new Date(card.activeSubscription.endsAt).getTime();
    const renewed = await call("POST", `/cards/${card.id}/renew`, { paymentMethod: "UPI" });
    assert.equal(renewed.status, 201);
    assert.equal(renewed.body.amountDuePaise, 200_000, "renewal is Rs 2,000 with no card fee");
    assert.equal(renewed.body.subscriptions.length, 2);
    const next = renewed.body.subscriptions[0];
    assert.equal(new Date(next.startsAt).getTime(), firstEnd, "new period starts when the old one ends");
  });

  it("blocks invalid status jumps", async () => {
    const p = await newPatient("Jumper");
    const a = await book(p.id, "IN_PERSON");
    assert.equal((await move(a.id, "COMPLETED")).status, 409);
  });
});
