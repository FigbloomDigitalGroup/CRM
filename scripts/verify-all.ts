/**
 * UC-F7: runs every data-preservation check in turn and fails if any fails. Each command prints its own report.
 *
 *   npm run verify:all                       # a health check of the connected database (snapshot comparison skipped)
 *   npm run verify:all -- --snapshot before-counts.json --exact   # the migration gate: counts must equal the "before"
 *
 * Money and custom-field fingerprints (--out / --compare) and the file checks need their own arguments: run those commands directly (docs/MIGRATION_VERIFICATION.md).
 */
import { spawnSync } from "node:child_process";

const passthrough = process.argv.slice(2);
const hasSnapshot = passthrough.includes("--snapshot");
const steps: { name: string; file: string; args: string[] }[] = [
  { name: "Migration state (RLS, grants, counts)", file: "scripts/verify-migration.ts", args: hasSnapshot ? passthrough : ["--no-snapshot", ...passthrough] },
  { name: "Foreign keys and orphans", file: "scripts/verify-relations.ts", args: [] },
  { name: "Financial totals", file: "scripts/verify-financials.ts", args: [] },
  { name: "Duplicates", file: "scripts/verify-duplicates.ts", args: [] },
  { name: "Custom fields", file: "scripts/verify-custom-fields.ts", args: [] },
  { name: "Files and objects", file: "scripts/verify-files.ts", args: [] },
];

let failed = 0;
for (const s of steps) {
  console.log(`\n=== ${s.name}`);
  const r = spawnSync("npx", ["tsx", s.file, ...s.args], { stdio: "inherit", shell: true });
  if (r.status !== 0) failed++;
}
console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${steps.length - failed} of ${steps.length} verification steps passed`);
process.exit(failed === 0 ? 0 : 1);
