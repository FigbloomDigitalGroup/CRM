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
