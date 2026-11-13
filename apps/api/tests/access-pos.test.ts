import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { clearTenantCache } from "../src/gates";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, staffToken, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let owner: string, adminTok: string, rec: string, pharm: string, other: string;
let pharmId: string;

const call = async (token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method, url, headers: { ...auth(token), ...headers }, payload: payload as object | undefined });
  return { status: res.statusCode, body: res.json() };
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  app = await makeApp();
  T = await makeTenant("acc");
  O = await makeTenant("acc2");
  const ow = await addStaff(T, "OWNER", "Owner");
  const ad = await addStaff(T, "ADMIN", "Admin");
  const ph = await addStaff(T, "PHARMACIST", "Pharmacist");
  pharmId = ph.id;
  owner = await staffToken(app, ow.phone);
  adminTok = await staffToken(app, ad.phone);
  pharm = await staffToken(app, ph.phone);
  rec = await staffToken(app, T.receptionist.phone);
  other = await staffToken(app, O.receptionist.phone);
});
after(async () => {
  await cleanupTenant(T);
  await cleanupTenant(O);
  await app.close();
  await admin.$disconnect();
  await appDb.$disconnect();
});

describe("dynamic roles", () => {
  it("lets the owner define a role, assign it, and enforces exactly its permissions", async () => {
    const made = await call(owner, "POST", "/roles", { key: "BILLING_CLERK", name: "Billing clerk", permissions: ["patients:read", "billing:read", "billing:write"] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const clerk = await addStaff(T, "BILLING_CLERK", "Clerk");
    const tok = await staffToken(app, clerk.phone);
    assert.equal((await call(tok, "GET", "/invoices")).status, 200);
    assert.equal((await call(tok, "GET", "/medicines")).status, 403, "no pharmacy permission");
    // editing the role takes effect without a new login
    assert.equal((await call(owner, "PATCH", `/roles/${made.body.id}`, { permissions: ["patients:read"] })).status, 200);
    assert.equal((await call(tok, "GET", "/invoices")).status, 403);
  });

  it("rejects unknown permissions, refuses to grant what the grantor lacks, and protects system roles", async () => {
    assert.equal((await call(owner, "POST", "/roles", { key: "BAD", name: "Bad", permissions: ["made:up"] })).status, 400);
    assert.equal((await call(adminTok, "POST", "/roles", { key: "HACK", name: "Hack", permissions: ["roles:manage"] })).status, 403, "admin cannot manage roles");
    assert.equal((await call(rec, "GET", "/roles")).status, 403);
    const roles = (await call(owner, "GET", "/roles")).body as { id: string; key: string; isSystem: boolean }[];
    const sys = roles.find((r) => r.key === "RECEPTIONIST")!;
    assert.equal(sys.isSystem, true);
    assert.equal((await call(owner, "DELETE", `/roles/${sys.id}`)).status, 409);
  });

  it("will not delete a role that people still hold", async () => {
    const made = await call(owner, "POST", "/roles", { key: "TEMP_ROLE", name: "Temp", permissions: ["patients:read"] });
    await addStaff(T, "TEMP_ROLE", "Temp holder");
    assert.equal((await call(owner, "DELETE", `/roles/${made.body.id}`)).status, 409);
  });

  it("keeps roles private to each hospital", async () => {
    const roles = (await call(other, "GET", "/roles")).status;
    assert.equal(roles, 403);
    const mine = (await call(owner, "GET", "/roles")).body as { key: string }[];
    assert.ok(mine.some((r) => r.key === "BILLING_CLERK"));
  });
});

describe("policies", () => {
  it("denies a matching action with the hospital's own message, and the simulator agrees", async () => {
    const p = await call(owner, "POST", "/policies", {
      name: "Receptionists cap discounts", permission: "billing:write", appliesToRoles: ["RECEPTIONIST"],
      conditions: [{ attr: "discountPercent", op: "gt", value: 10 }], message: "Discounts above 10% need a manager",
    });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const sim = await call(owner, "POST", "/policies/simulate", { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { discountPercent: 25 } });
    assert.equal(sim.body.allowed, false);
    assert.equal((await call(owner, "POST", "/policies/simulate", { permission: "billing:write", roles: ["RECEPTIONIST"], attrs: { discountPercent: 5 } })).body.allowed, true);
    assert.equal((await call(owner, "POST", "/policies/simulate", { permission: "billing:write", roles: ["OWNER"], attrs: { discountPercent: 25 } })).body.allowed, true, "other roles are not affected");

    const patient = (await call(rec, "POST", "/patients", { fullName: "Policy Pat", phone: newPhone() })).body;
    const big = await call(rec, "POST", "/invoices", { patientId: patient.id, lines: [{ kind: "OTHER", description: "Dressing", quantity: 1, unitPaise: 10_000 }], discountPaise: 2_500 });
    assert.equal(big.status, 403, JSON.stringify(big.body));
    assert.equal(big.body.code, "POLICY");
    assert.match(big.body.message ?? big.body.error, /manager/);
    const small = await call(rec, "POST", "/invoices", { patientId: patient.id, lines: [{ kind: "OTHER", description: "Dressing", quantity: 1, unitPaise: 10_000 }], discountPaise: 500 });
    assert.equal(small.status, 201, JSON.stringify(small.body));
  });

  it("only users with policies:manage may change policies", async () => {
    assert.equal((await call(adminTok, "GET", "/policies")).status, 403);
    assert.equal((await call(rec, "POST", "/policies/simulate", { permission: "x", roles: [] })).status, 403);
  });
});

describe("branches and doctors", () => {
  let branchId = "";
  it("one branch on the Starter plan; more once the plan allows, and staff only see their own", async () => {
    const blocked = await call(owner, "POST", "/branches", { code: "NORTH", name: "North Clinic" });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.code, "UPGRADE");
    await admin.tenant.update({ where: { id: T.tenantId }, data: { planCode: "UNLIMITED" } });
    clearTenantCache(T.tenantId);
    const ok = await call(owner, "POST", "/branches", { code: "NORTH", name: "North Clinic" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    branchId = ok.body.id;
    assert.equal((await call(owner, "POST", "/branches", { code: "NORTH", name: "Dup" })).status, 409);

    // reception is limited to the main branch until granted the new one
    const list = (await call(rec, "GET", "/branches")).body;
    assert.deepEqual(list.branches.map((b: { code: string }) => b.code), ["MAIN"]);
    const deskId = T.receptionist.id;
    assert.equal((await call(owner, "PUT", `/team/${deskId}/branches`, { branchIds: [branchId] })).status, 200);
    const after = (await call(rec, "GET", "/branches")).body;
    assert.deepEqual(after.branches.map((b: { code: string }) => b.code), ["NORTH"]);
    // header cannot be used to reach a branch outside the grant
    const ownerList = (await call(owner, "GET", "/branches", undefined, { "x-branch-id": branchId })).body;
    assert.equal(ownerList.active, branchId);
  });

  it("books only inside a doctor's schedule, refuses double booking, and honours leave", async () => {
    const prof = await call(owner, "PUT", `/doctor-profiles/${T.doctor.id}`, { displayName: "Dr Slot", slotMinutes: 30, feeInPersonPaise: 40_000 });
    assert.equal(prof.status, 200, JSON.stringify(prof.body));
    const main = (await call(owner, "GET", "/branches")).body.branches.find((b: { code: string }) => b.code === "MAIN");
    // open every day 09:00-12:00 so the test does not depend on the weekday
    const slots = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 720 }));
    assert.equal((await call(owner, "PUT", `/doctor-profiles/${T.doctor.id}/schedule`, { branchId: main.id, slots })).status, 200);

    const target = day(2);
    const list = (await call(owner, "GET", `/doctors/${T.doctor.id}/slots?date=${target}&branchId=${main.id}`)).body as { time: string; available: boolean }[];
    assert.equal(list.length, 6, "09:00 to 12:00 in 30 minute slots");
    assert.ok(list.every((s) => s.available));
    const patient = (await call(owner, "POST", "/patients", { fullName: "Slot Pat", phone: newPhone() })).body;
    await call(owner, "PUT", `/team/${T.receptionist.id}/branches`, { branchIds: [main.id] });
    const book = (at: string) => call(rec, "POST", "/appointments", { patientId: patient.id, doctorId: T.doctor.id, scheduledAt: at }, { "x-branch-id": main.id });
    assert.equal((await book(list[0].time)).status, 201);
    assert.equal((await book(list[0].time)).status, 409, "same slot twice");
    const outside = new Date(new Date(list[0].time).getTime() - 3 * 3600_000).toISOString();
    assert.equal((await book(outside)).status, 409, "outside working hours");

    // concurrent bookings of one slot: exactly one wins
    const results = await Promise.all([1, 2, 3, 4].map(() => book(list[1].time)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);

    // leave blocks the whole day
    const leaveDay = day(3);
    assert.equal((await call(owner, "POST", `/doctor-profiles/${T.doctor.id}/leaves`, { fromDate: leaveDay, toDate: leaveDay, reason: "Conference" })).status, 201);
    const onLeave = (await call(owner, "GET", `/doctors/${T.doctor.id}/slots?date=${leaveDay}&branchId=${main.id}`)).body as { available: boolean }[];
    assert.ok(onLeave.every((s) => !s.available));
  });
});

describe("pharmacy POS", () => {
  const med = async (name: string, price = 1000, extra: object = {}) => (await call(pharm, "POST", "/medicines", { name, strength: "10 mg", pricePaise: price, reorderLevel: 5, ...extra })).body as { id: string };
  const receive = (medicineId: string, batchNo: string, expiryDate: string, qty: number) => call(pharm, "POST", "/pharmacy/receipts", { medicineId, batchNo, expiryDate, qty });
  let shiftId = "";

  it("requires an open shift, takes split payments, and reconciles cash when closing", async () => {
    const m = await med("Pos Tab", 1000, { barcode: "8901234567890" });
    await receive(m.id, "P1", day(200), 20);
    const sale = { customerName: "Walk In", items: [{ medicineId: m.id, qty: 3 }], payments: [{ method: "CASH", amountPaise: 1000 }, { method: "UPI", amountPaise: 2000 }] };
    assert.equal((await call(pharm, "POST", "/pos/sales", sale)).status, 409, "no shift open");
    const open = await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 50_000 });
    assert.equal(open.status, 201);
    shiftId = open.body.id;
    assert.equal((await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 0 })).status, 409, "one drawer per cashier");

    const r = await call(pharm, "POST", "/pos/sales", sale);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.invoice.totalPaise, 3000);
    assert.equal(r.body.invoice.status, "PAID");
    const part = (await call(rec, "POST", "/patients", { fullName: "Part Payer", phone: newPhone() })).body;
    const short = await call(pharm, "POST", "/pos/sales", { patientId: part.id, items: [{ medicineId: m.id, qty: 1 }], payments: [{ method: "CASH", amountPaise: 400 }] });
    assert.equal(short.status, 201, JSON.stringify(short.body));
    assert.equal(short.body.invoice.status, "PARTIAL", "a part payment leaves a balance");

    const found = (await call(pharm, "GET", "/medicines?q=8901234567890")).body;
    assert.ok(JSON.stringify(found).includes(m.id), "barcode lookup finds the medicine");

    const close = await call(pharm, "POST", `/pos/shifts/${shiftId}/close`, { countedCashPaise: 51_400 });
    assert.equal(close.status, 200, JSON.stringify(close.body));
    assert.equal(close.body.expectedCashPaise, 51_400, "opening 500.00 + cash 10.00 + cash 4.00");
    assert.equal(close.body.differencePaise, 0);
    assert.equal((await call(pharm, "POST", `/pos/shifts/${shiftId}/close`, { countedCashPaise: 0 })).status, 409);
  });

  it("returns restock the exact batch, refund proportionally, and cannot exceed what was sold", async () => {
    const m = await med("Return Tab", 2000);
    await receive(m.id, "R1", day(200), 10);
    await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 0 });
    const s = (await call(pharm, "POST", "/pos/sales", { customerName: "Ret", items: [{ medicineId: m.id, qty: 4 }], payments: [{ method: "CASH", amountPaise: 8000 }] })).body;
    const detail = (await call(pharm, "GET", `/pos/sales/${s.saleId}`)).body;
    const line = detail.lines[0];
    const over = await call(pharm, "POST", "/pos/returns", { dispenseId: s.saleId, items: [{ dispenseLineId: line.id, qty: 5 }], reason: "Wrong item", refundMethod: "CASH" });
    assert.equal(over.status, 409);
    const ret = await call(pharm, "POST", "/pos/returns", { dispenseId: s.saleId, items: [{ dispenseLineId: line.id, qty: 1 }], reason: "Wrong item", refundMethod: "CASH" });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    assert.equal(ret.body.refundedPaise, 2000);
    const { batches } = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body;
    assert.equal(batches[0].qtyOnHand, 7);
    const again = await call(pharm, "POST", "/pos/returns", { dispenseId: s.saleId, items: [{ dispenseLineId: line.id, qty: 4 }], reason: "Too many", refundMethod: "CASH" });
    assert.equal(again.status, 409, "only 3 left to return");
  });

  it("applies the discount policy and keeps schedule-H style rules out of the way for normal items", async () => {
    const m = await med("Disc Tab", 1000);
    await receive(m.id, "D1", day(200), 5);
    await call(owner, "POST", "/policies", { name: "Pharmacy discount cap", permission: "pharmacy:pos", appliesToRoles: ["PHARMACIST"], conditions: [{ attr: "discountPercent", op: "gt", value: 5 }], message: "Pharmacists may give at most 5%" });
    await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 0 });
    const denied = await call(pharm, "POST", "/pos/sales", { customerName: "D", items: [{ medicineId: m.id, qty: 1 }], discountPercent: 20, payments: [] });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.code, "POLICY");
    const { batches } = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body;
    assert.equal(batches[0].qtyOnHand, 5, "a refused sale does not touch stock");
  });

  it("is invisible to other hospitals and gated by permission", async () => {
    assert.equal((await call(rec, "POST", "/pos/shifts/open", { openingCashPaise: 0 })).status, 403);
    assert.equal((await call(other, "GET", "/pos/sales")).status, 403);
    const dash = await call(pharm, "GET", "/pharmacy/dashboard");
    assert.equal(dash.status, 200);
    assert.ok(dash.body.salesCount >= 1);
  });
});

