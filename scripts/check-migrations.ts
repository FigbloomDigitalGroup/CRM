/**
 * Fails when a migration contains a destructive statement without a written approval (FIG-1603, P2-20 section C.2).
 * Usage: npm run check:migrations
 * Migrations listed in prisma/migrations-guard-baseline.json were applied everywhere before the guard existed and are not judged.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { judge } from "./lib/migrationGuard";

const root = join(__dirname, "..", "prisma");
const dir = join(root, "migrations");
const baselinePath = join(root, "migrations-guard-baseline.json");
const baseline = new Set<string>(existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")).migrations as string[]) : []);

let failed = 0;
const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const name of names) {
  const file = join(dir, name, "migration.sql");
  if (!existsSync(file)) continue;
  const v = judge(name, readFileSync(file, "utf8"), baseline);
  if (!v.ok) {
    failed++;
    console.error(`FAIL ${name}`);
    for (const p of v.problems) console.error(`   ${p}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} migration(s) need attention. See docs/RUNBOOKS.md, "Migration deploy".`);
  process.exit(1);
}
console.log(`OK: ${names.length} migrations scanned, no unapproved destructive statement.`);
