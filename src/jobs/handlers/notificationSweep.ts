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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function sweepOrganization(
  organizationId: string,
  options: { batchSize?: number } = {},
): Promise<{
  due: number;
  overdue: number;
  retried: number;
}> {
  const batchSize = options.batchSize ?? SWEEP_BATCH_SIZE;
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  // Tasks are read a batch at a time (stable order, so skip/take never repeats or misses a row) instead of loading every one into memory.
  let due = 0;
  for (let skip = 0; ; skip += batchSize) {
    const batch = await listTasks(organizationId, {
      dueAfter: today,
      dueBefore: tomorrow,
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
    const batch = await listTasks(organizationId, { overdueOnly: true, take: batchSize, skip });
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
