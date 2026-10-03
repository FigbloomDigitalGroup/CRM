import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { listTasks } from "../src/repositories/tasks";
import {
  notifyTaskDue,
  notifyTaskOverdue,
  retryDueDeliveries,
} from "../src/services/notificationService";

/**
 * FIG-597's periodic job: generates "due today"/"overdue" task
 * notifications and retries any failed delivery whose backoff has elapsed.
 * There is no job queue or scheduler in this project's deployment (single
 * Docker image, no sidecar -- see docs/DEPLOYMENT.md), so this is a plain
 * script meant to be invoked on an interval (every 15-30 minutes is
 * reasonable) by whatever recurring-task mechanism the deploy host
 * provides -- a VPS cron entry, a platform "scheduled job" feature, a
 * Kubernetes CronJob, etc. `npm run notifications:sweep` runs it once.
 *
 * Idempotent by design: a task only ever gets one TASK_DUE and one
 * TASK_OVERDUE notification, ever (see the unique index on Notification),
 * so running this every 15 minutes instead of once a day doesn't spam
 * anyone -- it only means a newly-due/overdue task is noticed sooner.
 *
 * Runs per-organization (not one cross-tenant query) so every write still
 * goes through the normal `withOrgContext`-scoped path, same as any other
 * application code -- this script's only privilege over a regular request
 * is listing every organization id up front, not touching business data
 * outside RLS.
 */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function sweepOrganization(organizationId: string): Promise<void> {
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
  if (dueToday.length > 0 || overdue.length > 0 || attempted > 0) {
    console.log(
      `[${organizationId}] due=${dueToday.length} overdue=${overdue.length} deliveries_retried=${attempted}`,
    );
  }
}

async function main() {
  const organizations = await adminDb.organization.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slug: true },
  });
  for (const org of organizations) {
    try {
      await sweepOrganization(org.id);
    } catch (err) {
      console.error(`Sweep failed for organization ${org.slug}:`, err);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
