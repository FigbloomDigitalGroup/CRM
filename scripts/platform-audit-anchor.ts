/**
 * Platform audit anchor (FIG-1566, finding F-03 of docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md; docs/BACKUP_RESTORE.md section 11).
 *
 *   tsx scripts/platform-audit-anchor.ts export [--out <file>]
 *       Writes the platform audit log and the head of its hash chain, from the database in DATABASE_URL (read-only transaction):
 *         <file>                      the log, one JSON line per row, then the head line
 *         <file>.head                 the head line alone: keep it somewhere the log's owner cannot reach
 *         <file>.verified-head.json   the head the last passing verification run recorded (empty when none has passed yet)
 *         <file>.sha256               checksum of <file>
 *       Prints the row count and the head hash. Never prints a connection string.
 *
 *   tsx scripts/platform-audit-anchor.ts check <file> [--head-file <f>] [--verified-head-file <f>] [--database]
 *       The restore check. Recomputes the chain from <file> and compares its head with the head line, with the stored head
 *       (<file>.head unless --head-file) and with the verified head (<file>.verified-head.json unless given). With --database it also
 *       compares every exported row with the database in DATABASE_URL (the restored one). Exits 1 and says why on any difference.
 *
 * The same export is made by the nightly backup (ops/backup/backup-nightly.sh) with psql, from the same SQL (ops/backup/audit-export.sql),
 * so the files are interchangeable. All the checking logic is in src/services/platformAuditAnchorService.ts (tests/platformAuditAnchor.test.ts).
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Client } from "pg";
import {
  AnchorFormatError,
  checkAnchor,
  compareWithDatabase,
  parseAnchor,
  parseHeadFile,
  parseVerifiedHead,
  type DatabaseChain,
} from "../src/services/platformAuditAnchorService";

const SQL_DIR = join(__dirname, "..", "ops", "backup");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function connect(): Client {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must be set (for the hosted database use its direct, non-pooled URL).");
  const url = new URL(raw);
  url.searchParams.delete("schema"); // Prisma's parameter, not Postgres's
  return new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15_000 });
}

/** Runs one of the shared SQL files inside a read-only transaction and returns its `line` column. */
async function lines(client: Client, file: string): Promise<string[]> {
  const sql = readFileSync(join(SQL_DIR, file), "utf8");
  const result = await client.query<{ line: string }>(sql);
  return result.rows.map((r) => r.line);
}

async function exportCommand(): Promise<number> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const out = resolve(arg("--out") ?? `platform-audit-${stamp}.jsonl`);
  const client = connect();
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const exported = await lines(client, "audit-export.sql");
    const verified = await lines(client, "audit-verified-head.sql");
    await client.query("COMMIT");
    const body = exported.join("\n") + "\n";
    const parsed = parseAnchor(body);
    // Check what was just written before trusting it: a copy that does not verify is worse than none.
    const own = checkAnchor(parsed, { verifiedHead: verified[0] ? parseVerifiedHead(verified[0]) : null });
    writeFileSync(out, body);
    writeFileSync(`${out}.head`, exported[exported.length - 1] + "\n");
    writeFileSync(`${out}.verified-head.json`, verified.length ? verified[0] + "\n" : "");
    writeFileSync(`${out}.sha256`, `${createHash("sha256").update(body).digest("hex")}  ${basename(out)}\n`);
    console.log(`Exported ${own.rowsChecked} platform audit rows to ${out}`);
    console.log(`Head: seq ${own.headSeq}, hash ${own.headHash}`);
    if (!own.ok) {
      console.error("THE DATABASE'S OWN CHAIN DOES NOT VERIFY:");
      for (const p of own.problems) console.error(`  - ${p}`);
      return 1;
    }
    return 0;
  } finally {
    await client.end();
  }
}

async function databaseChain(upTo: number): Promise<DatabaseChain> {
  const client = connect();
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const rows = await client.query<{ seq: string; hash: string }>("SELECT e.seq::text AS seq, e.hash FROM platform_audit_events e WHERE e.seq <= $1::bigint ORDER BY e.seq", [upTo]);
    const head = await client.query<{ seq: string; hash: string }>("SELECT e.seq::text AS seq, e.hash FROM platform_audit_events e ORDER BY e.seq DESC LIMIT 1");
    await client.query("COMMIT");
    return {
      headSeq: head.rows[0] ? Number(head.rows[0].seq) : 0,
      headHash: head.rows[0]?.hash ?? "GENESIS",
      hashes: new Map(rows.rows.map((r) => [Number(r.seq), r.hash])),
    };
  } finally {
    await client.end();
  }
}

async function checkCommand(): Promise<number> {
  const file = process.argv[3];
  if (!file || file.startsWith("--")) {
    console.error("Usage: tsx scripts/platform-audit-anchor.ts check <file> [--head-file <f>] [--verified-head-file <f>] [--database]");
    return 2;
  }
  const path = resolve(file);
  const anchor = parseAnchor(readFileSync(path, "utf8"));

  // Two naming conventions of the same files: `export` writes <file>.head; the nightly backup writes figbloom-<stamp>.audit.head
  // beside figbloom-<stamp>.audit.jsonl. Both are found.
  const sidecar = (suffix: string): string | undefined =>
    [`${path}.${suffix}`, `${path.replace(/\.jsonl$/, "")}.${suffix}`].find((candidate) => existsSync(candidate));
  const headPath = arg("--head-file") ?? sidecar("head");
  const verifiedPath = arg("--verified-head-file") ?? sidecar("verified-head.json");
  const storedHead = headPath ? parseHeadFile(readFileSync(resolve(headPath), "utf8")) : null;
  const verifiedHead = verifiedPath ? parseVerifiedHead(readFileSync(resolve(verifiedPath), "utf8")) : null;
  if (!storedHead) console.warn("WARNING: no separate head file was given or found, so the head line inside the export is the only copy of the head.");

  const result = checkAnchor(anchor, { storedHead, verifiedHead });
  console.log(`Export: ${result.rowsChecked} rows, head seq ${result.headSeq}, hash ${result.headHash}`);
  let ok = result.ok;
  for (const p of result.problems) console.error(`  - ${p}`);

  if (process.argv.includes("--database")) {
    const comparison = compareWithDatabase(anchor, await databaseChain(result.headSeq));
    console.log(`Database: ${comparison.ok ? "agrees with the export" : "DIFFERS from the export"}${comparison.rowsAfterBackup ? ` (${comparison.rowsAfterBackup} newer rows, as expected)` : ""}`);
    for (const p of comparison.problems) console.error(`  - ${p}`);
    ok = ok && comparison.ok;
  }

  console.log(ok ? "OK: the platform audit log matches its off-database copy." : "FAILED: the platform audit log or its copy has been changed. Do not trust either until this is explained.");
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command === "export") return exportCommand();
  if (command === "check") return checkCommand();
  console.error("Usage: tsx scripts/platform-audit-anchor.ts export [--out <file>] | check <file> [--head-file <f>] [--verified-head-file <f>] [--database]");
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Never print a connection string: pg errors can carry the host, not the password, but keep the message only.
    console.error(err instanceof AnchorFormatError ? `FAILED: ${err.message}` : `FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  });
