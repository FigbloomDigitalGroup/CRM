/** UC-F7: the little that every `scripts/verify-*.ts` command shares: flags, the owner connection, a snapshot file. Counts and hashes only. */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { clean } from "./dataVerifyDb";
import type { Fingerprint, VerifyReport } from "./dataVerify";

export const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
export const flag = (name: string): boolean => process.argv.includes(name);

/** Opens the schema-owner connection (DATABASE_URL, or VERIFY_DATABASE_URL to point a run at a restored copy without touching .env). */
export async function withOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.VERIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (the owner connection) is required; VERIFY_DATABASE_URL overrides it for one run");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function readFingerprint(path: string | undefined): Fingerprint | undefined {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { values?: Fingerprint };
  if (!parsed.values) throw new Error(`${path} is not a fingerprint file written by --out`);
  return parsed.values;
}

export function writeFingerprint(path: string, kind: string, values: Fingerprint): void {
  writeFileSync(path, JSON.stringify({ kind, takenAt: new Date().toISOString(), values }, null, 2));
  console.log(`Fingerprint of ${Object.keys(values).length} ${kind} values written to ${path} (counts, sums and hashes only, no row data).`);
}

/** Runs a command body, prints its report, sets the exit code, never prints a connection string. */
export function finish(run: () => Promise<{ text: string; report: VerifyReport }>): void {
  run()
    .then(({ text, report }) => {
      console.log(text);
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch((e) => {
      console.error(`FAIL  ${clean(e)}`);
      process.exit(1);
    });
}
