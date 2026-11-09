import { NextResponse } from "next/server";
import { adminDb } from "@/db/adminClient";
import { appDb } from "@/db/orgScopedClient";
import { emailConfigProblem } from "@/auth/email";
import { logger } from "@/lib/logger";
import { instrumentRequest } from "@/observability/instrument";
import { currentRequestContext } from "@/observability/requestContext";
import { getNotificationsSweepStatus } from "@/services/notificationSweepService";

/**
 * FIG-595: a real health check, not just "the process is up" -- a query
 * failure here (DB unreachable, credentials wrong) is exactly the kind of
 * problem a container orchestrator's health check exists to catch, so it
 * can stop routing traffic to this instance instead of serving 500s.
 * Deliberately outside every other namespace (no org, no session) since
 * it has to be reachable before any of that is known to be working.
 *
 * Also surfaces the notifications sweep's last run (FIG-783 AC: "health/log
 * output shows the last successful sweep time") -- `null` only means the
 * job has genuinely never completed yet (a fresh environment before its
 * first scheduled trigger), not that this check itself failed; a failure
 * reading that status doesn't fail the overall health check; `/api/health`
 * answering "db is reachable" must not start flapping because of an
 * unrelated job's state.
 */
export async function GET() {
  // FIG-1124: counted in /api/metrics and logged with a request id, like every other route.
  return instrumentRequest(async () => {
    const requestId = currentRequestContext()?.requestId;
    const headers = requestId ? { "x-request-id": requestId } : undefined;
    try {
      await adminDb.$queryRaw`SELECT 1`;
    } catch (err) {
      logger.error({ err }, "Health check failed: database unreachable");
      return NextResponse.json({ status: "error" }, { status: 503, headers });
    }

    // The running app talks to the database as the least-privilege application role (`figbloom_app`), not the owner,
    // so a wrong or missing application-role password must fail the check too (rollback dry run, 4 Nov 2026).
    try {
      await appDb.$queryRaw`SELECT 1`;
    } catch (err) {
      logger.error({ err }, "Health check failed: application database role cannot connect");
      return NextResponse.json({ status: "error", appRole: "error" }, { status: 503, headers });
    }

    let notificationsSweep: {
      lastCompletedAt: Date | null;
      status: string;
      lastError: string | null;
    } | null = null;
    try {
      const sweep = await getNotificationsSweepStatus();
      notificationsSweep = {
        lastCompletedAt: sweep?.completedAt ?? null,
        status: sweep?.status ?? "NEVER_RUN",
        lastError: sweep?.lastError ?? null,
      };
    } catch (err) {
      logger.error({ err }, "Health check: failed to read notifications sweep status");
    }

    // Mail is not needed to serve requests, so a problem is reported here but does not fail the check.
    const emailProblem = emailConfigProblem();
    return NextResponse.json(
      { status: "ok", appRole: "ok", notificationsSweep, email: emailProblem ? { status: "misconfigured", detail: emailProblem } : { status: "ok" } },
      { headers },
    );
  });
}
