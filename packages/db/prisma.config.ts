import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI always connects as the owner role (hms_migrator). The running app uses DATABASE_URL (hms_app).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["MIGRATOR_DATABASE_URL"],
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
