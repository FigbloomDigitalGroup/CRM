import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { runNotificationsSweep } from "../src/services/notificationSweepService";

/**
 * FIG-597/FIG-783: thin CLI entry point for the notifications sweep. All
 * the actual logic (per-org task sweep, email delivery retry, the
 * overlap-proof lock, the self-throttle) lives in
 * `notificationSweepService.ts` so the authenticated `/api/cron/
 * notifications-sweep` route can run the exact same code -- this script
 * remains for whoever's deployment prefers a plain CLI invocation on a
 * schedule (a VPS crontab, a sidecar cron container,
 * `docker exec <container> npm run notifications:sweep`) over hitting a
 * URL. See docs/DEPLOYMENT.md's "Scheduled jobs" section for both options.
 */
async function main() {
  const result = await runNotificationsSweep();
  if (!result.ran) {
    console.log(`Sweep skipped (${result.skippedReason}).`);
    return;
  }
  console.log(
    `Sweep completed: ${result.organizationsSwept} organization(s), ` +
      `last completed at ${result.jobRun.completedAt?.toISOString()}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
