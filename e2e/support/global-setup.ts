import "dotenv/config";
import { assertSafeTarget, cleanE2eData } from "./cleanup";

/**
 * Playwright global setup: removes test records an earlier run (or an aborted one) left behind, then returns the teardown that removes this run's.
 * See docs/E2E_DATA_CLEANUP.md. The clean-up never fails the run: if the database is not one it may touch (not figbloom_crm_dev or
 * figbloom_crm_test), is unreachable, or E2E_SKIP_CLEANUP=1, it says so and the specs run as before.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const url = process.env.DATABASE_URL;
  if (process.env.E2E_SKIP_CLEANUP === "1") return async () => undefined;
  try {
    assertSafeTarget(url);
  } catch (e) {
    console.log(`[e2e clean-up] skipped: ${e instanceof Error ? e.message : String(e)}`);
    return async () => undefined;
  }

  // A few seconds of margin so a row written in the first moments of the run is inside the window; the clock is the same machine's.
  const since = new Date(Date.now() - 5_000);
  try {
    const before = await cleanE2eData(url);
    if (before.total > 0) console.log(`[e2e clean-up] removed ${before.total} leftover test rows before the run.`);
  } catch (e) {
    console.log(`[e2e clean-up] could not clean before the run: ${e instanceof Error ? e.message : String(e)}`);
  }

  return async () => {
    try {
      const after = await cleanE2eData(url, { since });
      console.log(`[e2e clean-up] removed ${after.total} test rows after the run.`);
    } catch (e) {
      // Not a test failure: say what to run by hand.
      console.log(`[e2e clean-up] could not clean after the run (${e instanceof Error ? e.message : String(e)}). Run: npx tsx scripts/e2e-cleanup.ts --since ${since.toISOString()} --apply`);
    }
  };
}
