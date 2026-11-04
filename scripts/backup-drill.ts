/**
 * Timed backup and restore drill (FIG-1125 / FIG-1258). See docs/BACKUP_RESTORE.md.
 *
 * Dumps a database (pg_dump custom format), restores it into a throwaway
 * scratch database on the same server, compares the row count of every table,
 * confirms row-level security and every policy survived, drops the scratch
 * database and prints the timings. It prints table names, counts and timings
 * only: never row data, connection strings or passwords.
 *
 * Usage:
 *   tsx scripts/backup-drill.ts [source-database-name]
 *
 * Environment:
 *   DATABASE_URL                 owner connection (same convention as db-admin.ts);
 *                                the source database defaults to the one in it
 *   BACKUP_DRILL_DOCKER_CONTAINER  optional: run pg_dump / pg_restore inside this
 *                                container (docker compose: figbloom_crm_postgres)
 *                                instead of using binaries on PATH
 *   BACKUP_DRILL_KEEP=1          keep the scratch database (for inspection)
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const CONTAINER = process.env.BACKUP_DRILL_DOCKER_CONTAINER;
const KEEP = process.env.BACKUP_DRILL_KEEP === "1";

/** Quote a Postgres identifier safely (same rule as db-admin.ts). */
function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to use unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

function adminUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL must be set to an administrative (owner) connection string.",
    );
  }
  return new URL(raw);
}

function urlFor(base: URL, database: string): string {
  const u = new URL(base.toString());
  u.pathname = `/${database}`;
  u.search = "";
  return u.toString();
}

