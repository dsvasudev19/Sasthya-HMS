import { randomBytes } from "node:crypto";
import { hashPassword } from "@hms/auth";
import { createAdminDb, createDb } from "@hms/db";
import { ConsoleProvider } from "@hms/notifications";
import { ensureMainBranch, ensureSystemRoles } from "@hms/db/access";
import { ensureDefaultCardPlans, ensureDefaultFeeItems, ensureDefaultLabTests } from "@hms/db/defaults";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../src/app";
import { LocalFileStore } from "../src/storage";

/** One throwaway, encrypted document store per test process. */
export const testStore = new LocalFileStore(mkdtempSync(path.join(tmpdir(), "hms-docs-")), "ab".repeat(32));

export const PASSWORD = "Test@12345";
const tag = () => randomBytes(3).toString("hex");

// Fixtures are created and removed as the owner role (hms_migrator); the app under test uses the DML-only role.
export const admin = createAdminDb();
export const appDb = createDb();

export const provider = new ConsoleProvider();

export async function makeApp() {
  return buildApp(appDb, { jwtSecret: "test-secret-test-secret-test-secret-1234", provider, store: testStore, rateLimit: false, systemLog: false, logger: false });
}

export interface Fixture {
  tenantId: string;
  slug: string;
  receptionist: { phone: string; id: string };
  doctor: { phone: string; id: string };
  extra: string[];
}

let phoneSeq = Math.floor(Math.random() * 90_000_000) + 10_000_000;
export const newPhone = () => `7${String(phoneSeq++).padStart(9, "0")}`;

export type StaffRole = string;

export async function addStaff(f: Fixture, role: StaffRole, fullName: string): Promise<{ phone: string; id: string }> {
  const phone = newPhone();
  const identity = await admin.identity.create({ data: { phone, fullName, passwordHash: await hashPassword(PASSWORD) } });
  await admin.tenantMembership.create({ data: { tenantId: f.tenantId, identityId: identity.id, role } });
  f.extra.push(identity.id);
  return { phone, id: identity.id };
}

export async function makeTenant(name: string): Promise<Fixture> {
  const slug = `t-${name}-${tag()}`;
  const tenant = await admin.tenant.create({ data: { slug, name: `Test ${name}`, kind: "HOSPITAL", status: "ACTIVE", planCode: "STARTER" } });
  await ensureSystemRoles(admin, tenant.id);
  const hash = await hashPassword(PASSWORD);
  const mk = async (role: "RECEPTIONIST" | "DOCTOR", fullName: string) => {
    const phone = newPhone();
    const identity = await admin.identity.create({ data: { phone, fullName, passwordHash: hash } });
    await admin.tenantMembership.create({ data: { tenantId: tenant.id, identityId: identity.id, role } });
    return { phone, id: identity.id };
  };
  const receptionist = await mk("RECEPTIONIST", `Desk ${name}`);
  const doctor = await mk("DOCTOR", `Dr ${name}`);
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    await ensureMainBranch(tx, tenant.id, `Test ${name}`);
    await ensureDefaultCardPlans(tx, tenant.id);
    await ensureDefaultFeeItems(tx, tenant.id);
    await ensureDefaultLabTests(tx, tenant.id);
  });
  return { tenantId: tenant.id, slug, receptionist, doctor, extra: [] };
}

