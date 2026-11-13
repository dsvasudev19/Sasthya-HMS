// CI guard for the shared-schema tenancy model. Fails (exit 1) when the migrated database breaks a rule.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env["MIGRATOR_DATABASE_URL"] });
const problems: string[] = [];

async function main() {
  await client.connect();

  // 1. Nothing may live in public.
  const pub = await client.query(
    `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S','f','p')`,
  );
  for (const r of pub.rows) problems.push(`object in public schema: public.${r.relname}`);

  // 2. Every table in hms: tenant_id NOT NULL, RLS enabled + forced, at least one policy.
  const tables = await client.query(
    `SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c WHERE c.relnamespace = 'hms'::regnamespace AND c.relkind IN ('r','p')`,
  );
  for (const t of tables.rows) {
    const col = await client.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='hms' AND table_name=$1 AND column_name='tenant_id'`,
      [t.relname],
    );
    if (col.rowCount === 0) problems.push(`hms.${t.relname}: missing tenant_id`);
    else if (col.rows[0].is_nullable !== "NO") problems.push(`hms.${t.relname}: tenant_id must be NOT NULL`);
    if (!t.relrowsecurity) problems.push(`hms.${t.relname}: row-level security not enabled`);
    if (!t.relforcerowsecurity) problems.push(`hms.${t.relname}: row-level security not forced`);
    const pol = await client.query(`SELECT 1 FROM pg_policies WHERE schemaname='hms' AND tablename=$1`, [t.relname]);
    if (pol.rowCount === 0) problems.push(`hms.${t.relname}: no RLS policy`);
  }

  // 3. The app role must be unable to bypass RLS or create objects.
  const role = await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='hms_app'`);
  if (role.rowCount === 0) problems.push("role hms_app does not exist");
  else if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) problems.push("hms_app must not be superuser or BYPASSRLS");
  for (const s of ["platform", "hms", "ext"]) {
    const can = await client.query(`SELECT has_schema_privilege('hms_app', $1, 'CREATE') AS can`, [s]);
    if (can.rows[0].can) problems.push(`hms_app can CREATE in schema ${s}`);
  }

  console.log(`checked ${tables.rowCount} tenant tables in hms`);
}

main()
  .catch((e) => problems.push(`check crashed: ${e.message}`))
  .finally(async () => {
    await client.end();
    if (problems.length) {
      console.error("DB policy check FAILED:\n - " + problems.join("\n - "));
      process.exit(1);
    }
    console.log("DB policy check passed");
  });
