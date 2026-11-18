import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { enqueueAndRunNow } from "../jobs/runner";
import {
  NOTIFICATIONS_SWEEP_JOB_TYPE,
  sweepIntervalMinutes,
} from "../jobs/handlers/notificationSweep";
import {
  getJobRunState,
  getJobTypeOutcome,
  releaseJobLock,
  tryAcquireJobLock,
  type ScheduledJobRunState,
} from "../repositories/scheduledJobRuns";

export const NOTIFICATIONS_SWEEP_JOB_KEY = "notifications-sweep";
export { sweepIntervalMinutes };
const MIN_STALE_LOCK_MINUTES = 15;

export interface NotificationSweepResult {
  ran: boolean;
  skippedReason?: "locked" | "throttled";
  organizationsSwept?: number;
  jobRun: ScheduledJobRunState;
}

export interface RunNotificationsSweepOptions {
  /**
   * Overrides the lock/throttle row's key -- test-only seam so
   * `tests/notificationSweepService.test.ts` can exercise the locking
   * mechanics under a disposable key instead of sharing the one real row
   * every environment and test file would otherwise contend over. Every
   * real caller (the CLI script, the cron route) omits this and gets the
   * real `NOTIFICATIONS_SWEEP_JOB_KEY`.
   */
  jobKey?: string;
  /**
   * Restricts which organizations get swept -- test-only seam so a test
   * isn't also sweeping every organization every other test file has
   * created in the shared test database. Every real caller omits this and
   * gets every ACTIVE organization, which is the actual point of the job.
   */
  organizationIds?: string[];
}

/**
 * FIG-783: the notifications due/overdue sweep + email-delivery-retry job,
 * runnable from anywhere that needs it to actually happen -- the CLI
 * script (`scripts/notifications-sweep.ts`, for a VPS/sidecar cron) and
 * the authenticated `/api/cron/notifications-sweep` route (for a platform
 * scheduler or external cron hitting a URL) both just call this. All the
 * actual per-org business logic was previously only in the script; moved
 * here so neither caller re-implements it.
 *
 * Two independent guards against double-sending (AC: "overlapping runs
 * can't double-send"), on top of notifications themselves already being
 * idempotent per-task (see notificationService.ts):
 *
 *   1. A self-throttle: skip entirely if the last successful run completed
 *      less than `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` ago, so a
 *      misconfigured or too-eager trigger (external cron set to run every
 *      minute, a manual call layered on top of the real schedule) can't
 *      force extra runs.
 *   2. A DB-backed lock (`scheduledJobRuns.ts`): if a run is already in
 *      flight, a second concurrent trigger (two replicas on the same
 *      schedule, a slow run overlapping the next tick) is skipped rather
 *      than running alongside it and re-attempting the same pending email
 *      deliveries.
 */
