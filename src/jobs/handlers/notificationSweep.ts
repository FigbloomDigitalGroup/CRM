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

/** `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` (FIG-783 AC: "configurable through env") -- see docs/DEPLOYMENT.md's "Scheduled jobs" section. */
export function sweepIntervalMinutes(): number {
  const raw = Number(process.env.NOTIFICATIONS_SWEEP_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SWEEP_INTERVAL_MINUTES;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function sweepOrganization(organizationId: string): Promise<{
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
