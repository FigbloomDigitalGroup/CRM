import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * G1.07 (FIG-1074): rehearses the upgrade of a V0 database (the `pre-makeover` tag) to the current schema, on a copy, before it is done for real.
 *
 *   OLD_TREE=<folder with `git archive pre-makeover` extracted and `npm ci` run> npx tsx scripts/migration-rehearsal.ts
 *
 * 1. Builds a database with the OLD migrations and the OLD seed, then fills it to production-shaped volume (scripts/rehearsal-scale.ts).
 * 2. Fingerprints every table (row count and a hash of every row's old columns).
 * 3. Takes a backup (pg_dump) and restores it into a second database, which must fingerprint identically (the backup is real).
 * 4. Applies the new migrations to that copy while a probe reads and writes every 25 ms, to show how long the app would stall.
 * 5. Runs the post-upgrade steps (grants, reference data, organisation defaults), fingerprints again and compares the OLD columns.
 * 6. Checks tenant isolation (RLS) on every table, reads the data back through the app's own role, and rehearses the rollback by restoring
 *    the backup over the upgraded copy, then runs the OLD application's own code against it (reads, a list, a write inside a rolled-back
 *    transaction) to show the old version works on the restored database.
 *
 * Writes the raw numbers to the file named by REHEARSAL_RESULT (default migration-rehearsal.json) for docs/MIGRATION_REHEARSAL.md.
 * Only touches the databases named below (created and dropped here); never dev, test or perf.
 */
const OLD_TREE = process.env.OLD_TREE;
if (!OLD_TREE || !existsSync(OLD_TREE)) throw new Error("OLD_TREE must point at the extracted pre-makeover tree (with node_modules).");
const CONTAINER = process.env.PG_CONTAINER ?? "figbloom_crm_postgres";
const SOURCE = process.env.DATABASE_URL;
if (!SOURCE) throw new Error("DATABASE_URL must be set (see .env.example).");

const DB_OLD = "figbloom_crm_rehearsal_old";
const DB_UP = "figbloom_crm_rehearsal_up";
const ORG_SLUG = "figbloom";

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const url = (db: string) => withDb(SOURCE, db);
const appUrl = (db: string) => withDb(process.env.APP_DATABASE_URL ?? SOURCE.replace(/\/\/[^@]+@/, "//figbloom_app:x@"), db);
const dbUser = decodeURIComponent(new URL(SOURCE).username);
const dbPassword = decodeURIComponent(new URL(SOURCE).password);

const result: Record<string, unknown> = { startedAt: new Date().toISOString() };
const log = (line: string) => console.log(line);

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}): Promise<{ code: number; out: string; ms: number }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out, ms: Date.now() - t }));
  });
}

async function mustRun(label: string, cmd: string, args: string[], opts: Parameters<typeof run>[2] = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${label} failed (exit ${r.code}):\n${r.out.split("\n").slice(-25).join("\n")}`);
  log(`  ${label} (${(r.ms / 1000).toFixed(1)}s)`);
  return r;
}

const control = new PrismaClient({ datasourceUrl: url("postgres") });
const dropDb = (db: string) => control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
const createDb = (db: string) => control.$executeRawUnsafe(`CREATE DATABASE "${db}"`);

/** Tables up to this many rows are also kept row by row, so a change can be told apart from an addition. */
const ROW_LEVEL_LIMIT = 3000;

interface Fingerprint {
  [table: string]: { rows: number; hash: string; keyed?: Record<string, string> };
}

/** Columns of every table as they are now, so the same projection can be hashed again after the upgrade. */
async function tableColumns(db: PrismaClient): Promise<Record<string, string[]>> {
  const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name, ordinal_position`,
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.table_name] ??= []).push(r.column_name);
  return out;
}

