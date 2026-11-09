import { deliverDueWebhooks } from "../services/webhookService";
import { registerJob } from "./registry";

/**
 * Outbound webhook delivery (FIG-804). Imported once from `definitions.ts`.
 *
 * The job sends every delivery of its organisation that is due: new ones (an event queues a job straight away) and retries whose backoff
 * has passed. Retry timing lives on the delivery row (`next_attempt_at`), not in the job, so the job itself always succeeds; a failing
 * receiver never makes the job framework retry or dead-letter anything. The schedule is the safety net for retries and for a missed kick.
 * It is safe to repeat: deliveries are claimed under a lease.
 */
registerJob({
  type: "webhooks.deliver",
  schedule: { everyMs: 5 * 60_000 },
  timeoutMs: 5 * 60_000,
  maxAttempts: 3,
  concurrency: 4,
  handler: async (ctx) => {
    const result = await deliverDueWebhooks(ctx.organizationId);
    if (result.claimed > 0) ctx.log.info({ ...result }, "Webhooks delivered");
    return { ...result };
  },
});
