import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, A: Fixture, B: Fixture, tok: string, tokB: string;

const call = async (token: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const mine = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) => call(tok, method, url, payload);
const newPatient = async (name: string) => (await mine("POST", "/patients", { fullName: name, phone: newPhone() })).body as { id: string; patientNo: string };
const book = async (patientId: string, channel: "IN_PERSON" | "TELE" = "IN_PERSON") =>
  (await mine("POST", "/appointments", { patientId, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), channel })).body as { id: string };

before(async () => {
  app = await makeApp();
  A = await makeTenant("billa");
  B = await makeTenant("billb");
  tok = await staffToken(app, A.receptionist.phone);
  tokB = await staffToken(app, B.receptionist.phone);
});
after(async () => {
  await cleanupTenant(A);
  await cleanupTenant(B);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("billing", () => {
  it("creates a consultation invoice at check-in, takes part payments, and rejects overpayment", async () => {
    const p = await newPatient("Pay Partial");
    const a = await book(p.id);
    const checked = await mine("PATCH", `/appointments/${a.id}`, { status: "CHECKED_IN" });
    assert.equal(checked.body.invoice.totalPaise, 20_000, "consultation default is Rs 200");
    assert.equal(checked.body.invoice.status, "UNPAID");
    const id = checked.body.invoice.id as string;

    const part = await mine("POST", `/invoices/${id}/payments`, { amountPaise: 5_000, method: "CASH" });
    assert.equal(part.status, 201);
    assert.equal(part.body.status, "PARTIAL");
    const over = await mine("POST", `/invoices/${id}/payments`, { amountPaise: 15_001, method: "UPI" });
    assert.equal(over.status, 409);
    const rest = await mine("POST", `/invoices/${id}/payments`, { amountPaise: 15_000, method: "UPI", reference: "UPI123" });
    assert.equal(rest.body.status, "PAID");
    assert.equal(rest.body.paidPaise, 20_000);
    assert.equal((await mine("POST", `/invoices/${id}/payments`, { amountPaise: 1, method: "CASH" })).status, 409, "a paid invoice takes no more money");
    assert.equal((await mine("POST", `/invoices/${id}/void`)).status, 403, "receptionists cannot void");
  });

  it("two cashiers paying at the same time cannot overpay", async () => {
    const p = await newPatient("Race Pay");
    const inv = (await mine("POST", "/invoices", { patientId: p.id, lines: [{ description: "Dressing", unitPaise: 10_000 }] })).body;
    const results = await Promise.all(Array.from({ length: 5 }, () => mine("POST", `/invoices/${inv.id}/payments`, { amountPaise: 6_000, method: "CASH" })));
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 1, "only one 6,000 payment fits in a 10,000 invoice");
    const after = (await mine("GET", `/invoices/${inv.id}`)).body;
    assert.equal(after.paidPaise, 6_000);
    assert.equal(after.payments.length, 1);
  });

  it("a card-covered visit gets a zero invoice that shows the waived fee", async () => {
    const plans = (await mine("GET", "/card-plans")).body as { id: string; type: string }[];
    const p = await newPatient("Card Waiver");
    const card = (await mine("POST", "/cards", { planId: plans.find((x) => x.type === "INDIVIDUAL")!.id, ownerPatientId: p.id, paymentMethod: "CASH" })).body;
    const a = await book(p.id);
    const r = await mine("PATCH", `/appointments/${a.id}`, { status: "CHECKED_IN" });
    assert.equal(r.body.feeWaived, true);
    const inv = (await mine("GET", `/invoices/${r.body.invoice.id}`)).body;
    assert.equal(inv.subtotalPaise, 20_000);
    assert.equal(inv.discountPaise, 20_000);
    assert.equal(inv.totalPaise, 0);
    assert.equal(inv.status, "PAID");
    // the card purchase itself produced a paid invoice of Rs 2,200
    const cardInv = (await mine("GET", `/invoices/${card.invoiceId}`)).body;
    assert.equal(cardInv.totalPaise, 220_000);
    assert.equal(cardInv.status, "PAID");
    assert.equal(cardInv.lines.length, 2);
  });

  it("cancelling voids an unpaid visit invoice but keeps a paid one", async () => {
    const p = await newPatient("Cancel Bill");
    const a1 = await book(p.id);
    const c1 = await mine("PATCH", `/appointments/${a1.id}`, { status: "CHECKED_IN" });
    await mine("PATCH", `/appointments/${a1.id}`, { status: "CANCELLED" });
    assert.equal((await mine("GET", `/invoices/${c1.body.invoice.id}`)).body.status, "VOID");

    const a2 = await book(p.id);
    const c2 = await mine("PATCH", `/appointments/${a2.id}`, { status: "CHECKED_IN" });
    await mine("POST", `/invoices/${c2.body.invoice.id}/payments`, { amountPaise: 20_000, method: "CASH" });
    await mine("PATCH", `/appointments/${a2.id}`, { status: "CANCELLED" });
    assert.equal((await mine("GET", `/invoices/${c2.body.invoice.id}`)).body.status, "PAID", "paid invoices are never voided silently");
  });

  it("numbers invoices and patients without gaps or duplicates under concurrency", async () => {
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => mine("POST", "/patients", { fullName: `Parallel ${i}`, phone: newPhone() })));
    const nos = made.map((m) => m.body.patientNo as string);
    assert.equal(new Set(nos).size, 8, "no duplicate patient numbers");
    const p = made[0]!.body as { id: string };
    const invs = await Promise.all(Array.from({ length: 6 }, () => mine("POST", "/invoices", { patientId: p.id, lines: [{ description: "Item", unitPaise: 100 }] })));
    assert.equal(new Set(invs.map((i) => i.body.invoiceNo)).size, 6);
  });

  it("totals the day's collections by method and records the cash closing with its difference", async () => {
    const p = await newPatient("Closing Day");
    await mine("POST", "/invoices", { patientId: p.id, lines: [{ description: "A", unitPaise: 30_000 }], payment: { method: "CASH" } });
    await mine("POST", "/invoices", { patientId: p.id, lines: [{ description: "B", unitPaise: 12_000 }], payment: { method: "UPI" } });
    const day = (await mine("GET", "/billing/collections")).body;
    assert.ok(day.byMethod.CASH >= 30_000 && day.byMethod.UPI >= 12_000);
    const date = day.date as string;

    const denied = await mine("POST", "/billing/closings", { date, countedCashPaise: 0 });
    assert.equal(denied.status, 403, "only owner/admin close the day");

    const owner = await admin.identity.create({ data: { phone: newPhone(), fullName: "Owner", passwordHash: (await admin.identity.findUniqueOrThrow({ where: { id: A.receptionist.id } })).passwordHash } });
    await admin.tenantMembership.create({ data: { tenantId: A.tenantId, identityId: owner.id, role: "OWNER" } });
    const ownerTok = await staffToken(app, owner.phone);
    const closed = await call(ownerTok, "POST", "/billing/closings", { date, countedCashPaise: day.byMethod.CASH - 500 });
    assert.equal(closed.status, 201);
    assert.equal(closed.body.expectedCashPaise, day.byMethod.CASH);
    assert.equal(closed.body.differencePaise, -500, "short by Rs 5");
    assert.equal((await call(ownerTok, "POST", "/billing/closings", { date, countedCashPaise: 0 })).status, 409, "a day closes once");
    await admin.tenantMembership.deleteMany({ where: { identityId: owner.id } });
    await admin.refreshToken.deleteMany({ where: { identityId: owner.id } });
    await admin.identity.delete({ where: { id: owner.id } });
  });

  it("keeps invoices and payments inside their hospital", async () => {
    const p = await newPatient("Iso Bill");
    const inv = (await mine("POST", "/invoices", { patientId: p.id, lines: [{ description: "X", unitPaise: 5_000 }] })).body;
    assert.equal((await call(tokB, "GET", `/invoices/${inv.id}`)).status, 404);
    assert.equal((await call(tokB, "POST", `/invoices/${inv.id}/payments`, { amountPaise: 100, method: "CASH" })).status, 404);
    const listB = (await call(tokB, "GET", "/invoices")).body as { id: string }[];
    assert.ok(!listB.some((i) => i.id === inv.id));
    const crossPatient = await call(tokB, "POST", "/invoices", { patientId: p.id, lines: [{ description: "Y", unitPaise: 1 }] });
    assert.equal(crossPatient.status, 404);
  });

  it("the app role cannot edit or delete payments", async () => {
    await assert.rejects(appDb.$executeRawUnsafe(`DELETE FROM hms.payments`), /permission denied/);
    await assert.rejects(appDb.$executeRawUnsafe(`UPDATE hms.payments SET amount_paise = 1`), /permission denied/);
  });
});
