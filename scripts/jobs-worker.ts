import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { checkMissedRuns, newWorkerId, runDueJobs, tickSchedules } from "../src/jobs/runner";
import { logger } from "../src/lib/logger";

/**
 * Long-running background job worker (FIG-1066, B2.18): `npm run jobs:worker`.
 * Queues the current slot of every scheduled job, runs whatever is due, checks
 * for missed runs, then waits. Run one or several; they coordinate through the
 * database. `--once` runs a single pass and exits (useful from a cron container).
 */
const POLL_MS = Number(process.env.JOBS_POLL_INTERVAL_MS) > 0 ? Number(process.env.JOBS_POLL_INTERVAL_MS) : 5_000;
const MISSED_CHECK_EVERY_MS = 10 * 60_000;

async function pass(workerId: string): Promise<number> {
  await tickSchedules();
  const { reclaimed, results } = await runDueJobs({ workerId });
  if (reclaimed > 0) logger.warn({ reclaimed }, "Recovered jobs left behind by a stopped worker");
  return results.length;
}

async function main() {
  const workerId = newWorkerId();
  const once = process.argv.includes("--once");
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      logger.info({ workerId, signal }, "Job worker stopping after the current job");
    });
  }

  logger.info({ workerId, pollMs: POLL_MS }, "Job worker started");
  let lastMissedCheck = 0;
  do {
    const ran = await pass(workerId);
    if (Date.now() - lastMissedCheck > MISSED_CHECK_EVERY_MS) {
      await checkMissedRuns();
      lastMissedCheck = Date.now();
    }
    if (once || stopping) break;
    if (ran === 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (!stopping);
  await adminDb.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "Job worker crashed");
  process.exit(1);
});