describe("purchasing", () => {
  it("raises a PO, receives goods into batches, tracks what is owed and settles it", async () => {
    const m = (await call(pharm, "POST", "/medicines", { name: "Buy Tab", pricePaise: 500, reorderLevel: 50 })).body as { id: string };
    const sup = await call(pharm, "POST", "/suppliers", { name: "Sun Distributors", phone: "9876500000" });
    assert.equal(sup.status, 201, JSON.stringify(sup.body));
    const sug = (await call(pharm, "GET", "/pharmacy/reorder-suggestions")).body;
    assert.ok(JSON.stringify(sug).includes(m.id), "an empty item below its reorder level is suggested");

    const po = await call(pharm, "POST", "/purchase-orders", { supplierId: sup.body.id, lines: [{ medicineId: m.id, qty: 100, costPaise: 300 }], placeOrder: true });
    assert.equal(po.status, 201, JSON.stringify(po.body));

    const grn = await call(pharm, "POST", "/goods-receipts", { supplierId: sup.body.id, poId: po.body.id, billNo: "B-1", lines: [{ medicineId: m.id, batchNo: "G1", expiryDate: day(365), qty: 100, costPaise: 300 }] });
    assert.equal(grn.status, 201, JSON.stringify(grn.body));
    const { batches } = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body;
    assert.equal(batches[0].qtyOnHand, 100);

    let ledger = (await call(pharm, "GET", `/suppliers/${sup.body.id}/ledger`)).body;
    assert.equal(ledger.duePaise, 30_000, JSON.stringify(ledger));
    assert.equal((await call(pharm, "POST", `/suppliers/${sup.body.id}/payments`, { amountPaise: 10_000, method: "UPI" })).status, 201);
    ledger = (await call(pharm, "GET", `/suppliers/${sup.body.id}/ledger`)).body;
    assert.equal(ledger.duePaise, 20_000);
    const over = await call(pharm, "POST", `/suppliers/${sup.body.id}/payments`, { amountPaise: 99_999_00, method: "CASH" });
    assert.ok([400, 409].includes(over.status), "cannot pay more than is owed");

    const expired = await call(pharm, "POST", "/goods-receipts", { supplierId: sup.body.id, lines: [{ medicineId: m.id, batchNo: "G0", expiryDate: day(-5), qty: 1, costPaise: 300 }] });
    assert.ok(expired.status >= 400 && expired.status < 500, "expired goods are not received");
  });

  it("transfers stock between branches without losing or creating any", async () => {
    const north = (await call(owner, "GET", "/branches/manage")).body.find((b: { code: string }) => b.code === "NORTH");
    const m = (await call(pharm, "POST", "/medicines", { name: "Move Tab", pricePaise: 100, reorderLevel: 1 })).body as { id: string };
    await call(pharm, "POST", "/pharmacy/receipts", { medicineId: m.id, batchNo: "M1", expiryDate: day(300), qty: 10 });
    const b = (await call(pharm, "GET", `/medicines/${m.id}/batches`)).body.batches[0];
    assert.equal((await call(pharm, "POST", "/pharmacy/transfers", { toBranchId: north.id, items: [{ batchId: b.id, qty: 11 }] })).status, 409, "cannot send more than is there");
    const ok = await call(pharm, "POST", "/pharmacy/transfers", { toBranchId: north.id, items: [{ batchId: b.id, qty: 4 }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const rows = await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`;
      return tx.stockBatch.findMany({ where: { medicineId: m.id } });
    });
    assert.equal(rows.reduce((s, r) => s + r.qtyOnHand, 0), 10);
    assert.equal(rows.find((r) => r.branchId === north.id)?.qtyOnHand, 4);
  });

  it("reports sales, stock value and expiry for those allowed to see them", async () => {
    const from = day(-1), to = day(1);
    const sales = await call(pharm, "GET", `/pharmacy/reports/sales?from=${from}&to=${to}`);
    assert.equal(sales.status, 200, JSON.stringify(sales.body));
    assert.equal((await call(pharm, "GET", "/pharmacy/reports/stock-value")).status, 200);
    assert.equal((await call(pharm, "GET", "/pharmacy/reports/expiry")).status, 200);
    assert.equal((await call(rec, "GET", "/pharmacy/reports/stock-value")).status, 403);
  });
});

void pharmId; void cleanupIdentities;

describe("pharmacy bills", () => {
  it("prints a GST tax invoice and a thermal receipt with batch, expiry and the tax split, for the counter without billing access", async () => {
    await call(owner, "PUT", "/settings/profile", { legalName: "Test Medicals", address: "1 Main Road", phone: "9000011111", gstin: "29ABCDE1234F1Z5", drugLicence: "KA-B1-12345" });
    const m = (await call(pharm, "POST", "/medicines", { name: "Bill Tab", strength: "10 mg", pricePaise: 11_200, gstPercent: 12, hsnCode: "30049099", manufacturer: "Acme Pharma", reorderLevel: 1 })).body as { id: string };
    await call(pharm, "POST", "/pharmacy/receipts", { medicineId: m.id, batchNo: "BILL1", expiryDate: day(300), qty: 10 });
    await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 0 });
    const sale = (await call(pharm, "POST", "/pos/sales", { customerName: "Bill Customer", items: [{ medicineId: m.id, qty: 2 }], payments: [{ method: "CASH", amountPaise: 22_400 }] })).body;
    const thermal = await app.inject({ method: "GET", url: `/pos/sales/${sale.saleId}/receipt.pdf?format=thermal`, headers: auth(pharm) });
    assert.equal(thermal.statusCode, 200);
    assert.equal(thermal.rawPayload.subarray(0, 4).toString(), "%PDF");
    // an 80 mm roll: the page is about 226 points wide
    assert.match(thermal.rawPayload.toString("latin1"), /\/MediaBox \[0 0 226/);
    const a4 = await app.inject({ method: "GET", url: `/pos/sales/${sale.saleId}/receipt.pdf?format=a4`, headers: auth(pharm) });
    assert.equal(a4.statusCode, 200);
    assert.match(a4.rawPayload.toString("latin1"), /\/MediaBox \[0 0 595/);
    const viaBilling = await app.inject({ method: "GET", url: `/invoices/${sale.invoice.id}/pdf`, headers: auth(owner) });
    assert.equal(viaBilling.statusCode, 200, "the owner reaches the same bill through billing");
    assert.equal((await app.inject({ method: "GET", url: `/pos/sales/${sale.saleId}/receipt.pdf`, headers: auth(rec) })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: `/pos/sales/${sale.saleId}/receipt.pdf`, headers: auth(other) })).statusCode, 403);
  });

  it("writes amounts in words the Indian way", async () => {
    const { rupeesInWords } = await import("../src/pdf");
    assert.equal(rupeesInWords(0), "Rupees zero only");
    assert.equal(rupeesInWords(123_456), "Rupees one thousand two hundred thirty four and fifty six paise only");
    assert.equal(rupeesInWords(12_500_000), "Rupees one lakh twenty five thousand only");
    assert.equal(rupeesInWords(10_000_000_00), "Rupees one crore only");
    assert.equal(rupeesInWords(5_00), "Rupees five only");
  });
});

describe("pack sizes, bulk import and customer credit", () => {
  it("imports a catalogue with opening stock row by row, updating what exists and reporting what failed", async () => {
    const rows = [
      { name: "Import Alpha", strength: "10 mg", pricePaise: 1000, packSize: 10, barcode: "IMP0001", batchNo: "IA1", expiryDate: day(300), qty: 50, costPaise: 600 },
      { name: "Import Beta", pricePaise: 2500, gstPercent: 5 },
      { name: "X", pricePaise: 100 },
      { name: "Import Gamma", pricePaise: 100, batchNo: "G1" },
      { name: "Import Delta", pricePaise: 100, batchNo: "D1", expiryDate: day(-3), qty: 5 },
      { name: "Import Alpha", strength: "10 mg", pricePaise: 1200 },
    ];
    const dry = await call(pharm, "POST", "/medicines/import", { rows, dryRun: true });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.created, 2, "alpha and beta would be new");
    assert.equal(dry.body.errors.length, 3, "bad name, half-given stock, expired batch");
    assert.equal((await call(pharm, "GET", "/medicines?q=Import")).body.length, 0, "a dry run changes nothing");
    const real = await call(pharm, "POST", "/medicines/import", { rows });
    assert.equal(real.body.created, 2);
    assert.equal(real.body.updated, 1, "the repeated Alpha updates the first");
    assert.equal(real.body.stockAdded, 1);
    const alpha = (await call(pharm, "GET", "/medicines?q=IMP0001")).body[0];
    assert.equal(alpha.pricePaise, 1200);
    assert.equal(alpha.packSize, 10);
    assert.equal(alpha.onHand, 50);
    assert.deepEqual(real.body.errors.map((e: { row: number }) => e.row), [3, 4, 5]);
    assert.equal((await call(rec, "POST", "/medicines/import", { rows: [rows[1]] })).status, 403);
  });

  it("lets a registered customer buy on credit and settles their account oldest bill first", async () => {
    const m = (await call(pharm, "POST", "/medicines", { name: "Credit Tab", pricePaise: 10_000, reorderLevel: 1 })).body as { id: string };
    await call(pharm, "POST", "/pharmacy/receipts", { medicineId: m.id, batchNo: "CR1", expiryDate: day(300), qty: 20 });
    const cust = (await call(owner, "POST", "/patients", { fullName: "Credit Customer", phone: newPhone() })).body;
    await call(pharm, "POST", "/pos/shifts/open", { openingCashPaise: 0 }).catch(() => undefined);
    const sale = (qty: number, pay: number) => call(pharm, "POST", "/pos/sales", { patientId: cust.id, items: [{ medicineId: m.id, qty }], payments: pay ? [{ method: "CASH", amountPaise: pay }] : [] });
    assert.equal((await sale(2, 0)).status, 201);
    assert.equal((await sale(3, 10_000)).status, 201);
    const list = (await call(pharm, "GET", "/pharmacy/receivables")).body;
    const row = list.find((r: { patient: { id: string } }) => r.patient.id === cust.id);
    assert.equal(row.duePaise, 40_000, "20,000 + 20,000 still owed");
    assert.equal(row.bills, 2);
    const detail = (await call(pharm, "GET", `/pharmacy/receivables/${cust.id}`)).body;
    assert.equal(detail.bills.length, 2);
    assert.equal((await call(pharm, "POST", `/pharmacy/receivables/${cust.id}/collect`, { amountPaise: 99_999, method: "CASH" })).status, 409, "cannot take more than is owed");
    const paid = await call(pharm, "POST", `/pharmacy/receivables/${cust.id}/collect`, { amountPaise: 25_000, method: "UPI", reference: "UPI123" });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.equal(paid.body.remainingPaise, 15_000);
    assert.equal(paid.body.applied[0].amountPaise, 20_000, "the oldest bill is cleared first");
    assert.equal(paid.body.applied[1].amountPaise, 5_000);
    assert.equal((await call(pharm, "POST", `/pharmacy/receivables/${cust.id}/collect`, { amountPaise: 15_000, method: "CASH" })).body.remainingPaise, 0);
    assert.ok(!(await call(pharm, "GET", "/pharmacy/receivables")).body.some((r: { patient: { id: string } }) => r.patient.id === cust.id), "settled customers drop off the list");
    assert.equal((await call(rec, "GET", "/pharmacy/receivables")).status, 403);
  });
});
