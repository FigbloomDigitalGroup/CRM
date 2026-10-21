import { NextResponse } from "next/server";
import { adminDb } from "@/db/adminClient";
import { logger } from "@/lib/logger";
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
  try {
    await adminDb.$queryRaw`SELECT 1`;

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

    return NextResponse.json({ status: "ok", notificationsSweep });
  } catch (err) {
    logger.error({ err }, "Health check failed: database unreachable");
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
