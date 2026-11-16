/**
 * Backfill for P2-22 and P2-23 (see src/services/taskBackfill.ts and docs/TASK_CORRELATION.md).
 *
 *   npx tsx scripts/backfill-task-links.ts                      # dry run: counts only, writes nothing
 *   npx tsx scripts/backfill-task-links.ts --apply              # create the missing tasks (additive, safe to repeat)
 *   npx tsx scripts/backfill-task-links.ts --apply --org <id>   # one organisation only
 */
import "dotenv/config";
import { backfillTaskLinks } from "../src/services/taskBackfill";

async function main() {
  const args = process.argv.slice(2);
  const orgIndex = args.indexOf("--org");
  const report = await backfillTaskLinks({ apply: args.includes("--apply"), organizationId: orgIndex >= 0 ? args[orgIndex + 1] : undefined });
  console.log(JSON.stringify(report, null, 2));
  if (report.dryRun) console.log("Dry run: nothing was written. Add --apply to create the missing tasks.");
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
