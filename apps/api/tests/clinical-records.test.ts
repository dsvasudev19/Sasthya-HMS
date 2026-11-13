import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addStaff, admin, appDb, auth, cleanupIdentities, cleanupTenant, makeApp, makeTenant, newPhone, patientToken, staffToken, testStore, type Fixture } from "./helpers";

type App = Awaited<ReturnType<typeof makeApp>>;
let app: App, T: Fixture, O: Fixture;
let rec: string, doc: string, nurse: string, owner: string, other: string, clerk: string;
const patientPhone = newPhone();

// 1x1 PNG and a tiny PDF: real magic bytes, so the content sniffing is exercised for real.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const pdfBytes = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);

const multipart = (file: { name: string; bytes: Buffer }, fields: Record<string, string> = {}) => {
  const b = "----hmsboundary" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
};
const upload = (token: string, patientId: string, file: { name: string; bytes: Buffer }, fields: Record<string, string> = {}) => {
  const m = multipart(file, fields);
  return app.inject({ method: "POST", url: `/patients/${patientId}/documents`, headers: { ...auth(token), ...m.headers }, payload: m.payload });
};
const call = async (token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(token), payload: payload as object | undefined });
  const isJson = String(res.headers["content-type"]).includes("json");
  return { status: res.statusCode, body: isJson ? res.json() : null, raw: res.rawPayload };
};
const HOUR = 3600_000;
// Fixtures are read as the owner role, which is still subject to row level security: say which hospital to look at.
const inTenant = <R>(fn: (tx: typeof admin) => Promise<R>) => admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.tenantId}, true)`; return fn(tx as unknown as typeof admin); });

before(async () => {
  app = await makeApp();
  T = await makeTenant("rec"); O = await makeTenant("rec2");
  await admin.tenant.update({ where: { id: T.tenantId }, data: { planCode: "UNLIMITED" } });
  const n = await addStaff(T, "NURSE", "Nurse"); const w = await addStaff(T, "OWNER", "Owner");
  rec = await staffToken(app, T.receptionist.phone); doc = await staffToken(app, T.doctor.phone);
  nurse = await staffToken(app, n.phone); owner = await staffToken(app, w.phone); other = await staffToken(app, O.receptionist.phone);
  await call(owner, "POST", "/roles", { key: "NO_DOCS", name: "No docs", permissions: ["patients:read", "clinical:read"] });
  clerk = await staffToken(app, (await addStaff(T, "NO_DOCS", "Clerk")).phone);
});
after(async () => {
  await cleanupTenant(T); await cleanupTenant(O); await cleanupIdentities([patientPhone]);
  await app.close(); await admin.$disconnect(); await appDb.$disconnect();
});

const newPatient = async (name: string, phone = newPhone()) => (await call(rec, "POST", "/patients", { fullName: name, phone })).body as { id: string };
const visit = async (patientId: string, o: { channel?: "TELE"; at?: number } = {}) => {
  const a = (await call(rec, "POST", "/appointments", { patientId, doctorId: T.doctor.id, channel: o.channel, scheduledAt: new Date(Date.now() + (o.at ?? HOUR)).toISOString() })).body as { id: string };
  return a.id;
};

describe("documents", () => {
  it("a nurse scans a prescription into the record; it is encrypted at rest and comes back byte for byte", async () => {
    const p = await newPatient("Scan Patient");
    const a = await visit(p.id);
    const res = await upload(nurse, p.id, { name: "rx page 1.png", bytes: PNG }, { kind: "PRESCRIPTION_SCAN", appointmentId: a, title: "Outside prescription" });
    assert.equal(res.statusCode, 201, res.body);
    const d = res.json();
    assert.equal(d.mimeType, "image/png");
    assert.equal(d.kind, "PRESCRIPTION_SCAN");
    const row = await inTenant((tx) => tx.patientDocument.findUniqueOrThrow({ where: { id: d.id } }));
    const onDisk = await import("node:fs/promises").then(async (fs) => fs.readFile(await locate(row.storageKey)));
    assert.ok(!onDisk.includes(PNG), "the stored file is not the plain image");
    const got = await call(nurse, "GET", `/documents/${d.id}/file`);
    assert.equal(got.status, 200);
    assert.ok(got.raw.equals(PNG), "the same bytes come back");
    assert.equal((await call(nurse, "GET", `/patients/${p.id}/documents?appointmentId=${a}`)).body.length, 1);
    assert.ok((await inTenant((tx) => tx.auditLog.count({ where: { action: "document.view", entityId: d.id } }))) >= 1, "viewing is audited");
  });

  it("stores the same scan once, refuses fakes and oversize files, and needs the permission", async () => {
    const p = await newPatient("Dup Patient");
    const first = await upload(nurse, p.id, { name: "a.pdf", bytes: pdfBytes("dup") });
    const again = await upload(nurse, p.id, { name: "a-copy.pdf", bytes: pdfBytes("dup") });
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().id, first.json().id);
    assert.equal(again.json().duplicate, true);
    assert.equal((await upload(nurse, p.id, { name: "virus.png", bytes: Buffer.from("MZ not an image at all") })).statusCode, 415, "judged by content, not name");
    assert.equal((await upload(nurse, p.id, { name: "big.pdf", bytes: Buffer.concat([pdfBytes("big"), Buffer.alloc(11 * 1024 * 1024)]) })).statusCode, 413);
    assert.equal((await upload(clerk, p.id, { name: "x.pdf", bytes: pdfBytes("x") })).statusCode, 403);
    assert.equal((await call(clerk, "GET", `/patients/${p.id}/documents`)).status, 403);
  });

  it("is invisible to other hospitals; removing hides but never deletes", async () => {
    const p = await newPatient("Private Patient");
    const d = (await upload(rec, p.id, { name: "id.pdf", bytes: pdfBytes("private") }, { kind: "ID_PROOF" })).json();
    const status = (await call(other, "GET", `/documents/${d.id}/file`)).status;
    assert.equal(status, 404, "another hospital cannot reach it");
    assert.equal((await call(rec, "DELETE", `/documents/${d.id}`, {})).status, 400, "a reason is required");
    assert.equal((await call(rec, "DELETE", `/documents/${d.id}`, { reason: "Wrong patient" })).status, 200);
    assert.equal((await call(rec, "GET", `/documents/${d.id}/file`)).status, 404);
    assert.equal((await call(rec, "GET", `/patients/${p.id}/documents`)).body.length, 0);
    const row = await inTenant((tx) => tx.patientDocument.findUniqueOrThrow({ where: { id: d.id } }));
    assert.ok(row.removedAt && row.removedBy, "the row is kept with who removed it");
    await assert.rejects(() => appDb.$executeRawUnsafe(`DELETE FROM hms.documents WHERE id = '${d.id}'`), "the app role cannot hard-delete records");
  });
});

describe("clinical history and prescriptions", () => {
  it("shows a patient's whole history on a new visit, including allergies, vitals over time and files", async () => {
    const p = await newPatient("History Patient");
    assert.equal((await call(doc, "PUT", `/patients/${p.id}/clinical-profile`, { bloodGroup: "B+", allergies: ["Penicillin"], chronicConditions: ["Type 2 diabetes"] })).status, 200);
    const a1 = await visit(p.id);
    await call(rec, "PATCH", `/appointments/${a1}`, { status: "CHECKED_IN" });
    await call(nurse, "PUT", `/appointments/${a1}/vitals`, { bpSystolic: 150, bpDiastolic: 95, weightKg: 70 });
    await call(doc, "PUT", `/appointments/${a1}/consultation`, { diagnosis: "Hypertension", items: [{ name: "Amlodipine", dose: "5 mg", frequency: "Once a day", durationDays: 30, quantity: 30 }] });
    assert.equal((await call(doc, "POST", `/appointments/${a1}/consultation/complete`)).status, 200);
    await upload(nurse, p.id, { name: "old-report.pdf", bytes: pdfBytes("history") }, { kind: "LAB_REPORT" });

    const a2 = await visit(p.id, { at: 2 * HOUR });
    await call(rec, "PATCH", `/appointments/${a2}`, { status: "CHECKED_IN" });
    await call(nurse, "PUT", `/appointments/${a2}/vitals`, { bpSystolic: 138, bpDiastolic: 88, weightKg: 69 });
    const h = (await call(doc, "GET", `/patients/${p.id}/history?exclude=${a2}`)).body;
    assert.deepEqual(h.patient.allergies, ["Penicillin"]);
    assert.equal(h.patient.bloodGroup, "B+");
    assert.equal(h.counts.visits, 1);
    const visitEv = h.events.find((e: { type: string }) => e.type === "VISIT");
    assert.equal(visitEv.diagnosis, "Hypertension");
    assert.equal(visitEv.items[0].name, "Amlodipine");
    assert.ok(visitEv.rxNo?.startsWith("RX-"), "a signed visit has a prescription number");
    assert.ok(h.events.some((e: { type: string; kind?: string }) => e.type === "DOCUMENT" && e.kind === "LAB_REPORT"));
    assert.equal(h.vitals.length, 1, "the visit being written is excluded from the trend");
    assert.equal((await call(rec, "GET", `/patients/${p.id}/history`)).status, 403, "reception cannot read clinical history");
    assert.ok((await inTenant((tx) => tx.auditLog.count({ where: { action: "history.view", entityId: p.id } }))) >= 1, "access to a record is audited");
  });

  it("prints a digital prescription, signs it with a verifiable code, and freezes it", async () => {
    const p = await newPatient("Rx Patient", patientPhone);
    const a = await visit(p.id);
    await call(rec, "PATCH", `/appointments/${a}`, { status: "CHECKED_IN" });
    const saved = (await call(doc, "PUT", `/appointments/${a}/consultation`, { complaints: "Cough", diagnosis: "Bronchitis", advice: "Steam inhalation", items: [{ name: "Azithromycin", dose: "500 mg", frequency: "Once a day", durationDays: 3, quantity: 3 }] })).body;
    const draft = await call(doc, "GET", `/consultations/${saved.id}/prescription.pdf`);
    assert.equal(draft.status, 200);
    assert.equal(draft.raw.subarray(0, 4).toString(), "%PDF", "a draft can be previewed before signing");
    const done = (await call(doc, "POST", `/appointments/${a}/consultation/complete`)).body;
    assert.match(done.rxNo, /^RX-[A-Z0-9]+-\d{4}-\d{5}$/);
    assert.match(done.rxCode, /^[0-9A-F]{12}$/);
    const signed = await call(doc, "GET", `/consultations/${saved.id}/prescription.pdf`);
    assert.equal(signed.status, 200);
    assert.ok(signed.raw.toString("latin1").includes("/XObject") && !draft.raw.toString("latin1").includes("/XObject"), "only the signed copy carries the verification QR");
    assert.equal((await call(doc, "PUT", `/appointments/${a}/consultation`, { diagnosis: "Changed after signing" })).status, 409, "frozen once signed");

    const v = await app.inject({ method: "GET", url: `/public/rx/${T.tenantId}/${done.rxCode}` });
    const vb = v.json();
    assert.equal(vb.valid, true);
    assert.equal(vb.items[0].name, "Azithromycin");
    assert.ok(!JSON.stringify(vb).includes("Bronchitis") && !JSON.stringify(vb).includes("Rx Patient"), "verification does not leak the diagnosis or the full name");
    assert.equal((await app.inject({ method: "GET", url: `/public/rx/${T.tenantId}/000000000000` })).json().valid, false);
    assert.equal((await app.inject({ method: "GET", url: `/public/rx/${T.tenantId}/not-a-code` })).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: `/public/rx/${O.tenantId}/${done.rxCode}` })).json().valid, false, "a code only verifies at its own hospital");
  });

  it("lets the patient see their own prescription and files in the app, but not hidden ones", async () => {
    const p = await inTenant((tx) => tx.patient.findFirstOrThrow({ where: { phone: patientPhone } }));
    const tok = await patientToken(app, patientPhone);
    assert.equal((await app.inject({ method: "POST", url: `/patient/hospitals/${T.tenantId}/join`, headers: auth(tok), payload: {} })).statusCode, 201);
    const shown = (await upload(rec, p.id, { name: "visible.pdf", bytes: pdfBytes("shown") })).json();
    const hidden = (await upload(rec, p.id, { name: "internal.pdf", bytes: pdfBytes("hidden") }, { visibleToPatient: "false" })).json();
    const list = (await app.inject({ method: "GET", url: "/patient/documents", headers: auth(tok) })).json();
    assert.deepEqual(list.map((d: { id: string }) => d.id), [shown.id]);
    assert.equal((await app.inject({ method: "GET", url: `/patient/documents/${T.tenantId}/${shown.id}/file`, headers: auth(tok) })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `/patient/documents/${T.tenantId}/${hidden.id}/file`, headers: auth(tok) })).statusCode, 404);
    const c = await inTenant((tx) => tx.consultation.findFirstOrThrow({ where: { patientId: p.id, completedAt: { not: null } } }));
    const pdf = await app.inject({ method: "GET", url: `/patient/prescriptions/${T.tenantId}/${c.id}/pdf`, headers: auth(tok) });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.rawPayload.subarray(0, 4).toString(), "%PDF");

    // a phone hands the PDF to its viewer through a short-lived link instead of a login header
    const lnk = (await app.inject({ method: "POST", url: `/patient/prescriptions/${T.tenantId}/${c.id}/link`, headers: auth(tok) })).json();
    const path = new URL(lnk.url).pathname;
    const viaLink = await app.inject({ method: "GET", url: path });
    assert.equal(viaLink.statusCode, 200);
    assert.equal(viaLink.rawPayload.subarray(0, 4).toString(), "%PDF");
    assert.equal((await app.inject({ method: "GET", url: path.slice(0, -3) + "abc" })).statusCode >= 400, true, "a tampered link is refused");
    const dlink = (await app.inject({ method: "POST", url: `/patient/documents/${T.tenantId}/${shown.id}/link`, headers: auth(tok) })).json();
    assert.equal((await app.inject({ method: "GET", url: new URL(dlink.url).pathname })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/patient/documents/${T.tenantId}/${hidden.id}/link`, headers: auth(tok) })).statusCode, 404, "hidden files cannot be linked");
    const staffTok = (await app.inject({ method: "POST", url: "/auth/login", payload: { phone: T.receptionist.phone, password: "Test@12345" } })).json().token;
    assert.equal((await app.inject({ method: "GET", url: `/dl/${staffTok}` })).statusCode, 403, "a normal session token is not a download link");
  });
});