/** Run a command; on failure throw without echoing arguments or env (no secrets). */
function run(cmd: string, args: string[], env: Record<string, string> = {}): string {
  try {
    return execFileSync(cmd, args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    const firstLine = (e.stderr ?? "").split("\n").find((l) => l.trim()) ?? "";
    throw new Error(`${cmd} failed (exit ${e.status ?? "?"}): ${firstLine}`);
  }
}

interface Snapshot {
  counts: Map<string, number>;
  rls: Map<string, string>; // table -> "enabled" | "enabled+forced" | "off"
  policies: Set<string>; // "table:policyname:cmd"
}

async function snapshot(url: string): Promise<Snapshot> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = await client.query<{ relname: string; rls: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    const counts = new Map<string, number>();
    const rls = new Map<string, string>();
    for (const t of tables.rows) {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${ident(t.relname)}`,
      );
      counts.set(t.relname, Number(r.rows[0].n));
      rls.set(t.relname, t.rls ? (t.forced ? "enabled+forced" : "enabled") : "off");
    }
    const pol = await client.query<{ tablename: string; policyname: string; cmd: string }>(
      `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public'`,
    );
    const policies = new Set(pol.rows.map((p) => `${p.tablename}:${p.policyname}:${p.cmd}`));
    return { counts, rls, policies };
  } finally {
    await client.end();
  }
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

async function main(): Promise<void> {
  const base = adminUrl();
  const source = process.argv[2] ?? decodeURIComponent(base.pathname.slice(1));
  if (!source) throw new Error("No source database given and none in DATABASE_URL.");
  const scratch = `figbloom_scratch_drill_${Date.now()}`;
  ident(source);
  ident(scratch);

  const user = decodeURIComponent(base.username);
  const host = base.hostname;
  const port = base.port || "5432";
  const pgEnv = { PGPASSWORD: decodeURIComponent(base.password) };
  const hostArgs = ["-h", host, "-p", port, "-U", user];

  // Docker mode uses the server's local socket inside the container; the dump
  // stays inside the container. Otherwise the dump goes to a private temp dir.
  const tmpDir = CONTAINER ? "" : mkdtempSync(join(tmpdir(), "backup-drill-"));
  const dumpName = `${scratch}.dump`;
  const dumpPath = CONTAINER ? `/tmp/${dumpName}` : join(tmpDir, dumpName);
  const pgTool = (tool: string, args: string[]) =>
    CONTAINER
      ? run("docker", ["exec", CONTAINER, tool, "-U", user, ...args])
      : run(tool, [...hostArgs, ...args], pgEnv);

  const timings: Record<string, number> = {};
  const time = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = Date.now();
    const out = await fn();
    timings[label] = Date.now() - t0;
    return out;
  };

  console.log(`Backup drill: source "${source}", scratch "${scratch}"`);
  const maint = new Client({ connectionString: urlFor(base, "postgres") });
  await maint.connect();
  let created = false;
  let ok = false;
  try {
    const before = await time("snapshot source", () => snapshot(urlFor(base, source)));

    await time("dump", () => pgTool("pg_dump", ["-Fc", "-f", dumpPath, source]));
    const bytes = CONTAINER
      ? Number(run("docker", ["exec", CONTAINER, "stat", "-c", "%s", dumpPath]).trim())
      : statSync(dumpPath).size;

    await maint.query(`CREATE DATABASE ${ident(scratch)}`);
    created = true;
    await time("restore", () =>
      pgTool("pg_restore", ["--no-owner", "--no-privileges", "-d", scratch, dumpPath]),
    );

    const after = await time("verify", () => snapshot(urlFor(base, scratch)));

    const problems: string[] = [];
    for (const [table, n] of before.counts) {
      if (!after.counts.has(table)) problems.push(`table missing after restore: ${table}`);
      else if (after.counts.get(table) !== n)
        problems.push(`row count differs: ${table} (source ${n}, restored ${after.counts.get(table)})`);
      if (before.rls.get(table) !== after.rls.get(table))
        problems.push(
          `RLS state differs: ${table} (source ${before.rls.get(table)}, restored ${after.rls.get(table)})`,
        );
    }
    for (const t of after.counts.keys())
      if (!before.counts.has(t)) problems.push(`unexpected table after restore: ${t}`);
    for (const p of before.policies)
      if (!after.policies.has(p)) problems.push(`policy missing after restore: ${p}`);

    const rlsTables = [...before.rls.values()].filter((v) => v !== "off").length;
    const rows = [...before.counts.values()].reduce((a, b) => a + b, 0);
    console.log(
      `Tables: ${before.counts.size}, rows: ${rows}, tables with RLS: ${rlsTables}, policies: ${before.policies.size}, dump size: ${(bytes / 1024).toFixed(0)} KiB`,
    );
    for (const [table, n] of before.counts) {
      console.log(`  ${table.padEnd(40)} ${String(n).padStart(9)}  ${after.counts.get(table) === n ? "match" : "MISMATCH"}`);
    }
    ok = problems.length === 0;
    if (!ok) {
      console.error("DRILL FAILED:");
      for (const p of problems) console.error(`  - ${p}`);
    }
  } finally {
    if (created && !KEEP) {
      timings["drop scratch"] = 0;
      const t0 = Date.now();
      await maint.query(`DROP DATABASE IF EXISTS ${ident(scratch)} WITH (FORCE)`);
      timings["drop scratch"] = Date.now() - t0;
    } else if (created) {
      console.log(`Scratch database kept: ${scratch}`);
    }
    await maint.end();
    if (CONTAINER) {
      try {
        run("docker", ["exec", CONTAINER, "rm", "-f", dumpPath]);
      } catch {
        /* best effort */
      }
    } else {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log("Timings:");
  for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(16)} ${secs(v)}`);
  const recovery = (timings["dump"] ?? 0) + (timings["restore"] ?? 0);
  console.log(`  restore time (dump excluded): ${secs(timings["restore"] ?? 0)}`);
  console.log(`  dump + restore:               ${secs(recovery)}`);
  console.log(ok ? "RESULT: PASS (counts match, RLS and all policies present)" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Backup drill failed.");
  process.exit(1);
});
