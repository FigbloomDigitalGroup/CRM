import { handleRoute } from "@/app/api/_lib/handleRoute";
import { secretsMatch } from "@/auth/secretCompare";
import { UnauthorizedError } from "@/auth/errors";
import { checkMissedRuns, runDueJobs, tickSchedules } from "@/jobs/runner";

/**
 * The job worker entry point for a scheduler that can only call a URL
 * (FIG-1066, B2.18). Each call queues the current slot of every scheduled job,
 * recovers jobs a crashed worker left behind, runs due jobs within a time
 * budget, and reports any scheduled job that has missed two runs. Authenticated
 * by the shared CRON_SECRET, like /api/cron/notifications-sweep; it is not a
 * tenant request, so there is no organisation context. A long-running worker
 * (npm run jobs:worker) does the same on a loop.
 */
function assertAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET is not configured -- refusing to run jobs.");
  }
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length)
    : request.headers.get("x-cron-secret");
  if (!secretsMatch(provided, secret)) {
    throw new UnauthorizedError("Invalid or missing cron secret.");
  }
}

async function handle(request: Request) {
  return handleRoute(async () => {
    assertAuthorized(request);
    const { enqueued } = await tickSchedules();
    const { reclaimed, results } = await runDueJobs();
    const missed = await checkMissedRuns();
    return {
      enqueued,
      reclaimed,
      ran: results.length,
      succeeded: results.filter((r) => r.outcome === "succeeded").length,
      failed: results.filter((r) => r.outcome !== "succeeded").length,
      missedRuns: missed.length,
    };
  });
}

export const GET = handle;
export const POST = handle;
