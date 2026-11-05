import { NextResponse } from "next/server";
import { secretsMatch } from "@/auth/secretCompare";
import { logger } from "@/lib/logger";
import { sampleJobQueue } from "@/observability/jobQueue";
import { renderMetrics } from "@/observability/metrics";

/**
 * Prometheus text metrics (P1.02, FIG-1124): request counts, errors, latency
 * histogram, and job queue depth and lag. Guarded by `METRICS_TOKEN` (bearer
 * or `x-metrics-token`), the same pattern as the cron routes; with no token
 * configured the endpoint answers 404, so it is off unless someone turns it on.
 * Not a tenant route: it exposes only counts, never record data.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.METRICS_TOKEN;
  if (!secret) return new NextResponse("Not found", { status: 404 });

  const auth = request.headers.get("authorization");
  const provided = auth?.toLowerCase().startsWith("bearer ") ? auth.slice("bearer ".length) : request.headers.get("x-metrics-token");
  if (!secretsMatch(provided, secret)) return new NextResponse("Unauthorized", { status: 401 });

  let jobs;
  try {
    jobs = await sampleJobQueue();
  } catch (err) {
    // Request metrics are still worth serving when the database is down; the gauges are simply absent, and the health check pages for the database.
    logger.error({ err }, "Metrics: could not read the job queue");
  }
  return new NextResponse(renderMetrics(jobs), {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}
