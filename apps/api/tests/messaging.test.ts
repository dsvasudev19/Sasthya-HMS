import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ProviderError, deliverDue, scheduleReminders, type MessageProvider, type OutgoingMessage } from "@hms/notifications";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, provider, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture, rec: string, doc: string, owner: string;
const phones: string[] = [];
const HOUR = 3600_000;

const call = async (token: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const messages = async (token = rec) => (await call(token, "GET", "/messages")).body as { id: string; template: string; status: string; body: string; attempts: number; toPhone: string }[];
const newPatient = async (name: string, extra: object = {}) => {
  const phone = newPhone();
  phones.push(phone);
  return { ...((await call(rec, "POST", "/patients", { fullName: name, phone })).body as { id: string }), phone, extra };
};
const book = (patientId: string, inHours: number) => call(rec, "POST", "/appointments", { patientId, scheduledAt: new Date(Date.now() + inHours * HOUR).toISOString() });
const flaky = (failures: number, retryable = true): MessageProvider & { calls: number } => {
  const p = { name: "flaky", calls: 0, async send(_m: OutgoingMessage) { p.calls++; if (p.calls <= failures) throw new ProviderError("gateway answered 503", retryable); return { providerRef: "ok" }; } };
  return p;
};

before(async () => {
  app = await makeApp();
  T = await makeTenant("msg");
  O = await makeTenant("msg2");
  const w = await addStaff(T, "OWNER", "Owner");
  rec = await staffToken(app, T.receptionist.phone);
  doc = await staffToken(app, T.doctor.phone);
  owner = await staffToken(app, w.phone);
});
after(async () => {
  await cleanupTenant(T);
  await cleanupTenant(O);
  await cleanupIdentities(phones);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("messaging", () => {
  it("queues a confirmation when an appointment is booked, in the patient's language, and delivers it", async () => {
    const en = await newPatient("Anita Kumar");
    const hi = await newPatient("Ravi Sharma");
    await call(rec, "PATCH", `/patients/${hi.id}`, { language: "hi" });
    await book(en.id, 30);
    await book(hi.id, 30);
    const list = await messages();
    const e = list.find((m) => m.toPhone === en.phone)!;
    const h = list.find((m) => m.toPhone === hi.phone)!;
    assert.equal(e.template, "APPOINTMENT_CONFIRMED");
    assert.match(e.body, /Hi Anita, your appointment is booked/);
    assert.match(h.body, /नमस्ते Ravi/, "Hindi template is used");
    assert.match(h.body, /टोकन #\d+/);

    const before = provider.sent.length;
    const r = await deliverDue(appDb, provider, new Date(), 50, [T.tenantId]);
    assert.ok(r.sent >= 2);
    assert.ok(provider.sent.slice(before).some((m) => m.to === `+91${en.phone}`), "sent with the +91 prefix");
    assert.ok((await messages()).filter((m) => [en.phone, hi.phone].includes(m.toPhone)).every((m) => m.status === "SENT"));
  });

  it("reminds once about appointments tomorrow, skips last-minute bookings, and respects opt-out", async () => {
    const p = await newPatient("Reminder Rita");
    const optOut = await newPatient("Opt Out Omar");
    await call(rec, "PATCH", `/patients/${optOut.id}`, { reminderOptOut: true });
    const soon = await newPatient("Booked Today");
    const mk = (patientId: string, hours: number, createdHoursAgo: number) => admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      const branch = await tx.branch.findFirstOrThrow({ where: { isMain: true } });
      return tx.appointment.create({ data: { tenantId: T.tenantId, branchId: branch.id, patientId, scheduledAt: new Date(Date.now() + hours * HOUR), tokenNo: 99, createdAt: new Date(Date.now() - createdHoursAgo * HOUR) } });
    });
    const far = await mk(p.id, 20, 72);        // booked 3 days ago, in 20 hours: remind
    await mk(optOut.id, 20, 72);                // same but opted out
    await mk(soon.id, 20, 1);                   // booked 1 hour ago for tomorrow: the confirmation is enough
    const first = await scheduleReminders(appDb, new Date(), [T.tenantId]);
    assert.equal(first.queued, 1);
    const second = await scheduleReminders(appDb, new Date(), [T.tenantId]);
    assert.equal(second.queued, 0, "running again queues nothing new");
    const rem = (await messages()).filter((m) => m.template === "APPOINTMENT_REMINDER");
    assert.equal(rem.length, 1);
    assert.equal(rem[0]!.toPhone, p.phone);
    assert.ok(far.id);
  });

  it("follow-up and card-expiry reminders", async () => {
    const p = await newPatient("Follow Fatima");
    const a = (await book(p.id, 1)).body as { id: string };
    await call(rec, "PATCH", `/appointments/${a.id}`, { status: "CHECKED_IN" });
    const tomorrow = new Date(Date.now() + 5.5 * HOUR + 24 * HOUR).toISOString().slice(0, 10);
    await call(doc, "PUT", `/appointments/${a.id}/consultation`, { diagnosis: "Check", followUpOn: tomorrow });
    await call(doc, "POST", `/appointments/${a.id}/consultation/complete`);

    const q = await newPatient("Card Chandra");
    const plans = (await call(rec, "GET", "/card-plans")).body as { id: string; type: string }[];
    const card = (await call(rec, "POST", "/cards", { planId: plans.find((x) => x.type === "INDIVIDUAL")!.id, ownerPatientId: q.id, paymentMethod: "CASH" })).body;
    // pretend the plan ends in 3 days
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      await tx.$executeRaw`UPDATE hms.card_subscriptions SET starts_at = now() - interval '180 days', ends_at = now() + interval '3 days' WHERE card_id = ${card.id}::uuid`;
    });
    const r = await scheduleReminders(appDb, new Date(), [T.tenantId]);
    assert.ok(r.queued >= 2);
    const list = await messages();
    assert.ok(list.some((m) => m.template === "FOLLOWUP_REMINDER" && m.toPhone === p.phone));
    const exp = list.find((m) => m.template === "CARD_EXPIRY" && m.toPhone === q.phone)!;
    assert.ok(exp.body.includes(card.cardNo));

    // renewing before the end stops further expiry reminders for that period
    await call(rec, "POST", `/cards/${card.id}/renew`, { paymentMethod: "CASH" });
    assert.equal((await scheduleReminders(appDb, new Date(Date.now() + HOUR), [T.tenantId])).queued, 0);
  });

  it("retries a failing gateway with backoff, then gives up after 4 attempts; non-retryable errors fail at once", async () => {
    const p = await newPatient("Retry Raj");
    await call(rec, "POST", "/messages", { patientId: p.id, text: "Hello Raj, please call the hospital." });
    const find = async () => (await messages()).find((m) => m.toPhone === p.phone && m.template === "MANUAL")!;
    const bad = flaky(99);
    const t0 = new Date();
    await deliverDue(appDb, bad, t0, 50, [T.tenantId]);
    let m = await find();
    assert.equal(m.status, "QUEUED");
    assert.equal(m.attempts, 1);
    assert.equal((await deliverDue(appDb, bad, new Date(t0.getTime() + 10_000), 50, [T.tenantId])).sent, 0, "not retried before the backoff has passed");
    for (let i = 1; i <= 3; i++) await deliverDue(appDb, bad, new Date(t0.getTime() + i * 3 * HOUR), 50, [T.tenantId]);
    m = await find();
    assert.equal(m.status, "FAILED");
    assert.equal(m.attempts, 4);
    assert.equal((await call(rec, "POST", `/messages/${m.id}/retry`)).status, 200, "a failed message can be retried by hand");
    const good = flaky(0);
    await deliverDue(appDb, good, new Date(Date.now() + 5000), 50, [T.tenantId]);
    assert.equal((await find()).status, "SENT");

    const p2 = await newPatient("Hard Fail");
    await call(rec, "POST", "/messages", { patientId: p2.id, text: "Hello there friend" });
    await deliverDue(appDb, flaky(99, false), new Date(), 50, [T.tenantId]);
    const hf = (await messages()).find((x) => x.toPhone === p2.phone)!;
    assert.equal(hf.status, "FAILED");
    assert.equal(hf.attempts, 1);
  });

  it("two workers never send the same message", async () => {
    const p = await newPatient("Double Dan");
    await call(rec, "POST", "/messages", { patientId: p.id, text: "Only once please" });
    const a = flaky(0);
    const b = flaky(0);
    await Promise.all([deliverDue(appDb, a, new Date(), 50, [T.tenantId]), deliverDue(appDb, b, new Date(), 50, [T.tenantId])]);
    assert.equal(a.calls + b.calls, 1);
  });

  it("hospital settings switch automatic messages off; only owner/admin can change them", async () => {
    assert.equal((await call(rec, "PUT", "/settings/messaging", { appointmentConfirmed: false, appointmentReminder: true, followUpReminder: true, cardExpiry: true, reportReady: true })).status, 403);
    const set = await call(owner, "PUT", "/settings/messaging", { appointmentConfirmed: false, appointmentReminder: true, followUpReminder: true, cardExpiry: true, reportReady: true });
    assert.equal(set.status, 200);
    const p = await newPatient("Quiet Quinn");
    await book(p.id, 30);
    assert.ok(!(await messages()).some((m) => m.toPhone === p.phone), "no confirmation when switched off");
    await call(owner, "PUT", "/settings/messaging", { appointmentConfirmed: true, appointmentReminder: true, followUpReminder: true, cardExpiry: true, reportReady: true });
  });

  it("a released lab report notifies the patient, and messages stay inside their hospital", async () => {
    const p = await newPatient("Report Ria");
    const lab = await staffToken(app, (await addStaff(T, "LAB_TECH", "Lab")).phone);
    const tests = (await call(lab, "GET", "/lab/tests")).body as { id: string; code: string }[];
    const order = (await call(lab, "POST", "/lab/orders", { patientId: p.id, testIds: [tests.find((t) => t.code === "URINE")!.id], payment: { method: "CASH" } })).body;
    await call(lab, "POST", `/lab/orders/${order.id}/collect`);
    await call(lab, "PUT", `/lab/orders/${order.id}/results`, { results: [{ itemId: order.items[0].id, resultText: "Clear" }] });
    assert.equal((await call(lab, "POST", `/lab/orders/${order.id}/release`, {})).status, 200);
    assert.ok((await messages()).some((m) => m.template === "REPORT_READY" && m.toPhone === p.phone));

    const other = await staffToken(app, O.receptionist.phone);
    assert.equal((await messages(other)).length, 0);
  });

  it("OTP goes through the provider, and a gateway failure returns a clean error", async () => {
    const phone = newPhone();
    phones.push(phone);
    const before = provider.sent.length;
    const ok = await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone } });
    assert.equal(ok.statusCode, 200);
    const sent = provider.sent.slice(before).find((m) => m.template === "OTP")!;
    assert.ok(sent.body.includes(ok.json().devCode), "the SMS carries the same code");
    assert.equal(sent.to, `+91${phone}`);

    const { buildApp } = await import("../src/app");
    const failing = await buildApp(appDb, { jwtSecret: "test-secret-test-secret-test-secret-1234", provider: flaky(99), logger: false });
    const phone2 = newPhone();
    phones.push(phone2);
    const bad = await failing.inject({ method: "POST", url: "/patient/otp/request", payload: { phone: phone2 } });
    assert.equal(bad.statusCode, 502);
    assert.equal(bad.json().devCode, undefined);
    await failing.close();
  });
});