export async function runNotificationsSweep(
  options: RunNotificationsSweepOptions = {},
): Promise<NotificationSweepResult> {
  const jobKey = options.jobKey ?? NOTIFICATIONS_SWEEP_JOB_KEY;
  const intervalMs = sweepIntervalMinutes() * 60_000;
  const staleAfterMs = Math.max(sweepIntervalMinutes(), MIN_STALE_LOCK_MINUTES) * 3 * 60_000;

  const existing = await getJobRunState(jobKey);
  if (existing?.completedAt && Date.now() - existing.completedAt.getTime() < intervalMs) {
    return { ran: false, skippedReason: "throttled", jobRun: existing };
  }

  const acquired = await tryAcquireJobLock(jobKey, staleAfterMs);
  if (!acquired) {
    logger.info({ jobKey }, "Notifications sweep already running elsewhere -- skipped");
    return {
      ran: false,
      skippedReason: "locked",
      jobRun: existing ?? (await getJobRunState(jobKey))!,
    };
  }

  try {
    const organizations = await adminDb.organization.findMany({
      where: {
        status: "ACTIVE",
        ...(options.organizationIds ? { id: { in: options.organizationIds } } : {}),
      },
      select: { id: true, slug: true },
    });

    // Each organisation's sweep runs as a background job (FIG-1066): it is
    // logged with the organisation, retried by the framework when it fails, and
    // visible in the job status API. One organisation failing never stops the rest.
    for (const org of organizations) {
      try {
        const run = await enqueueAndRunNow({ organizationId: org.id, type: NOTIFICATIONS_SWEEP_JOB_TYPE });
        if (run.outcome !== "succeeded") {
          logger.error({ orgSlug: org.slug, outcome: run.outcome }, "Notifications sweep failed for organization");
        }
      } catch (err) {
        logger.error({ err, orgSlug: org.slug }, "Notifications sweep failed for organization");
      }
    }

    const jobRun = await releaseJobLock(jobKey, { success: true });
    logger.info(
      { jobKey, organizations: organizations.length, completedAt: jobRun.completedAt },
      "Notifications sweep completed",
    );
    return { ran: true, organizationsSwept: organizations.length, jobRun };
  } catch (err) {
    // Unlike a single organization's failure above (logged and skipped so
    // the rest of the sweep still runs), a throw here means something
    // broke the sweep itself (e.g. the organizations query failed) --
    // release the lock so the next scheduled attempt isn't blocked, record
    // the error for `getNotificationsSweepStatus`, then let the caller
    // (CLI script / cron route) decide how to surface the failure.
    const message = err instanceof Error ? err.message : "Unknown sweep error.";
    await releaseJobLock(jobKey, { success: false, error: message });
    logger.error({ err, jobKey }, "Notifications sweep crashed");
    throw err;
  }
}

/** Shown instead of the job's own error: `/api/health` is public and a raw error can name tables or hosts. */
export const SWEEP_JOB_FAILED_MESSAGE = "The latest scheduled notifications sweep failed; see the job log.";

export interface NotificationsSweepStatusOptions {
  /**
   * Which background job type to read the scheduled runs from. Defaults to the real sweep job when `jobKey` is the
   * real key, and to none otherwise -- a test-only seam like `RunNotificationsSweepOptions.jobKey`, so a test can use
   * a disposable type instead of reading every organisation's real sweep rows.
   */
  jobType?: string;
}

/**
 * Read-only status for `/api/health` and anything else that wants to show the last successful sweep time (FIG-783 AC).
 *
 * The sweep now runs two ways: the legacy, throttled route (`/api/cron/notifications-sweep`, which records its run in
 * `scheduled_job_runs`) and the job framework (`/api/cron/jobs`: one `notifications.sweep` background job per
 * organisation every `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES`). On a host with only the second (the Vercel MVP), the legacy
 * row moves once a day at best, so `lastCompletedAt` is the later of the two. The shape is unchanged.
 */
export async function getNotificationsSweepStatus(
  jobKey: string = NOTIFICATIONS_SWEEP_JOB_KEY,
  options: NotificationsSweepStatusOptions = {},
): Promise<ScheduledJobRunState | null> {
  const legacy = await getJobRunState(jobKey);
  const jobType = options.jobType ?? (jobKey === NOTIFICATIONS_SWEEP_JOB_KEY ? NOTIFICATIONS_SWEEP_JOB_TYPE : undefined);
  if (!jobType) return legacy;

  const outcome = await getJobTypeOutcome(jobType);
  if (outcome.lastSucceededAt === null && !outcome.failedSinceLastSuccess) return legacy;

  const legacyAt = legacy?.completedAt ?? null;
  const completedAt =
    outcome.lastSucceededAt !== null && (legacyAt === null || outcome.lastSucceededAt > legacyAt)
      ? outcome.lastSucceededAt
      : legacyAt;
  const lastError = legacy?.lastError ?? (outcome.failedSinceLastSuccess ? SWEEP_JOB_FAILED_MESSAGE : null);
  return {
    jobKey,
    status: legacy?.status ?? "IDLE",
    startedAt: legacy?.startedAt ?? null,
    completedAt,
    lastError,
  };
}