async function fingerprint(db: PrismaClient, columns: Record<string, string[]>): Promise<{ fingerprint: Fingerprint; missing: string[] }> {
  const fingerprint: Fingerprint = {};
  const missing: string[] = [];
  for (const [table, cols] of Object.entries(columns)) {
    const present = new Set(
      (await db.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`)).map((r) => r.column_name),
    );
    if (present.size === 0) {
      missing.push(`table ${table}`);
      continue;
    }
    const kept = cols.filter((c) => present.has(c));
    for (const c of cols) if (!present.has(c)) missing.push(`${table}.${c}`);
    const projection = kept.map((c) => `'${c}', "${c}"`).join(", ");
    const [r] = await db.$queryRawUnsafe<{ rows: number; hash: string | null }[]>(
      `SELECT count(*)::int AS rows, md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS hash FROM (SELECT md5(jsonb_build_object(${projection})::text) AS h FROM "${table}") s`,
    );
    fingerprint[table] = { rows: r!.rows, hash: r!.hash ?? "" };
    if (r!.rows <= ROW_LEVEL_LIMIT) {
      const key = kept.includes("id") ? '"id"::text' : "md5(jsonb_build_object(" + projection + ")::text)";
      const keyed = await db.$queryRawUnsafe<{ k: string; h: string }[]>(`SELECT ${key} AS k, md5(jsonb_build_object(${projection})::text) AS h FROM "${table}"`);
      fingerprint[table]!.keyed = Object.fromEntries(keyed.map((x) => [x.k, x.h]));
    }
  }
  return { fingerprint, missing };
}

interface TableChange {
  table: string;
  modified: number;
  removed: number;
  added: number;
}

/** What happened to the rows that were there before. A table kept row by row reports modified / removed / added; a large one must hash the same. */
function compare(before: Fingerprint, after: Fingerprint): TableChange[] {
  const changed: TableChange[] = [];
  for (const [table, f] of Object.entries(before)) {
    const a = after[table];
    if (!a) {
      changed.push({ table, modified: 0, removed: f.rows, added: 0 });
    } else if (f.keyed && a.keyed) {
      let modified = 0;
      let removed = 0;
      for (const [k, h] of Object.entries(f.keyed)) {
        if (!(k in a.keyed)) removed++;
        else if (a.keyed[k] !== h) modified++;
      }
      const added = Object.keys(a.keyed).filter((k) => !(k in f.keyed!)).length;
      if (modified || removed || added) changed.push({ table, modified, removed, added });
    } else if (a.rows !== f.rows || a.hash !== f.hash) {
      changed.push({ table, modified: a.rows === f.rows ? 1 : 0, removed: Math.max(0, f.rows - a.rows), added: Math.max(0, a.rows - f.rows) });
    }
  }
  return changed;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads and writes the busiest tables every 25 ms while `until` is pending; reports the worst waits (what a user would feel as a hang). */
async function probe(db: PrismaClient, until: Promise<unknown>) {
  const lead = (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM leads ORDER BY id LIMIT 1`))[0]!.id;
  const deal = (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM deals ORDER BY id LIMIT 1`))[0]!.id;
  const reads: number[] = [];
  const writes: number[] = [];
  let errors = 0;
  let done = false;
  until.finally(() => (done = true));
  while (!done) {
    for (const [kind, fn] of [
      ["read", () => db.$queryRawUnsafe(`SELECT count(*) FROM leads WHERE lead_status_id IS NOT NULL`)],
      ["write", () => db.$executeRawUnsafe(`UPDATE leads SET updated_at = updated_at WHERE id = '${lead}'`)],
      ["write", () => db.$executeRawUnsafe(`UPDATE deals SET updated_at = updated_at WHERE id = '${deal}'`)],
    ] as const) {
      const t = performance.now();
      try {
        await fn();
        (kind === "read" ? reads : writes).push(performance.now() - t);
      } catch {
        errors++;
      }
    }
    await sleep(25);
  }
  const worst = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const p99 = (xs: number[]) => (xs.length ? sorted(xs)[Math.min(xs.length - 1, Math.ceil(0.99 * xs.length) - 1)]! : 0);
  return { samples: reads.length + writes.length, errors, worstReadMs: Math.round(worst(reads)), worstWriteMs: Math.round(worst(writes)), p99ReadMs: Math.round(p99(reads)), p99WriteMs: Math.round(p99(writes)) };
}

async function main() {
  log("1. Old database (migrations and seed from the pre-makeover tag)");
  for (const db of [DB_OLD, DB_UP]) await dropDb(db);
  await createDb(DB_OLD);
  const oldEnv = { DATABASE_URL: url(DB_OLD), NODE_ENV: "development" };
  await mustRun("old migrations", "npx", ["prisma", "migrate", "deploy"], { cwd: OLD_TREE, env: oldEnv });
  await mustRun("old seed", "npx", ["tsx", "prisma/seed.ts"], { cwd: OLD_TREE, env: oldEnv });
  const oldRoleEnv = { ...oldEnv, APP_DATABASE_URL: appUrl(DB_OLD), APP_DB_NAMES: DB_OLD };
  await mustRun("old app role", "npx", ["tsx", "scripts/db-admin.ts", "bootstrap-role"], { cwd: OLD_TREE, env: oldRoleEnv });
  await mustRun("old grants", "npx", ["tsx", "scripts/db-admin.ts", "grant-role"], { cwd: OLD_TREE, env: oldRoleEnv });
  await mustRun("volume", "npx", ["tsx", "scripts/rehearsal-scale.ts", ORG_SLUG], { env: { DATABASE_URL: url(DB_OLD) } });

  const old = new PrismaClient({ datasourceUrl: url(DB_OLD) });
  const columns = await tableColumns(old);
  const migrationsBefore = Number((await old.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM _prisma_migrations`))[0]!.n);
  const before = await fingerprint(old, columns);
  const rowCount = (t: string) => before.fingerprint[t]?.rows ?? 0;
  result.volume = Object.fromEntries(["organizations", "users", "memberships", "companies", "contacts", "leads", "deals", "activities", "tasks", "communications", "notifications"].map((t) => [t, rowCount(t)]));
  result.oldMigrations = migrationsBefore;
  result.oldTables = Object.keys(columns).length;
  log(`  ${Object.keys(columns).length} tables, ${Object.values(before.fingerprint).reduce((n, f) => n + f.rows, 0)} rows fingerprinted`);

  log("2. Backup and restore");
  const dumpAt = "/tmp/figbloom_rehearsal.dump";
  const dump = await run("docker", ["exec", "-e", `PGPASSWORD=${dbPassword}`, CONTAINER, "pg_dump", "-U", dbUser, "-Fc", "-f", dumpAt, DB_OLD]);
  if (dump.code !== 0) throw new Error(`pg_dump failed:\n${dump.out}`);
  const size = await run("docker", ["exec", CONTAINER, "stat", "-c", "%s", dumpAt]);
  result.backup = { seconds: +(dump.ms / 1000).toFixed(1), megabytes: +(Number(size.out.trim()) / 1024 / 1024).toFixed(1) };
  log(`  pg_dump ${(dump.ms / 1000).toFixed(1)}s, ${(result.backup as { megabytes: number }).megabytes} MB`);

  async function restore(into: string) {
    await dropDb(into);
    await createDb(into);
    const r = await run("docker", ["exec", "-e", `PGPASSWORD=${dbPassword}`, CONTAINER, "pg_restore", "-U", dbUser, "-d", into, "--no-owner", dumpAt]);
    if (r.code !== 0 && !/already exists/.test(r.out)) throw new Error(`pg_restore failed:\n${r.out.split("\n").slice(-15).join("\n")}`);
    return r.ms;
  }
  const restoreMs = await restore(DB_UP);
  result.restoreSeconds = +(restoreMs / 1000).toFixed(1);
  const up = new PrismaClient({ datasourceUrl: url(DB_UP) });
  const restored = await fingerprint(up, columns);
  const restoreDiff = compare(before.fingerprint, restored.fingerprint);
  result.restoreMatches = restoreDiff.length === 0;
  log(`  restore ${(restoreMs / 1000).toFixed(1)}s, ${restoreDiff.length === 0 ? "every table identical to the original" : `${restoreDiff.length} tables differ`}`);
  if (restoreDiff.length) throw new Error(`Restore differs: ${JSON.stringify(restoreDiff)}`);

  log("3. Upgrade the restored copy (new migrations, with a probe running)");
  // Optional mitigation under test: the deal-rules backfill filters activities and communications by deal alone, which no existing index serves.
  const preIndex = process.env.REHEARSAL_PRE_INDEX === "1";
  if (preIndex) {
    await up.$executeRawUnsafe(`CREATE INDEX upgrade_tmp_activities_deal ON activities (deal_id)`);
    await up.$executeRawUnsafe(`CREATE INDEX upgrade_tmp_communications_deal ON communications (deal_id)`);
  }
  const applied = new Set((await up.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM _prisma_migrations`)).map((r) => r.migration_name));
  const upgrade = run("npx", ["prisma", "migrate", "deploy"], { env: { DATABASE_URL: url(DB_UP) } });
  const stall = await probe(up, upgrade);
  const upgraded = await upgrade;
  if (upgraded.code !== 0) throw new Error(`migrate deploy failed:\n${upgraded.out.split("\n").slice(-25).join("\n")}`);
  if (preIndex) {
    await up.$executeRawUnsafe(`DROP INDEX upgrade_tmp_activities_deal`);
    await up.$executeRawUnsafe(`DROP INDEX upgrade_tmp_communications_deal`);
  }
  const timings = await up.$queryRawUnsafe<{ migration_name: string; ms: number }[]>(
    `SELECT migration_name, round(extract(epoch FROM (finished_at - started_at)) * 1000)::int AS ms FROM _prisma_migrations ORDER BY started_at`,
  );
  const fresh = timings.filter((t) => !applied.has(t.migration_name));
  result.upgrade = { preIndex, seconds: +(upgraded.ms / 1000).toFixed(1), migrationsApplied: fresh.length, slowest: [...fresh].sort((a, b) => b.ms - a.ms).slice(0, 5), stall };
  log(`  ${fresh.length} migrations in ${(upgraded.ms / 1000).toFixed(1)}s; worst write wait during the upgrade ${stall.worstWriteMs} ms (${stall.errors} errors in ${stall.samples} probes)`);

  log("4. After the upgrade: grants, reference data, backfill of organisation defaults");
  const afterEnv = { DATABASE_URL: url(DB_UP), APP_DATABASE_URL: appUrl(DB_UP), APP_DB_NAMES: DB_UP };
  await mustRun("bootstrap role", "npx", ["tsx", "scripts/db-admin.ts", "bootstrap-role"], { env: afterEnv });
  await mustRun("grant role", "npx", ["tsx", "scripts/db-admin.ts", "grant-role"], { env: afterEnv });
  Object.assign(process.env, afterEnv, { TEST_DATABASE_URL: afterEnv.DATABASE_URL, TEST_APP_DATABASE_URL: afterEnv.APP_DATABASE_URL });
  const { seedRolesAndPermissions } = await import("../prisma/seedReference");
  const { seedOrganizationDefaults } = await import("../src/services/organizationDefaults");
  const { adminDb } = await import("../src/db/adminClient");
  await seedRolesAndPermissions();
  const orgs = await adminDb.organization.findMany({ select: { id: true, slug: true } });
  // The upgrade backfill: adds what the new catalogue has and the organisation lacks, changes nothing that is already there.
  for (const o of orgs) await seedOrganizationDefaults(o.id, { fillOnly: true });
  for (const o of orgs) await seedOrganizationDefaults(o.id, { fillOnly: true }); // the second pass proves it is safe to run again
  log(`  reference data and fill-only defaults for ${orgs.length} organisation(s), run twice`);

  log("5. Checks");
  const after = await fingerprint(up, columns);
  const changed = compare(before.fingerprint, after.fingerprint);
  // The role and permission catalogue is reconciled to the code on purpose (a permission a role no longer has is removed); the audit trail
  // gains the entries the reconcile writes. Every other table must keep every row it had, unchanged.
  const RECONCILED = new Set(["roles", "permissions", "role_permissions", "audit_events"]);
  const unexpected = changed.filter((c) => !RECONCILED.has(c.table) && (c.modified > 0 || c.removed > 0));
  result.oldColumnsAfter = { tablesCompared: Object.keys(before.fingerprint).length, changed, unexpected, missingColumns: after.missing };
  log(`  old data: ${Object.keys(before.fingerprint).length - changed.length} of ${Object.keys(before.fingerprint).length} tables identical; ${changed.length} gained rows or were reconciled; ${unexpected.length} lost or changed a row; ${after.missing.length} old columns or tables gone`);
  for (const c of changed) log(`    ${c.table}: ${c.added} added, ${c.modified} modified, ${c.removed} removed`);
  if (unexpected.length) throw new Error(`Rows were changed or removed by the upgrade: ${JSON.stringify(unexpected)}`);

  const noRls = await up.$queryRawUnsafe<{ relname: string }[]>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
       AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organization_id')
       AND NOT (c.relrowsecurity AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
     ORDER BY 1`,
  );
  const tenantTables = Number((await up.$queryRawUnsafe<{ n: number }[]>(`SELECT count(DISTINCT table_name)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id'`))[0]!.n);
  result.rls = { tenantTables, withoutPolicy: noRls.map((r) => r.relname) };
  log(`  row-level security: ${tenantTables} tables with organization_id, ${noRls.length} without a policy${noRls.length ? ` (${noRls.map((r) => r.relname).join(", ")})` : ""}`);

  const { withOrgContext } = await import("../src/db/orgScopedClient");
  const org = orgs.find((o) => o.slug === ORG_SLUG)!;
  const viaApp = await withOrgContext(org.id, async (tx) => ({
    leads: await tx.lead.count(),
    contacts: await tx.contact.count(),
    deals: await tx.deal.count(),
    activities: await tx.activity.count(),
  }));
  const expected = { leads: rowCount("leads"), contacts: rowCount("contacts"), deals: rowCount("deals"), activities: rowCount("activities") };
  result.appRoleRead = { viaApp, expected, matches: JSON.stringify(viaApp) === JSON.stringify(expected) };
  log(`  read through the app role: ${JSON.stringify(viaApp)} ${JSON.stringify(viaApp) === JSON.stringify(expected) ? "(matches)" : "(DIFFERS from " + JSON.stringify(expected) + ")"}`);

  const unvalidated = await up.$queryRawUnsafe<{ conname: string }[]>(`SELECT conname FROM pg_constraint WHERE NOT convalidated`);
  result.unvalidatedConstraints = unvalidated.map((r) => r.conname);

  log("6. Rollback rehearsal (restore the backup over the upgraded copy)");
  await up.$disconnect();
  await adminDb.$disconnect();
  const rollbackMs = await restore(DB_UP);
  const rolled = new PrismaClient({ datasourceUrl: url(DB_UP) });
  const rolledBack = await fingerprint(rolled, columns);
  const rollbackDiff = compare(before.fingerprint, rolledBack.fingerprint);
  const rolledMigrations = Number((await rolled.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM _prisma_migrations`))[0]!.n);
  result.rollback = { seconds: +(rollbackMs / 1000).toFixed(1), identicalToBefore: rollbackDiff.length === 0, migrationsAfterRollback: rolledMigrations, migrationsBefore };
  log(`  rollback ${(rollbackMs / 1000).toFixed(1)}s: ${rollbackDiff.length === 0 ? "identical to the pre-upgrade database" : "DIFFERS"}; migrations recorded ${rolledMigrations} (was ${migrationsBefore})`);

  // The old application's own code, from the tag, against the restored database: counts through its app role, a list, and a write that is
  // rolled back (proves the write path and RLS without changing the data).
  const smokeFile = join(String(OLD_TREE), "_rollback_smoke.ts");
  writeFileSync(
    smokeFile,
    [
      'import { adminDb } from "./src/db/adminClient";',
      'import { withOrgContext } from "./src/db/orgScopedClient";',
      'import { listLeads } from "./src/repositories/leads";',
      "async function main() {",
      "  const org = await adminDb.organization.findUniqueOrThrow({ where: { slug: process.argv[2]! } });",
      "  const counts = await withOrgContext(org.id, async (tx) => ({ leads: await tx.lead.count(), contacts: await tx.contact.count(), deals: await tx.deal.count(), activities: await tx.activity.count() }));",
      "  const page = await listLeads(org.id, { take: 10 });",
      "  let wrote = false;",
      "  try {",
      '    await withOrgContext(org.id, async (tx) => { await tx.lead.update({ where: { id: page[0]!.id }, data: { notes: "rollback smoke" } }); wrote = true; throw new Error("undo"); });',
      '  } catch (e) { if ((e as Error).message !== "undo") throw e; }',
      '  console.log("SMOKE " + JSON.stringify({ counts, listed: page.length, wrote }));',
      "  await adminDb.$disconnect();",
      "}",
      "main().catch((e) => { console.error(e); process.exit(1); });",
      "",
    ].join(String.fromCharCode(10)),
  );
  const smoke = await run("npx", ["tsx", "_rollback_smoke.ts", ORG_SLUG], { cwd: OLD_TREE, env: { DATABASE_URL: url(DB_UP), APP_DATABASE_URL: appUrl(DB_UP), NODE_ENV: "development" } });
  rmSync(smokeFile, { force: true });
  const smokeLine = smoke.out.split(String.fromCharCode(10)).find((l) => l.startsWith("SMOKE "));
  const smokeResult = smokeLine ? JSON.parse(smokeLine.slice(6)) : null;
  const oldAppWorks = smoke.code === 0 && !!smokeResult && JSON.stringify(smokeResult.counts) === JSON.stringify(expected) && smokeResult.listed === 10 && smokeResult.wrote === true;
  result.oldAppAfterRollback = { works: oldAppWorks, smoke: smokeResult, error: smoke.code === 0 ? null : smoke.out.split(String.fromCharCode(10)).slice(-8).join(String.fromCharCode(10)) };
  log(`  old application's code on the restored database: ${oldAppWorks ? "works (counts match, list and write succeed)" : "FAILED"}`);
  if (!oldAppWorks) throw new Error(`The old application did not work on the rolled-back database:
${smoke.out.split(String.fromCharCode(10)).slice(-15).join(String.fromCharCode(10))}`);

  await rolled.$disconnect();
  await old.$disconnect();
  await run("docker", ["exec", CONTAINER, "rm", "-f", dumpAt]);
  for (const db of [DB_OLD, DB_UP]) await dropDb(db);
  await control.$disconnect();
  result.finishedAt = new Date().toISOString();
  writeFileSync(process.env.REHEARSAL_RESULT ?? "migration-rehearsal.json", JSON.stringify(result, null, 2));
  log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  writeFileSync(process.env.REHEARSAL_RESULT ?? "migration-rehearsal.json", JSON.stringify({ ...result, failed: String(err) }, null, 2));
  process.exit(1);
});
