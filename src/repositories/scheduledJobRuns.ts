import { adminDb } from "../db/adminClient";

export interface ScheduledJobRunState {
  jobKey: string;
  status: "IDLE" | "RUNNING";
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
}

/**
 * Compare-and-swap lock for a recurring job (FIG-783): flips `IDLE` ->
 * `RUNNING` in one `updateMany`, which Postgres executes as a single
 * UPDATE statement -- if two callers race for the same `jobKey`, Postgres
 * serializes their statements against that row, so only one can ever see
 * it as still matching `IDLE` and actually make the change. The other's
 * `updateMany` affects zero rows, which is how it learns it lost the race.
 *
 * `staleAfterMs` reclaims a lock left `RUNNING` by a run that crashed
 * without releasing it (a killed process, an OOM) -- without this, one bad
 * deploy would wedge the job forever. Ordinary current-process overlap
 * only hits the plain `status = 'IDLE'` branch; the staleness branch is a
 * crash-recovery backstop, not the normal unlock path.
 */
export async function tryAcquireJobLock(
  jobKey: string,
  staleAfterMs: number,
): Promise<boolean> {
  await adminDb.scheduledJobRun.upsert({
    where: { jobKey },
    create: { jobKey },
    update: {},
  });

  const staleBefore = new Date(Date.now() - staleAfterMs);
  const { count } = await adminDb.scheduledJobRun.updateMany({
    where: {
      jobKey,
      OR: [
        { status: "IDLE" },
        { status: "RUNNING", startedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "RUNNING", startedAt: new Date(), lastError: null },
  });
  return count === 1;
}

/** Always releases back to `IDLE` regardless of outcome -- a failed run must not keep the lock held. */
export async function releaseJobLock(
  jobKey: string,
  outcome: { success: true } | { success: false; error: string },
): Promise<ScheduledJobRunState> {
  return adminDb.scheduledJobRun.update({
    where: { jobKey },
    data: {
      status: "IDLE",
      ...(outcome.success
        ? { completedAt: new Date(), lastError: null }
        : { lastError: outcome.error }),
    },
    select: {
      jobKey: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastError: true,
    },
  });
}

export interface JobTypeOutcome {
  /** `finished_at` of the most recent SUCCEEDED job of this type, in any organisation; `null` if none has succeeded. */
  lastSucceededAt: Date | null;
  /** True when the most recent DEAD job of this type ended after the last success (or none has ever succeeded). */
  failedSinceLastSuccess: boolean;
}

/**
 * The newest outcome of one background job type across every organisation, for health checks (D-4, MVP-16). The
 * scheduler route `/api/cron/jobs` runs scheduled work as `background_jobs` rows (one per organisation), so this, not
 * the legacy `scheduled_job_runs` lock row, shows when that work last ran. Uses the owner client on purpose: a health
 * check has no organisation, and it reads two timestamps, no tenant data. The error text of a dead job is NOT
 * returned: `/api/health` is public, and that text can name tables or hosts.
 */
export async function getJobTypeOutcome(type: string): Promise<JobTypeOutcome> {
  const [succeeded, dead] = await Promise.all([
    adminDb.backgroundJob.findFirst({
      where: { type, status: "SUCCEEDED", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    adminDb.backgroundJob.findFirst({
      where: { type, status: "DEAD", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  const lastSucceededAt = succeeded?.finishedAt ?? null;
  const failedSinceLastSuccess =
    dead?.finishedAt != null && (lastSucceededAt === null || dead.finishedAt > lastSucceededAt);
  return { lastSucceededAt, failedSinceLastSuccess };
}

/** Read-only status for health checks/dashboards -- `null` if the job has never run. */
export async function getJobRunState(
  jobKey: string,
): Promise<ScheduledJobRunState | null> {
  return adminDb.scheduledJobRun.findUnique({
    where: { jobKey },
    select: {
      jobKey: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastError: true,
    },
  });
}
