import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signHmac, type PaymentGateway } from "@hms/billing-core";
import { buildApp } from "../src/app";
import { addStaff, admin, appDb, auth, cleanupTenant, makeTenant, newPhone, provider, staffToken, type Fixture } from "./helpers";

const SECRET = "whsec_test";
let linkSeq = 0;
const gateway: PaymentGateway = {
  name: "fake",
  async createPaymentLink(r) { linkSeq++; return { gatewayRef: `plink_pf_${Date.now()}_${linkSeq}`, url: `https://pay.example/${r.reference}` }; },
  verifyWebhook: (raw, sig) => !!sig && sig === signHmac(raw, SECRET),
};

let app: Awaited<ReturnType<typeof buildApp>>, T: Fixture, owner: string, rec: string;
const inject = (token: string, method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, headers: auth(token), payload });

before(async () => {
  app = await buildApp(appDb, { jwtSecret: "test-secret-test-secret-test-secret-1234", provider, gateway, logger: false });
  T = await makeTenant("pdf");
  const o = await addStaff(T, "OWNER", "Owner");
  owner = await staffToken(app, o.phone);
  rec = await staffToken(app, T.receptionist.phone);
});
after(async () => {
  await cleanupTenant(T);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

let month = 0;
const makeInvoice = () => admin.platformInvoice.create({
  data: {
    tenantId: T.tenantId, invoiceNo: `SW-TEST-${Math.random().toString(36).slice(2, 8)}`, periodStart: new Date(Date.UTC(2025, month++, 1)), periodEnd: new Date("2026-09-30"), planCode: "STARTER",
    lines: [{ description: "Starter plan", quantity: 1, unitPaise: 1_000_000, amountPaise: 1_000_000 }], subtotalPaise: 1_000_000, gstPaise: 180_000, totalPaise: 1_180_000, dueDate: new Date(Date.now() + 5 * 86_400_000),
  },
});
const paid = (inv: { id: string; gatewayRef: string | null }, amount: number, id = `pay_${Math.random().toString(36).slice(2)}`) => {
  const raw = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: inv.gatewayRef, notes: { kind: "platform", platformInvoiceId: inv.id, tenantId: T.tenantId } } }, payment: { entity: { id, amount, method: "upi" } } } });
  return app.inject({ method: "POST", url: "/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": signHmac(raw, SECRET) }, payload: raw });
};

describe("subscription invoices", () => {
  it("creates one reusable pay link for the owner only, and a verified payment marks it paid once", async () => {
    const inv = await makeInvoice();
    assert.equal((await inject(rec, "POST", `/subscription/invoices/${inv.id}/pay-link`)).statusCode, 403);
    const a = await inject(owner, "POST", `/subscription/invoices/${inv.id}/pay-link`);
    assert.equal(a.statusCode, 200, a.body);
    const b = await inject(owner, "POST", `/subscription/invoices/${inv.id}/pay-link`);
    assert.equal(b.json().url, a.json().url, "the same link is reused");
    const stored = await admin.platformInvoice.findUniqueOrThrow({ where: { id: inv.id } });

    assert.equal((await paid(stored, 1_000)).json().ignored, true, "a part payment does not settle the invoice");
    assert.equal((await admin.platformInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "DUE");
    const bad = await app.inject({ method: "POST", url: "/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": "nope" }, payload: "{}" });
    assert.equal(bad.statusCode, 401);

    assert.equal((await paid(stored, 1_180_000, "pay_one")).json().outcome, "paid");
    assert.equal((await paid(stored, 1_180_000, "pay_one")).json().outcome, "already", "a repeated delivery changes nothing");
    const done = await admin.platformInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(done.status, "PAID");
    assert.equal(done.paymentRef, "pay_one");
    assert.equal((await inject(owner, "POST", `/subscription/invoices/${inv.id}/pay-link`)).statusCode, 409, "nothing to pay now");
  });

  it("renders PDFs for platform and patient invoices, and keeps them inside the hospital", async () => {
    const inv = await makeInvoice();
    const pdf = await inject(owner, "GET", `/subscription/invoices/${inv.id}/pdf`);
    assert.equal(pdf.statusCode, 200);
    assert.match(String(pdf.headers["content-type"]), /application\/pdf/);
    assert.equal(pdf.rawPayload.subarray(0, 4).toString(), "%PDF");

    const patient = (await inject(rec, "POST", "/patients", { fullName: "Pdf Pat", phone: newPhone() })).json();
    const bill = (await inject(rec, "POST", "/invoices", { patientId: patient.id, lines: [{ kind: "OTHER", description: "Dressing", quantity: 2, unitPaise: 7_500 }], payments: [{ method: "CASH", amountPaise: 15_000 }] })).json();
    const mine = await inject(rec, "GET", `/invoices/${bill.id}/pdf`);
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal(mine.rawPayload.subarray(0, 4).toString(), "%PDF");
    assert.equal((await inject(rec, "GET", `/invoices/${patient.id}/pdf`)).statusCode, 404);
  });
});
