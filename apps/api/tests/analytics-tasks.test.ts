import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addStaff, admin, appDb, auth, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let adminTok: string, rec: string, doc: string, nurse: string, nurseId: string, other: string, adminId: string;

const call = async (token: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

before(async () => {
  app = await makeApp();
  T = await makeTenant("ana"); O = await makeTenant("ana2");
  const ad = await addStaff(T, "ADMIN", "Admin"); adminId = ad.id;
  const n = await addStaff(T, "NURSE", "Nurse"); nurseId = n.id;
  adminTok = await staffToken(app, ad.phone); rec = await staffToken(app, T.receptionist.phone); doc = await staffToken(app, T.doctor.phone); nurse = await staffToken(app, n.phone);
  other = await staffToken(app, O.receptionist.phone);
});
after(async () => { await cleanupTenant(T); await cleanupTenant(O); await app.close(); await admin.$disconnect(); await appDb.$disconnect(); });

describe("analytics", () => {
  it("adds up today's visits and money, and shows money only to people who may see billing", async () => {
    const p = (await call(rec, "POST", "/patients", { fullName: "Ana Patient", phone: newPhone() })).body;
    const a1 = (await call(rec, "POST", "/appointments", { patientId: p.id, doctorId: T.doctor.id, scheduledAt: new Date(Date.now() + 3600_000).toISOString() })).body;
    await call(rec, "POST", "/appointments", { patientId: p.id, scheduledAt: new Date(Date.now() + 7200_000).toISOString(), channel: "TELE" });
    await call(rec, "PATCH", `/appointments/${a1.id}`, { status: "CHECKED_IN" });
    const bill = (await call(rec, "POST", "/invoices", { patientId: p.id, lines: [{ kind: "OTHER", description: "Dressing", quantity: 1, unitPaise: 25_000 }] })).body;
    assert.equal((await call(rec, "POST", `/invoices/${bill.id}/payments`, { amountPaise: 10_000, method: "CASH" })).status, 201);

    const r = (await call(rec, "GET", "/analytics/overview")).body;
    assert.equal(r.visits.total, 2);
    assert.equal(r.visits.waiting, 1);
    assert.equal(r.visits.tele, 1);
    assert.equal(r.visitsWeek.length, 7);
    assert.equal(r.visitsWeek[6].n, 2);
    // the 200 consultation fee is billed when the patient checks in
    assert.equal(r.money.billedPaise, 45_000);
    assert.equal(r.money.collectedPaise, 10_000);
    assert.equal(r.money.outstandingPaise, 35_000);
    assert.equal(r.queue.length, 2);
    const d = (await call(doc, "GET", "/analytics/overview")).body;
    assert.equal(d.money, undefined, "a doctor does not see takings");
    assert.equal(d.collectionsWeek, undefined);
    assert.equal((await call(other, "GET", "/analytics/overview")).body.visits.total, 0, "another hospital's numbers are separate");
  });

  it("builds the report for a date range, reconciles with the bills, and is for report readers only", async () => {
    assert.equal((await call(rec, "GET", "/analytics/report")).status, 403);
    assert.equal((await call(doc, "GET", "/analytics/report")).status, 403);
    const rep = (await call(adminTok, "GET", `/analytics/report?from=${today()}&to=${today()}`)).body;
    assert.equal(rep.days, 1);
    assert.equal(rep.money.billedPaise, 45_000);
    assert.equal(rep.money.collectedPaise, 10_000);
    assert.equal(rep.money.series.length, 1);
    assert.equal(rep.money.bySource[0].source, "MANUAL");
    assert.equal(rep.money.byMethod[0].method, "CASH");
    assert.equal(rep.money.outstanding.under7Paise, 35_000);
    assert.equal(rep.visits.total, 2);
    assert.equal(rep.visits.byChannel.TELE, 1);
    assert.equal(rep.visits.byHour.length, 24);
    assert.equal(rep.patients.newInRange, 1);
    assert.equal((await call(adminTok, "GET", `/analytics/report?from=${today()}&to=2000-01-01`)).status, 400);
    assert.equal((await call(adminTok, "GET", "/analytics/report?from=2020-01-01&to=2026-01-01")).status, 400, "ranges are capped");
  });
});

describe("tasks", () => {
  it("anyone can keep tasks for themselves; handing work to others needs the manager permission", async () => {
    const mine = await call(nurse, "POST", "/tasks", { title: "Restock the dressing trolley" });
    assert.equal(mine.status, 201);
    assert.equal(mine.body.assignedTo, nurseId, "defaults to the creator");
    assert.equal((await call(nurse, "POST", "/tasks", { title: "Do this", assignedTo: adminId })).status, 403);
    const given = await call(adminTok, "POST", "/tasks", { title: "Call Mrs Devi about her sugar test", assignedTo: nurseId, priority: "HIGH", dueAt: new Date(Date.now() - 3600_000).toISOString() });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const list = (await call(nurse, "GET", "/tasks")).body;
    assert.equal(list.length, 2);
    assert.equal(list.find((t: { id: string }) => t.id === given.body.id).overdue, true);
    assert.equal((await call(nurse, "GET", "/tasks?scope=all")).status, 403);
    assert.equal((await call(adminTok, "GET", "/tasks?scope=all")).body.length, 2);

    // the assignee can finish it but not rewrite it
    assert.equal((await call(nurse, "PATCH", `/tasks/${given.body.id}`, { title: "Changed" })).status, 403);
    const done = await call(nurse, "PATCH", `/tasks/${given.body.id}`, { status: "DONE" });
    assert.equal(done.status, 200);
    assert.ok(done.body.completedAt && done.body.completedBy === nurseId);
    assert.equal((await call(nurse, "GET", "/tasks")).body.length, 1, "done tasks leave the open list");
    assert.equal((await call(nurse, "PATCH", `/tasks/${given.body.id}`, { status: "OPEN" })).body.completedAt, null, "reopening clears it");
    assert.equal((await call(rec, "PATCH", `/tasks/${mine.body.id}`, { status: "DONE" })).status, 403, "not theirs");
    assert.equal((await call(other, "PATCH", `/tasks/${mine.body.id}`, { status: "DONE" })).status, 404, "another hospital cannot see it");
    await assert.rejects(() => appDb.$executeRawUnsafe(`DELETE FROM hms.tasks WHERE id = '${mine.body.id}'`), "tasks are closed, never erased");
  });

  it("suggests work found in the data, and does not suggest what already has a task", async () => {
    const p = (await call(rec, "POST", "/patients", { fullName: "Overdue Payer", phone: newPhone() })).body;
    const inv = (await call(rec, "POST", "/invoices", { patientId: p.id, lines: [{ kind: "OTHER", description: "Procedure", quantity: 1, unitPaise: 700_000 }] })).body;
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      await tx.invoice.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    });
    const s = (await call(adminTok, "GET", "/tasks/suggestions")).body as { title: string; priority: string; patientId?: string }[];
    const bill = s.find((x) => x.title.includes("Overdue Payer"));
    assert.ok(bill, JSON.stringify(s));
    assert.equal(bill!.priority, "HIGH");
    assert.equal((await call(nurse, "GET", "/tasks/suggestions")).status, 403);
    await call(adminTok, "POST", "/tasks", { title: bill!.title, patientId: bill!.patientId });
    assert.ok(!(await call(adminTok, "GET", "/tasks/suggestions")).body.some((x: { title: string }) => x.title === bill!.title), "once a task exists the suggestion goes away");
  });
});

