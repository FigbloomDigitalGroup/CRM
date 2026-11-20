/**
 * Post-migration verification (FIG-1603, P2-20 section C.5). Prints a pass or fail report; exit 1 on any failure.
 * It prints table names, counts and check results only: never a row, a connection string or a password.
 *
 *   # before the migration (owner connection, direct URL):
 *   DATABASE_URL=... npm run verify:migration -- --snapshot-out before.json
 *   # after migrate:deploy:direct and db:grant-role:
 *   DATABASE_URL=... APP_DATABASE_URL=... npm run verify:migration -- --snapshot before.json
 *
 * DATABASE_URL is the schema owner (so row-level security does not hide rows). APP_DATABASE_URL (optional) is the figbloom_app login; with it the
 * script also reads as the app does: inside one organisation, and with none set.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { APP_ROLE_NO_ACCESS_CREDENTIAL_TABLES, APP_ROLE_USER_READABLE_COLUMNS, USER_CREDENTIAL_COLUMNS } from "./lib/appRoleCredentialGrants";
import { evaluate, formatReport, type CredentialGrantState, type TableState } from "./lib/migrationVerify";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ident = (n: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`unsafe identifier ${n}`);
  return `"${n}"`;
};
const clean = (e: unknown) => (e as Error).message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "<url>");

async function main() {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL (the owner connection) is required");
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const role = await owner.query(`SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app'`);
    const appRoleExists = role.rowCount === 1;
    const meta = await owner.query(
      `SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
        EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organization_id') AS has_org,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
        CASE WHEN $1::boolean THEN has_table_privilege('figbloom_app', c.oid, 'SELECT') ELSE false END AS app_select
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' ORDER BY c.relname`,
      [appRoleExists],
    );

    const tables: TableState[] = [];
    await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const r of meta.rows) {
      const n = await owner.query(`SELECT count(*)::int AS n FROM ${ident(r.name)}`);
      tables.push({
        name: r.name,
        rows: n.rows[0].n,
        hasOrganizationId: r.has_org,
        rlsEnabled: r.rls,
        rlsForced: r.forced,
        policies: r.policies,
        appCanSelect: r.app_select,
      });
    }
    await owner.query("COMMIT");

    const snapOut = arg("--snapshot-out");
    if (snapOut) {
      writeFileSync(
        snapOut,
        JSON.stringify({ takenAt: new Date().toISOString(), counts: Object.fromEntries(tables.map((t) => [t.name, t.rows])) }, null, 2),
      );
      console.log(`Snapshot of ${tables.length} table counts written to ${snapOut} (counts only, no row data).`);
    }
    const snapIn = arg("--snapshot");
    if (snapOut && !snapIn) return; // taking the "before" snapshot only: nothing to judge yet
    const before = snapIn ? (JSON.parse(readFileSync(snapIn, "utf8")).counts as Record<string, number>) : undefined;

    let appRead;
    const appUrl = process.env.APP_DATABASE_URL;
    if (appUrl) {
      const org = await owner
        .query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)
        .catch(() => ({ rows: [] as { id: string }[] }));
      const app = new Client({ connectionString: appUrl });
      try {
        await app.connect();
        let own = true; // an empty database has nothing to read
        let noOrg = 0;
        if (org.rows[0]) {
          await app.query("BEGIN");
          await app.query(`SELECT set_config('app.current_organization_id', $1, true)`, [org.rows[0].id]);
          own = (await app.query(`SELECT count(*)::int AS n FROM organizations WHERE id = $1`, [org.rows[0].id])).rows[0].n === 1;
          await app.query("ROLLBACK");
        }
        for (const t of tables.filter((x) => x.hasOrganizationId && x.rows > 0).slice(0, 8)) {
          noOrg += (await app.query(`SELECT count(*)::int AS n FROM ${ident(t.name)}`)).rows[0].n;
        }
        appRead = { connected: true, ownOrgVisible: own, noOrgSeesRows: noOrg };
      } catch (e) {
        appRead = { connected: false, ownOrgVisible: false, noOrgSeesRows: 0, detail: `app role check failed: ${clean(e)}` };
      } finally {
        await app.end().catch(() => undefined);
      }
    }

    // UC-F3 (S-4): the app role must not see credentials. Read from the owner connection with has_*_privilege: no row is read.
    let credentialGrants: CredentialGrantState | undefined;
    if (appRoleExists) {
      const cols = (await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`)).rows.map(
        (r) => r.column_name as string,
      );
      const canSelect = async (col: string) =>
        (await owner.query(`SELECT has_column_privilege('figbloom_app', 'public.users', $1, 'SELECT') AS ok`, [col])).rows[0].ok as boolean;
      const credentialColumnsReadable: string[] = [];
      for (const c of USER_CREDENTIAL_COLUMNS) if (cols.includes(c) && (await canSelect(c))) credentialColumnsReadable.push(c);
      const safeColumnsMissing: string[] = [];
      for (const c of APP_ROLE_USER_READABLE_COLUMNS) if (cols.includes(c) && !(await canSelect(c))) safeColumnsMissing.push(c);
      const usersWritePrivileges: string[] = [];
      for (const p of ["INSERT", "UPDATE", "DELETE"]) {
        if ((await owner.query(`SELECT has_table_privilege('figbloom_app', 'public.users', $1) AS ok`, [p])).rows[0].ok) usersWritePrivileges.push(p);
      }
      const closedTablePrivileges: string[] = [];
      for (const t of APP_ROLE_NO_ACCESS_CREDENTIAL_TABLES) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          if ((await owner.query(`SELECT has_table_privilege('figbloom_app', $1, $2) AS ok`, [`public.${t}`, p])).rows[0].ok) closedTablePrivileges.push(`${t}: ${p}`);
        }
      }
      const known = new Set<string>([...APP_ROLE_USER_READABLE_COLUMNS, ...USER_CREDENTIAL_COLUMNS]);
      credentialGrants = {
        credentialColumnsReadable,
        safeColumnsMissing,
        usersWritePrivileges,
        closedTablePrivileges,
        unclassifiedColumns: cols.filter((c) => !known.has(c)),
      };
    }

    const report = evaluate({ tables, before, appRoleExists, appRead, credentialGrants });
    console.log(formatReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await owner.end().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(`FAIL  ${clean(e)}`);
  process.exit(1);
});
