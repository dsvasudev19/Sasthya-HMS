// Platform Super Admin provision script. Runs as hms_migrator.
// Seeds or updates the platform super-admin (operator) credentials only.
// Real hospital organizations and organization admins are created via the Platform Portal.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@hms/auth";
import { PrismaClient } from "../generated/prisma/client";

const ADMIN_PHONE = process.env["PLATFORM_ADMIN_PHONE"] ?? process.env["SUPERADMIN_PHONE"] ?? "9000000000";
const ADMIN_PASSWORD = process.env["PLATFORM_ADMIN_PASSWORD"] ?? process.env["SUPERADMIN_PASSWORD"] ?? "Demo@12345";
const ADMIN_NAME = process.env["PLATFORM_ADMIN_NAME"] ?? "Swasthya Platform Admin";

const url = (process.env["MIGRATOR_DATABASE_URL"] ?? "").replace(/\?schema=.*$/, "");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function seedPlatformAdmin() {
  const hash = await hashPassword(ADMIN_PASSWORD);
  const identity = await db.identity.upsert({
    where: { phone: ADMIN_PHONE },
    update: { fullName: ADMIN_NAME, passwordHash: hash },
    create: { phone: ADMIN_PHONE, fullName: ADMIN_NAME, passwordHash: hash },
  });
  await db.platformAdmin.upsert({
    where: { identityId: identity.id },
    update: {},
    create: { identityId: identity.id },
  });
  console.log("=================================================");
  console.log(" Platform Super Admin credentials ready:");
  console.log(` Phone:    ${ADMIN_PHONE}`);
  console.log(` Password: ${ADMIN_PASSWORD}`);
  console.log("=================================================");
  console.log("Sign in at the Platform Admin portal to onboard organizations and assign organization admins.");
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
