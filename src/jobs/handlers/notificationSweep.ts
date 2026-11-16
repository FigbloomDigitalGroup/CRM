import { listTasks } from "../../repositories/tasks";
import { notifyTaskDue, notifyTaskOverdue, retryDueDeliveries } from "../../services/notificationService";

/**
 * The notifications sweep for one organisation (FIG-783), now a job type on the
 * background framework (FIG-1066, B2.18): due-today and overdue task
 * notifications plus the retry of failed email deliveries. Notifications are
 * already idempotent per task, so a repeated run sends nothing twice.
 */
export const NOTIFICATIONS_SWEEP_JOB_TYPE = "notifications.sweep";
export const DEFAULT_SWEEP_INTERVAL_MINUTES = 15;
/** Tasks read per round trip by the sweep. */
export const SWEEP_BATCH_SIZE = 200;

/** `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` (FIG-783 AC: "configurable through env") -- see docs/DEPLOYMENT.md's "Scheduled jobs" section. */
export function sweepIntervalMinutes(): number {
  const raw = Number(process.env.NOTIFICATIONS_SWEEP_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SWEEP_INTERVAL_MINUTES;
}

export async function sweepOrganization(
  organizationId: string,
  options: { batchSize?: number; /** For tests: the current time. */ now?: Date } = {},
): Promise<{
  due: number;
  overdue: number;
  retried: number;
}> {
  const batchSize = options.batchSize ?? SWEEP_BATCH_SIZE;
  // A reminder is for the task's own time, not for the start of its day (P2-27): "due" goes out when the due time falls inside the next sweep
  // interval, so it arrives at (or at most one sweep before) the follow-up time. After the time has passed the task is overdue, counted from that time.
  const now = options.now ?? new Date();
  const windowEnd = new Date(now.getTime() + sweepIntervalMinutes() * 60_000);

  // Tasks are read a batch at a time (stable order, so skip/take never repeats or misses a row) instead of loading every one into memory.
  let due = 0;
  for (let skip = 0; ; skip += batchSize) {
    const batch = await listTasks(organizationId, {
      dueAfter: now,
      dueBefore: windowEnd,
      statuses: ["PENDING", "IN_PROGRESS"],
      take: batchSize,
      skip,
    });
    for (const task of batch) {
      await notifyTaskDue(organizationId, task.assigneeMembershipId, {
        id: task.id,
        title: task.title,
      });
      due += 1;
    }
    if (batch.length < batchSize) break;
  }

  let overdue = 0;
  for (let skip = 0; ; skip += batchSize) {
    const batch = await listTasks(organizationId, { overdueOnly: true, overdueAt: now, take: batchSize, skip });
    for (const task of batch) {
      await notifyTaskOverdue(organizationId, task.assigneeMembershipId, {
        id: task.id,
        title: task.title,
      });
      overdue += 1;
    }
    if (batch.length < batchSize) break;
  }

  const { attempted } = await retryDueDeliveries(organizationId);
  return { due, overdue, retried: attempted };
}
