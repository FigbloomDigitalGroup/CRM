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
import { CHAT_NOTIFY_JOB, deliverChatNotifications } from "../services/chatService";
import { ORG_EXPORT_JOB } from "./offboardingJobs";
import { runOrganisationExportJob } from "../services/platformDataRequestService";
import { runDueSequences } from "../sequences/engine";
import { expireSupportAccess } from "../services/supportAccessService";
import { TEAM_DIGEST_JOB, flushTeamActivityDigests } from "../services/teamActivityNotifier";
import { registerJob } from "./registry";
import "./integrationJobs";
import "./webhookJobs";
import "./churnJobs";
import { FILES_PURGE_JOB_TYPE, purgeOrganizationFiles } from "./handlers/filePurge";
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

/** Bytes of deleted and quarantined files are removed from the object store after the retention window; the row and its audit trail stay. Logs counts only. */
registerJob({
  type: FILES_PURGE_JOB_TYPE,
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 15 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await purgeOrganizationFiles(ctx.organizationId);
    if (result.purged > 0) ctx.log.info({ purged: result.purged }, "File purge done");
    return result;
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

/**
 * Chat mentions and direct messages (FIG-1383, B6.25): one job per message, queued when it is posted. It notifies (and pushes to) each
 * person mentioned, and the other person in a direct message, but only where they may see the record the message names. Safe to repeat.
 */
registerJob<{ messageId: string }>({
  type: CHAT_NOTIFY_JOB,
  timeoutMs: 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => deliverChatNotifications(ctx.organizationId, ctx.payload.messageId),
});

/** B6.09: packages an organisation's data for an approved export or deletion request. The only job that runs while an organisation is offboarding. */
registerJob<{ requestId: string }>({
  type: ORG_EXPORT_JOB,
  timeoutMs: 15 * 60_000,
  maxAttempts: 3,
  concurrency: 1,
  handler: async (ctx) => {
    const result = await runOrganisationExportJob(ctx.organizationId, ctx.payload.requestId);
    ctx.log.info(result, "Organisation export packaged");
    return result;
  },
});

/** Follow-up sequences (FIG-1150): runs the steps that have come due and pauses enrolments whose person replied. Safe to repeat: each step is claimed once. */
registerJob({
  type: "sequences.run",
  schedule: { everyMs: 15 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await runDueSequences({ organizationId: ctx.organizationId });
    if (result.enrollments > 0) ctx.log.info(result, "Follow-up sequences: due enrolments processed");
    return result;
  },
});

/**
 * Support access (FIG-1183, B7.01): requests, approvals and sessions the clock has passed are marked EXPIRED, and Management is told when a
 * session ran out. Reads never wait for this (the database function compares the clock itself), so a late run costs nothing but tidiness.
 */
registerJob({
  type: "support_access.expire",
  schedule: { everyMs: 5 * 60_000 },
  timeoutMs: 2 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => expireSupportAccess(ctx.organizationId),
});

// FIG-1600 (P2-17): hourly and daily team activity digests for Management, grouped ("Amina added 12 leads in the last hour").
registerJob({
  type: TEAM_DIGEST_JOB,
  schedule: { everyMs: 5 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => {
    const result = await flushTeamActivityDigests(ctx.organizationId);
    if (result.groups > 0) ctx.log.info({ ...result }, "Team activity digests sent");
    return result;
  },
});
