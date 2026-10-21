import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { listTasks } from "../repositories/tasks";
import {
  getJobRunState,
  releaseJobLock,
  tryAcquireJobLock,
  type ScheduledJobRunState,
} from "../repositories/scheduledJobRuns";
import {
  notifyTaskDue,
  notifyTaskOverdue,
  retryDueDeliveries,
} from "./notificationService";

export const NOTIFICATIONS_SWEEP_JOB_KEY = "notifications-sweep";
const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_STALE_LOCK_MINUTES = 15;

/** `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` (FIG-783 AC: "configurable through env") -- see docs/DEPLOYMENT.md's "Scheduled jobs" section. */
export function sweepIntervalMinutes(): number {
  const raw = Number(process.env.NOTIFICATIONS_SWEEP_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MINUTES;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function sweepOrganization(organizationId: string): Promise<{
  due: number;
  overdue: number;
  retried: number;
}> {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const dueToday = await listTasks(organizationId, {
    dueAfter: today,
    dueBefore: tomorrow,
  });
  for (const task of dueToday) {
    if (task.status !== "PENDING" && task.status !== "IN_PROGRESS") continue;
    await notifyTaskDue(organizationId, task.assigneeMembershipId, {
      id: task.id,
      title: task.title,
    });
  }

  const overdue = await listTasks(organizationId, { overdueOnly: true });
  for (const task of overdue) {
    await notifyTaskOverdue(organizationId, task.assigneeMembershipId, {
      id: task.id,
      title: task.title,
    });
  }

  const { attempted } = await retryDueDeliveries(organizationId);
  return { due: dueToday.length, overdue: overdue.length, retried: attempted };
}

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

    for (const org of organizations) {
      try {
        const { due, overdue, retried } = await sweepOrganization(org.id);
        if (due > 0 || overdue > 0 || retried > 0) {
          logger.info(
            { orgSlug: org.slug, due, overdue, deliveriesRetried: retried },
            "Notifications sweep: organization processed",
          );
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

/** Read-only status for `/api/health` and anything else that wants to show the last successful sweep time (FIG-783 AC). */
export async function getNotificationsSweepStatus(
  jobKey: string = NOTIFICATIONS_SWEEP_JOB_KEY,
): Promise<ScheduledJobRunState | null> {
  return getJobRunState(jobKey);
}
