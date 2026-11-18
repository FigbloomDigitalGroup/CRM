import { runScheduledSend, syncAllMailboxes, syncMailbox } from "../services/mailService";
import { syncAllCalendars, syncCalendar } from "../services/meetingService";
import { ConnectionUnavailableError, refreshExpiringConnections } from "../services/oauthConnectionService";
import { registerJob } from "./registry";

/**
 * Jobs for the OAuth connection framework and the mail and calendar sync built on it (FIG-1153, FIG-807, FIG-808).
 * Imported once from `definitions.ts`, so the worker, the cron route and the tests all see them.
 * Every handler is safe to repeat and touches only its own organisation.
 */

/** Refreshes access tokens that expire soon, so a sync or a send never starts with a dead token. */
registerJob({
  type: "oauth.refresh",
  schedule: { everyMs: 30 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await refreshExpiringConnections(ctx.organizationId);
    if (result.failed > 0) ctx.log.warn({ ...result }, "Some connections could not be refreshed");
    return result;
  },
});

/** Pulls mail for every connected mailbox of the organisation, or for one connection when the payload names it ("Sync now"). */
registerJob<{ connectionId?: string }>({
  type: "mail.sync",
  schedule: { everyMs: 5 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => {
    if (!ctx.payload?.connectionId) return { ...(await syncAllMailboxes(ctx.organizationId)) };
    try {
      return { ...(await syncMailbox(ctx.organizationId, ctx.payload.connectionId)) };
    } catch (err) {
      // A disconnected mailbox is a state, not a failure to retry.
      if (err instanceof ConnectionUnavailableError) return { skipped: err.state };
      throw err;
    }
  },
});

/** Sends one scheduled email at its time, as its owner. A draft that is no longer scheduled is left alone. */
registerJob<{ draftId: string }>({
  type: "mail.send_scheduled",
  timeoutMs: 5 * 60_000,
  maxAttempts: 1,
  concurrency: 4,
  handler: async (ctx) => ({ ...(await runScheduledSend(ctx.organizationId, ctx.payload.draftId)) }),
});

/** Pulls calendar events and pushes changes for every connected calendar of the organisation, or for one when the payload names it. */
registerJob<{ connectionId?: string }>({
  type: "calendar.sync",
  schedule: { everyMs: 10 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => {
    if (!ctx.payload?.connectionId) return { ...(await syncAllCalendars(ctx.organizationId)) };
    try {
      return { ...(await syncCalendar(ctx.organizationId, ctx.payload.connectionId)) };
    } catch (err) {
      if (err instanceof ConnectionUnavailableError) return { skipped: err.state };
      throw err;
    }
  },
});
