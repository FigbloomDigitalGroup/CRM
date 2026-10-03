import { NextResponse } from "next/server";
import { adminDb } from "@/db/adminClient";
import { logger } from "@/lib/logger";

/**
 * FIG-595: a real health check, not just "the process is up" -- a query
 * failure here (DB unreachable, credentials wrong) is exactly the kind of
 * problem a container orchestrator's health check exists to catch, so it
 * can stop routing traffic to this instance instead of serving 500s.
 * Deliberately outside every other namespace (no org, no session) since
 * it has to be reachable before any of that is known to be working.
 */
export async function GET() {
  try {
    await adminDb.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    logger.error({ err }, "Health check failed: database unreachable");
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
