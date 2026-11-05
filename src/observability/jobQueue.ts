import { adminDb } from "@/db/adminClient";
import type { JobQueueSample } from "./metrics";

/**
 * Queue depth and lag per job type, across every organisation (P1.02, FIG-1124). Counts only, never payloads or organisation names, so the
 * result is safe to expose on the metrics endpoint. Lag is the age of the oldest QUEUED job whose run time has already passed (docs/JOBS.md).
 */
export async function sampleJobQueue(): Promise<JobQueueSample[]> {
  const rows = await adminDb.$queryRaw<
    { type: string; queued: bigint; running: bigint; dead: bigint; oldest_due_seconds: number | null }[]
  >`
    SELECT type,
      COUNT(*) FILTER (WHERE status = 'QUEUED') AS queued,
      COUNT(*) FILTER (WHERE status = 'RUNNING') AS running,
      COUNT(*) FILTER (WHERE status = 'DEAD') AS dead,
      EXTRACT(EPOCH FROM (now() - MIN(run_at) FILTER (WHERE status = 'QUEUED' AND run_at <= now())))::float8 AS oldest_due_seconds
    FROM background_jobs
    WHERE status IN ('QUEUED', 'RUNNING', 'DEAD')
    GROUP BY type
    ORDER BY type`;
  return rows.map((r) => ({
    type: r.type,
    queued: Number(r.queued),
    running: Number(r.running),
    dead: Number(r.dead),
    oldestDueSeconds: Math.max(0, Math.round(r.oldest_due_seconds ?? 0)),
  }));
}