describe("tele-consultation", () => {
  it("runs a video visit: patient waits, doctor opens the room, the patient is told, the call ends", async () => {
    const phone = newPhone();
    const p = await newPatient("Tele Patient", phone);
    const a = await visit(p.id, { channel: "TELE", at: 5 * 60_000 });
    const tok = await patientToken(app, phone);
    await app.inject({ method: "POST", url: `/patient/hospitals/${T.tenantId}/join`, headers: auth(tok), payload: {} });

    const early = await app.inject({ method: "POST", url: `/patient/appointments/${T.tenantId}/${a}/tele/join`, headers: auth(tok) });
    assert.equal(early.statusCode, 200, early.body);
    assert.equal(early.json().doctorPresent, false);
    const room = new URL(early.json().url).pathname.slice(1);
    assert.match(room, /^swasthya-[0-9a-f]{24}$/, "an unguessable room name");
    assert.equal((await call(doc, "GET", `/appointments/${a}/tele`)).body.session.status, "WAITING");
    assert.equal((await call(rec, "POST", `/appointments/${a}/tele/start`)).status, 403, "only people who may run video visits");

    const start = await call(doc, "POST", `/appointments/${a}/tele/start`);
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.patientWaiting, true);
    assert.equal(new URL(start.body.url).pathname.slice(1), room, "both sides meet in the same room");
    assert.equal((await inTenant((tx) => tx.message.count({ where: { template: "TELE_READY", patientId: p.id } }))), 1, "the patient is nudged once");
    await call(doc, "POST", `/appointments/${a}/tele/start`);
    assert.equal((await inTenant((tx) => tx.message.count({ where: { template: "TELE_READY", patientId: p.id } }))), 1, "not nudged again on a rejoin");
    assert.equal((await app.inject({ method: "POST", url: `/patient/appointments/${T.tenantId}/${a}/tele/join`, headers: auth(tok) })).json().doctorPresent, true);
    const schedule = (await call(doc, "GET", "/tele/schedule")).body as { id: string; tele: { status: string } }[];
    assert.equal(schedule.find((s) => s.id === a)?.tele.status, "LIVE");

    // the visit continues as a normal consultation
    assert.equal((await call(doc, "PUT", `/appointments/${a}/consultation`, { diagnosis: "Viral fever" })).status, 200);
    const end = await call(doc, "POST", `/appointments/${a}/tele/end`);
    assert.equal(end.status, 200);
    assert.ok(end.body.minutes >= 1);
    assert.equal((await call(doc, "POST", `/appointments/${a}/tele/end`)).status, 409, "already ended");
  });

  it("keeps the room closed outside the join window, for in-person visits, and for other patients", async () => {
    const phone = newPhone();
    const p = await newPatient("Window Patient", phone);
    const later = await visit(p.id, { channel: "TELE", at: 2 * 24 * HOUR });
    const inPerson = await visit(p.id, { at: 3 * HOUR });
    const tok = await patientToken(app, phone);
    await app.inject({ method: "POST", url: `/patient/hospitals/${T.tenantId}/join`, headers: auth(tok), payload: {} });
    assert.equal((await app.inject({ method: "POST", url: `/patient/appointments/${T.tenantId}/${later}/tele/join`, headers: auth(tok) })).statusCode, 409, "too early");
    assert.equal((await call(doc, "POST", `/appointments/${later}/tele/start`)).status, 409, "too early for the doctor too");
    assert.equal((await app.inject({ method: "POST", url: `/patient/appointments/${T.tenantId}/${inPerson}/tele/join`, headers: auth(tok) })).statusCode, 409, "not a video appointment");
    const stranger = await patientToken(app, newPhone());
    assert.equal((await app.inject({ method: "POST", url: `/patient/appointments/${T.tenantId}/${later}/tele/join`, headers: auth(stranger) })).statusCode, 403);
    await cleanupIdentities([phone]);
  });
});

