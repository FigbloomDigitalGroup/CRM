import "dotenv/config";
import { cleanE2eData } from "../e2e/support/cleanup";

/**
 * One-off clean-up of Playwright test data in the dev database (docs/E2E_DATA_CLEANUP.md).
 *
 *   npx tsx scripts/e2e-cleanup.ts --since 2026-11-04T20:57:00Z --dry-run     # report only, nothing is deleted
 *   npx tsx scripts/e2e-cleanup.ts --since 2026-11-04T20:57:00Z --apply       # delete
 *   npx tsx scripts/e2e-cleanup.ts --apply                                   # marker-only (no config/technical rows)
 *   add --lead <uuid> (repeatable) for a blank lead you have checked is test data
 *
 * Refuses to run unless the database is figbloom_crm_dev or figbloom_crm_test. Prints table names and counts only.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dryRun = !args.includes("--apply");
  const sinceText = value("--since");
  const since = sinceText ? new Date(sinceText) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new Error("--since is not a date.");
  const extraLeadIds = args.flatMap((a, i) => (a === "--lead" && args[i + 1] ? [args[i + 1]!] : []));

  const report = await cleanE2eData(process.env.DATABASE_URL, { since, extraLeadIds, dryRun });
  console.log(`${report.dryRun ? "DRY RUN (rolled back)" : "APPLIED"} on ${report.database}: ${report.total} rows`);
  for (const [table, n] of Object.entries(report.deleted).sort((a, b) => b[1] - a[1])) console.log(`  ${table.padEnd(36)} ${n}`);
  if (Object.keys(report.grew).length > 0) console.log("  tables that GREW (unexpected):", report.grew);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
