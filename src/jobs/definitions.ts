import { refreshSignals } from "../services/signalService";
import { EXPORT_JOB, IMPORT_JOB, runExportJob, runImportJob } from "../services/dataRunService";
import { expireOldNotifications } from "../services/notificationCentreService";
import { recomputeAllScores } from "../services/scoreEngine";
import { registerJob } from "./registry";
import {
  NOTIFICATIONS_SWEEP_JOB_TYPE,
  sweepIntervalMinutes,
  sweepOrganization,
} from "./handlers/notificationSweep";

/**
 * Every job type the system runs. Add new handlers here (one `registerJob`
 * each) so the worker, the cron route and the tests all see the same list.
 */
registerJob({
  type: NOTIFICATIONS_SWEEP_JOB_TYPE,
  schedule: { everyMs: sweepIntervalMinutes() * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => {
    const result = await sweepOrganization(ctx.organizationId);
    if (result.due > 0 || result.overdue > 0 || result.retried > 0) {
      ctx.log.info({ deliveriesRetried: result.retried, due: result.due, overdue: result.overdue }, "Notifications sweep: organization processed");
    }
    return result;
  },
});

/** Lead scores and customer health are refreshed every night, besides whenever something relevant happens (FIG-1032). */
registerJob({
  type: "scores.recompute",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 15 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await recomputeAllScores(ctx.organizationId);
    ctx.log.info(result, "Scores recomputed");
    return result;
  },
});

/** Read notifications older than 90 days are removed daily; unread ones stay (FIG-1040). */
registerJob({
  type: "notifications.expire",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => expireOldNotifications(ctx.organizationId),
});

/**
 * Imports and exports people start (FIG-1034). One attempt each: the handler records
 * its own failures on the run, and running an import twice would only repeat work.
 */
registerJob<{ runId: string }>({
  type: IMPORT_JOB,
  timeoutMs: 30 * 60_000,
  maxAttempts: 1,
  concurrency: 2,
  handler: async (ctx) => {
    await runImportJob(ctx.payload.runId, ctx.organizationId);
    return { runId: ctx.payload.runId };
  },
});

registerJob<{ runId: string }>({
  type: EXPORT_JOB,
  timeoutMs: 30 * 60_000,
  maxAttempts: 1,
  concurrency: 2,
  handler: async (ctx) => {
    await runExportJob(ctx.payload.runId, ctx.organizationId);
    return { runId: ctx.payload.runId };
  },
});

/** Dashboard signals (adoption, stalled deals, overdue tasks) are recomputed every night (FIG-1043). */
registerJob({
  type: "signals.refresh",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const value = await refreshSignals(ctx.organizationId);
    return { computedAt: value.computedAt, stalledDeals: value.stalledDeals.total, overdueTasks: value.overdueTasks.total };
  },
});