import { createHash } from "node:crypto";
// Finds the file a storage key points at (the test store is a private temp directory).
async function locate(key: string) {
  const dir = (testStore as unknown as { dir: string }).dir;
  void createHash;
  return `${dir}/${key}`;
}

describe("tele join links", () => {
  it("signs a token that names the person and makes only the doctor a moderator", async () => {
    const { teleJoinUrl } = await import("../src/tele");
    const env = { TELE_BASE_URL: "https://video.example.org", TELE_JWT_APP_ID: "swasthya", TELE_JWT_SECRET: "s3cret-s3cret-s3cret" };
    const claims = (url: string) => JSON.parse(Buffer.from(new URL(url).searchParams.get("jwt")!.split(".")[1]!, "base64url").toString());
    const doctor = teleJoinUrl({ room: "swasthya-abc", name: "Dr Rao", moderator: true, env });
    const patient = teleJoinUrl({ room: "swasthya-abc", name: "Lakshmi", moderator: false, env });
    assert.equal(claims(doctor).context.user.moderator, true);
    assert.equal(claims(patient).context.user.moderator, false);
    assert.equal(claims(patient).room, "swasthya-abc");
    assert.equal(claims(patient).sub, "video.example.org");
    const { createHmac } = await import("node:crypto");
    const [h, b, sig] = new URL(doctor).searchParams.get("jwt")!.split(".");
    assert.equal(sig, createHmac("sha256", env.TELE_JWT_SECRET).update(`${h}.${b}`).digest("base64url"), "the signature verifies with the shared secret");
    assert.ok(!teleJoinUrl({ room: "r", name: "x", moderator: false, env: {} }).includes("jwt="), "without a secret it falls back to a plain room link");
  });
});
