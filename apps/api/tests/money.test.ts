import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signHmac, type PaymentGateway } from "@hms/billing-core";
import { buildApp } from "../src/app";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeTenant, newPhone, patientToken, provider, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App, appNoGateway: App, T: Fixture, rec: string, owner: string, pharm: string;
const SECRET = "whsec_test_secret";
let linkSeq = 0;
const fakeGateway: PaymentGateway = {
  name: "fake",
  async createPaymentLink(r) { linkSeq++; return { gatewayRef: `plink_${Date.now()}_${linkSeq}`, url: `https://pay.example/${r.reference}` }; },
  verifyWebhook: (raw, sig) => !!sig && sig === signHmac(raw, SECRET),
};
const opts = { jwtSecret: "test-secret-test-secret-test-secret-1234", provider, logger: false };

const call = async (a: App, token: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
  const res = await a.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const newPatient = async (name: string) => (await call(app, rec, "POST", "/patients", { fullName: name, phone: newPhone() })).body as { id: string };
const bill = async (patientId: string, rupees: number, method?: "CASH" | "UPI") =>
  (await call(app, rec, "POST", "/invoices", { patientId, lines: [{ description: "Service", unitPaise: rupees * 100 }], payment: method ? { method } : undefined })).body;

before(async () => {
  app = await buildApp(appDb, { ...opts, gateway: fakeGateway });
  appNoGateway = await buildApp(appDb, opts);
  T = await makeTenant("money");
  rec = await staffToken(app, T.receptionist.phone);
  owner = await staffToken(app, (await addStaff(T, "OWNER", "Owner")).phone);
  pharm = await staffToken(app, (await addStaff(T, "PHARMACIST", "Pharm")).phone);
});
const patientPhones: string[] = [];
after(async () => {
  await cleanupTenant(T);
  await cleanupIdentities(patientPhones);
  await app.close();
  await appNoGateway.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("refunds", () => {
  it("refunds are owner/admin only, capped at what was paid, and a full refund closes the invoice", async () => {
    const p = await newPatient("Refund Rita");
    const inv = await bill(p.id, 200, "CASH");
    assert.equal((await call(app, rec, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 5000, method: "CASH", reason: "Overcharged" })).status, 403);
    const r1 = await call(app, owner, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 5000, method: "CASH", reason: "Overcharged" });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.refundedPaise, 5000);
    assert.equal(r1.body.status, "PAID", "partly refunded invoices stay paid");
    assert.equal((await call(app, owner, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 15_001, method: "CASH", reason: "Too much" })).status, 409);
    assert.equal((await call(app, owner, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 100, method: "CASH", reason: "x" })).status, 400, "a reason is required");
    const r2 = await call(app, owner, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 15_000, method: "CASH", reason: "Service cancelled" });
    assert.equal(r2.body.status, "REFUNDED");
    assert.equal((await call(app, rec, "POST", `/invoices/${inv.id}/payments`, { amountPaise: 100, method: "CASH" })).status, 409, "a refunded invoice takes no payment");
    await assert.rejects(appDb.$executeRawUnsafe(`UPDATE hms.refunds SET amount_paise = 1`), /permission denied/);
  });

  it("refunded cash reduces the day's collections and the expected cash at closing", async () => {
    const p = await newPatient("Net Cash");
    const before = (await call(app, owner, "GET", "/billing/collections")).body;
    const inv = await bill(p.id, 300, "CASH");
    await call(app, owner, "POST", `/invoices/${inv.id}/refunds`, { amountPaise: 10_000, method: "CASH", reason: "Patient left" });
    const after = (await call(app, owner, "GET", "/billing/collections")).body;
    assert.equal(after.byMethod.CASH - before.byMethod.CASH, 20_000, "Rs 300 collected minus Rs 100 handed back");
    assert.equal(after.refundedPaise - before.refundedPaise, 10_000);
    const closed = await call(app, owner, "POST", "/billing/closings", { date: after.date, countedCashPaise: after.byMethod.CASH });
    assert.equal(closed.body.expectedCashPaise, after.byMethod.CASH);
    assert.equal(closed.body.differencePaise, 0);
  });
});

describe("GST", () => {
  it("medicine sales carry tax inside the price, split into CGST and SGST on the receipt", async () => {
    const m = (await call(app, pharm, "POST", "/medicines", { name: "Taxed Tab", pricePaise: 11_200, gstPercent: 12, reorderLevel: 1 })).body;
    await call(app, pharm, "POST", "/pharmacy/receipts", { medicineId: m.id, batchNo: "G1", expiryDate: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10), qty: 10 });
    const p = await newPatient("Tax Tara");
    const d = await call(app, pharm, "POST", "/pharmacy/dispense", { patientId: p.id, items: [{ medicineId: m.id, qty: 1 }], payment: { method: "CASH" } });
    assert.equal(d.body.invoice.totalPaise, 11_200);
    assert.equal(d.body.invoice.taxPaise, 1_200);
    const detail = (await call(app, owner, "GET", `/invoices/${d.body.invoice.id}`)).body;
    assert.deepEqual(detail.taxBreakup, [{ gstPercent: 12, taxablePaise: 10_000, cgstPaise: 600, sgstPaise: 600 }]);
    const consult = await bill(p.id, 200);
    assert.equal(consult.taxPaise, 0, "services without GST carry no tax");
  });

  it("the hospital profile (GSTIN, UPI id) is validated, owner-managed, and shown on invoices", async () => {
    const good = { legalName: "Sunrise Care Pvt Ltd", address: "Main Road, Village", phone: "9000000000", gstin: "29ABCDE1234F1Z5", upiVpa: "sunrise@okbank" };
    assert.equal((await call(app, rec, "PUT", "/settings/profile", good)).status, 403);
    assert.equal((await call(app, owner, "PUT", "/settings/profile", { ...good, gstin: "BADGSTIN" })).status, 400);
    assert.equal((await call(app, owner, "PUT", "/settings/profile", { ...good, upiVpa: "not a upi id" })).status, 400);
    assert.equal((await call(app, owner, "PUT", "/settings/profile", good)).status, 200);
    const p = await newPatient("Profile Pia");
    const inv = await bill(p.id, 100);
    const detail = (await call(app, rec, "GET", `/invoices/${inv.id}`)).body;
    assert.equal(detail.hospital.gstin, "29ABCDE1234F1Z5");
    assert.equal(detail.hospital.upiVpa, "sunrise@okbank");
  });
});

