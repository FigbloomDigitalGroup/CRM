import { refreshChurnHints } from "../services/churnHintService";
import { registerJob } from "./registry";

/**
 * Churn hints (FIG-1190, B7.08): every night each organisation's customers are looked at again. Does nothing for an organisation that has the
 * assistant or its churn option off. Safe to repeat. Imported once from `definitions.ts`.
 */
registerJob({
  type: "churn.hints.refresh",
  schedule: { everyMs: 24 * 60 * 60_000 },
  timeoutMs: 10 * 60_000,
  maxAttempts: 3,
  concurrency: 2,
  handler: async (ctx) => {
    const result = await refreshChurnHints(ctx.organizationId);
    if (result.created + result.updated + result.resolved > 0) ctx.log.info({ ...result }, "Churn hints refreshed");
    return { ...result };
  },
});