describe("inbox", () => {
  it("lists what needs attention, most urgent first, filtered to what the person may see", async () => {
    const r = (await call(adminTok, "GET", "/inbox")).body;
    assert.ok(Array.isArray(r.alerts));
    assert.ok(r.alerts.some((a: { key: string }) => a.key === "bills-overdue"));
    const sev = r.alerts.map((a: { severity: string }) => ({ critical: 0, warning: 1, info: 2 })[a.severity as "critical"]);
    assert.deepEqual(sev, [...sev].sort(), "ordered by urgency");
    const n = (await call(nurse, "GET", "/inbox")).body;
    assert.ok(!n.alerts.some((a: { key: string }) => a.key === "bills-overdue"), "a nurse does not get billing alerts");
    assert.ok(n.alerts.some((a: { key: string }) => a.key.startsWith("tasks-")), "but sees her own tasks");
  });
});

describe("organization overview for the admin", () => {
  it("shows people, roles and branches to whoever manages staff, and nobody else", async () => {
    const o = (await call(adminTok, "GET", "/analytics/organization")).body;
    assert.ok(o.people.total >= 3 && o.seats.used >= 3 && o.seats.limit >= o.seats.used);
    assert.ok(o.access.roles.some((r: { key: string }) => r.key === "OWNER"));
    assert.ok(Array.isArray(o.branches) && o.branches.length >= 1 && Array.isArray(o.modules));
    assert.ok(!JSON.stringify(o).includes(T.receptionist.phone), "full phone numbers are not exposed");
    assert.equal((await call(nurse, "GET", "/analytics/organization")).status, 403);
    assert.equal((await call(other, "GET", "/analytics/organization")).status, 403, "and it is only ever this organization's own");
  });
});