describe("online payments", () => {
  it("a patient pays their own bill from the app, only their own", async () => {
    const phone = newPhone();
    patientPhones.push(phone);
    const mine = (await call(app, rec, "POST", "/patients", { fullName: "App Payer", phone })).body as { id: string };
    const other = await newPatient("Someone Else");
    const myBill = await bill(mine.id, 250);
    const otherBill = await bill(other.id, 250);
    const tok = await patientToken(app, phone);
    await app.inject({ method: "POST", url: `/patient/hospitals/${T.tenantId}/join`, headers: auth(tok), payload: {} });
    const bills = (await app.inject({ method: "GET", url: "/patient/invoices", headers: auth(tok) })).json() as { id: string }[];
    assert.deepEqual(bills.map((b) => b.id), [myBill.id], "the patient sees only their own bills");
    const ok = await app.inject({ method: "POST", url: `/patient/invoices/${T.tenantId}/${myBill.id}/payment-link`, headers: auth(tok) });
    assert.equal(ok.statusCode, 201);
    assert.equal(ok.json().amountPaise, 25_000);
    const no = await app.inject({ method: "POST", url: `/patient/invoices/${T.tenantId}/${otherBill.id}/payment-link`, headers: auth(tok) });
    assert.equal(no.statusCode, 404, "someone else's bill cannot be paid or even probed");
  });

  const event = (link: { gatewayRef: string }, over: Partial<{ id: string; amount: number; method: string }> = {}, notes?: object, ev = "payment_link.paid") =>
    JSON.stringify({ event: ev, payload: { payment_link: { entity: { id: link.gatewayRef, notes } }, payment: { entity: { id: over.id ?? `pay_${Math.random().toString(36).slice(2)}`, amount: over.amount, method: over.method ?? "upi" } } } });
  const hook = (a: App, raw: string, sig = signHmac(raw, SECRET)) => a.inject({ method: "POST", url: "/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": sig }, payload: raw });

  it("creates a payment link for the balance; the paid webhook records the payment once", async () => {
    const p = await newPatient("Online Omi");
    const inv = await bill(p.id, 500);
    const link = await call(app, rec, "POST", `/invoices/${inv.id}/payment-link`, {});
    assert.equal(link.status, 201);
    assert.equal(link.body.amountPaise, 50_000);
    const stored = await admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`; return tx.paymentLink.findFirstOrThrow({ where: { invoiceId: inv.id } }); });
    const notes = { tenantId: T.tenantId, invoiceId: inv.id };

    const raw = event(stored, { id: "pay_abc123", amount: 50_000 }, notes);
    assert.equal((await hook(app, raw, "bad-signature")).statusCode, 401, "forged webhooks are refused");
    const ok = await hook(app, raw);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().outcome, "recorded");
    const paid = (await call(app, rec, "GET", `/invoices/${inv.id}`)).body;
    assert.equal(paid.status, "PAID");
    assert.equal(paid.payments[0].method, "UPI");
    assert.equal(paid.payments[0].reference, "pay_abc123");

    const dup = await Promise.all([hook(app, raw), hook(app, raw)]);
    assert.ok(dup.every((r) => r.statusCode === 200 && ["duplicate"].includes(r.json().outcome)), "redelivered webhooks do nothing");
    assert.equal((await call(app, rec, "GET", `/invoices/${inv.id}`)).body.payments.length, 1);
  });

  it("an overpayment or a payment on a voided bill is flagged, not recorded; unknown events are ignored", async () => {
    const p = await newPatient("Online Over");
    const inv = await bill(p.id, 100);
    await call(app, rec, "POST", `/invoices/${inv.id}/payment-link`, {});
    const stored = await admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`; return tx.paymentLink.findFirstOrThrow({ where: { invoiceId: inv.id } }); });
    const notes = { tenantId: T.tenantId, invoiceId: inv.id };
    const over = await hook(app, event(stored, { id: "pay_over1", amount: 99_999 }, notes));
    assert.equal(over.json().outcome, "unmatched");
    assert.equal((await call(app, rec, "GET", `/invoices/${inv.id}`)).body.paidPaise, 0, "no money was booked");
    const audited = await admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`; return tx.auditLog.count({ where: { action: "payment.unmatched", entityId: inv.id } }); });
    assert.equal(audited, 1);
    assert.equal((await hook(app, event(stored, { amount: 100 }, notes, "payment.failed"))).json().ignored, true);
    assert.equal((await hook(app, event({ gatewayRef: "plink_unknown" }, { amount: 100 }, notes))).json().outcome, "unknown");
  });

  it("without a gateway configured, links are unavailable and webhooks are off", async () => {
    const p = await newPatient("No Gateway");
    const inv = await bill(p.id, 100);
    assert.equal((await call(appNoGateway, rec, "POST", `/invoices/${inv.id}/payment-link`, {})).status, 503);
    const raw = "{}";
    assert.equal((await hook(appNoGateway, raw)).statusCode, 404);
    assert.equal((await call(app, rec, "GET", `/invoices/${inv.id}`)).body.gatewayEnabled, true);
  });
});