export async function cleanupTenant(f: Fixture) {
  await admin.staffBranch.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.userAccessOverride.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantFeatureOverride.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantAgreement.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantProfile.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantLimits.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantSecurity.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenantId}, true)`;
    await tx.claimEvent.deleteMany();
    await tx.claim.deleteMany();
    await tx.patientPolicy.deleteMany();
    await tx.payer.deleteMany();
    await tx.surgery.deleteMany();
    await tx.theatre.deleteMany();
    await tx.erVisit.deleteMany();
    await tx.shift.deleteMany();
    await tx.attendance.deleteMany();
    await tx.leaveRequest.deleteMany();
    await tx.doctorShare.deleteMany();
    await tx.doctorPayout.deleteMany();
    await tx.feedback.deleteMany();
    await tx.reportRun.deleteMany();
    await tx.reportSchedule.deleteMany();
    await tx.admissionNote.deleteMany();
    await tx.bedStay.deleteMany();
    await tx.admission.deleteMany();
    await tx.bed.deleteMany();
    await tx.ward.deleteMany();
    await tx.task.deleteMany();
    await tx.patientDocument.deleteMany();
    await tx.teleSession.deleteMany();
    await tx.saleReturnLine.deleteMany();
    await tx.saleReturn.deleteMany();
    await tx.supplierPayment.deleteMany();
    await tx.goodsReceiptLine.deleteMany();
    await tx.goodsReceipt.deleteMany();
    await tx.purchaseOrderLine.deleteMany();
    await tx.purchaseOrder.deleteMany();
    await tx.supplier.deleteMany();
    await tx.message.deleteMany();
    await tx.tenantSetting.deleteMany();
    await tx.labOrderItem.deleteMany();
    await tx.labOrder.deleteMany();
    await tx.labTest.deleteMany();
    await tx.dispenseLine.deleteMany();
    await tx.dispense.deleteMany();
    await tx.posShift.deleteMany();
    await tx.stockMovement.deleteMany();
    await tx.stockBatch.deleteMany();
    await tx.prescriptionItem.deleteMany();
    await tx.consultation.deleteMany();
    await tx.medicine.deleteMany();
    await tx.refund.deleteMany();
    await tx.paymentLink.deleteMany();
    await tx.payment.deleteMany();
    await tx.invoiceLine.deleteMany();
    await tx.invoice.deleteMany();
    await tx.dailyClosing.deleteMany();
    await tx.feeItem.deleteMany();
    await tx.counter.deleteMany();
    await tx.benefitUsage.deleteMany();
    await tx.cardSubscription.deleteMany();
    await tx.healthCardMember.deleteMany();
    await tx.healthCard.deleteMany();
    await tx.healthCardPlan.deleteMany();
    await tx.appointment.deleteMany();
    await tx.patient.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.doctorLeave.deleteMany();
    await tx.doctorSchedule.deleteMany();
    await tx.doctorProfile.deleteMany();
    await tx.branch.deleteMany();
  });
  await admin.tenantPolicy.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.platformInvoice.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.patientLink.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantMembership.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenantRole.deleteMany({ where: { tenantId: f.tenantId } });
  await admin.tenant.delete({ where: { id: f.tenantId } });
  await admin.refreshToken.deleteMany({ where: { identityId: { in: [f.receptionist.id, f.doctor.id, ...f.extra] } } });
  await admin.identityMfa.deleteMany({ where: { identityId: { in: [f.receptionist.id, f.doctor.id, ...f.extra] } } });
  await admin.identity.deleteMany({ where: { id: { in: [f.receptionist.id, f.doctor.id, ...f.extra] } } });
}

export async function cleanupIdentities(phones: string[]) {
  await admin.patientLink.deleteMany({ where: { identity: { phone: { in: phones } } } });
  await admin.refreshToken.deleteMany({ where: { identity: { phone: { in: phones } } } });
  await admin.identityMfa.deleteMany({ where: { identity: { phone: { in: phones } } } });
  await admin.identity.deleteMany({ where: { phone: { in: phones } } });
  await admin.otpChallenge.deleteMany({ where: { phone: { in: phones } } });
}

type App = Awaited<ReturnType<typeof makeApp>>;

export async function staffToken(app: App, phone: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { phone, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().token;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export async function patientToken(app: App, phone: string): Promise<string> {
  const req = await app.inject({ method: "POST", url: "/patient/otp/request", payload: { phone } });
  const { devCode } = req.json();
  const res = await app.inject({ method: "POST", url: "/patient/otp/verify", payload: { phone, code: devCode } });
  if (res.statusCode !== 200) throw new Error(`otp failed: ${res.body}`);
  return res.json().token;
}
