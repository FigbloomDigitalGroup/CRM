import { refreshSignals } from "../services/signalService";
import { EXPORT_JOB, IMPORT_JOB, runExportJob, runImportJob } from "../services/dataRunService";
import { expireOldNotifications } from "../services/notificationCentreService";
import { recomputeAllScores } from "../services/scoreEngine";
import { runLifecycleSweep } from "../services/lifecycleService";
import { raiseDormantReminders, runReminders } from "../services/reminderService";
import { raiseStalledDealAlerts } from "../services/stalledDealAlerts";
import { MIGRATION_JOB } from "../services/migrationConstants";
import { runRetentionSweep } from "../services/privacyService";
import { runMigrationJob } from "../services/migrationService";
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

/**
 * Customer lifecycle (FIG-1048): dormant, renewal and back to active, re-evaluated from scratch each night so a changed
 * dormancy threshold is picked up. Owners of customers that just went dormant are told (FIG-795).
 */
registerJob({
  type: "lifecycle.sweep",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await runLifecycleSweep(ctx.organizationId);
    const { notified } = await raiseDormantReminders(ctx.organizationId, result.becameDormant);
    ctx.log.info({ checked: result.checked, toDormant: result.toDormant, toRenewal: result.toRenewal, toActive: result.toActive, notified }, "Lifecycle sweep done");
    return { checked: result.checked, toDormant: result.toDormant, toRenewal: result.toRenewal, toActive: result.toActive, notified };
  },
});

/** Proposal follow-ups, renewals coming up and overdue invoices (FIG-795, FIG-1050). Tells people; never decides anything. */
registerJob({
  type: "reminders.sweep",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await runReminders(ctx.organizationId);
    ctx.log.info({ ...result }, "Reminders sent");
    return JSON.parse(JSON.stringify(result));
  },
});

/** The automation rules that run on their own clock (FIG-1059): today the stalled deal alert. Only ever notifies. */
registerJob({
  type: "automations.sweep",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const stalled = await raiseStalledDealAlerts(ctx.organizationId);
    ctx.log.info({ ...stalled }, "Automation rules ran");
    return { stalledDeals: stalled };
  },
});

/**
 * One phase of a data migration (FIG-1061): validate, dry run, import or rollback. One attempt: the engine records its own
 * failures on the session, and repeating an import would only repeat work. Long on purpose: 50,000 rows are written in chunks.
 */
registerJob<{ sessionId: string; phase: "VALIDATE" | "DRY_RUN" | "IMPORT" | "ROLLBACK"; actorMembershipId?: string }>({
  type: MIGRATION_JOB,
  timeoutMs: 60 * 60_000,
  maxAttempts: 1,
  concurrency: 2,
  handler: async (ctx) => {
    await runMigrationJob(ctx.organizationId, ctx.payload, ctx.payload.actorMembershipId);
    return { sessionId: ctx.payload.sessionId, phase: ctx.payload.phase };
  },
});

/**
 * Retention (FIG-1062, B4.05): removes data older than the organisation's retention periods. Does nothing under a legal hold.
 * Safe to repeat; each purge is audited with its counts.
 */
registerJob({
  type: "privacy.retention",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 15 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await runRetentionSweep(ctx.organizationId);
    ctx.log.info({ ...result }, "Retention sweep done");
    return JSON.parse(JSON.stringify(result));
  },
});
