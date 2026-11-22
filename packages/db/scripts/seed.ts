// Platform Super Admin provision script. Runs as hms_migrator.
// Seeds or updates the platform super-admin (operator) credentials only.
// Real hospital organizations and organization admins are created via the Platform Portal.
import "dotenv/config";
import { hashPassword } from "@hms/auth";
import { createAdminDb } from "../src";

const ADMIN_EMAIL = (process.env["PLATFORM_ADMIN_EMAIL"] ?? process.env["SUPERADMIN_EMAIL"] ?? "admin@swasthya.io").trim().toLowerCase();
const ADMIN_PHONE = process.env["PLATFORM_ADMIN_PHONE"] ?? process.env["SUPERADMIN_PHONE"] ?? "9000000000";
const ADMIN_PASSWORD = process.env["PLATFORM_ADMIN_PASSWORD"] ?? process.env["SUPERADMIN_PASSWORD"] ?? "Demo@12345";
const ADMIN_NAME = process.env["PLATFORM_ADMIN_NAME"] ?? "Swasthya Platform Admin";

const db = createAdminDb();

async function seedPlatformAdmin() {
  const hash = await hashPassword(ADMIN_PASSWORD);
  let identity = await db.identity.findFirst({
    where: { OR: [{ email: ADMIN_EMAIL }, { phone: ADMIN_PHONE }] },
  });

  if (identity) {
    identity = await db.identity.update({
      where: { id: identity.id },
      data: { email: ADMIN_EMAIL, phone: ADMIN_PHONE, fullName: ADMIN_NAME, passwordHash: hash },
    });
  } else {
    identity = await db.identity.create({
      data: { email: ADMIN_EMAIL, phone: ADMIN_PHONE, fullName: ADMIN_NAME, passwordHash: hash },
    });
  }

  await db.platformAdmin.upsert({
    where: { identityId: identity.id },
    update: {},
    create: { identityId: identity.id },
  });
  console.log("=================================================");
  console.log(" Platform Super Admin credentials ready:");
  console.log(` Email:    ${ADMIN_EMAIL}`);
  console.log(` Password: ${ADMIN_PASSWORD}`);
  console.log("=================================================");
  console.log("Sign in at the Platform Admin portal with email and password.");
}

async function main() {
  await seedPlatformAdmin();
}

main()
  .catch((e) => {
    console.error("Failed to seed platform admin:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
