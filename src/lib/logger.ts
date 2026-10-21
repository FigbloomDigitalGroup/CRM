import pino from "pino";

/**
 * Basic error monitoring/logging (FIG-595). Structured JSON to stdout --
 * every container platform (and `docker logs`) already captures stdout,
 * so this needs no infrastructure of its own to be useful.
 *
 * Real error tracking (FIG-753) hooks in here via pino's `hooks.logMethod`
 * -- every `logger.error(...)`/`logger.fatal(...)` call site already in
 * the codebase (and any added later) also reports to Sentry, with no
 * per-call-site change needed. A missing `err`/message, or no DSN
 * configured, makes `reportToSentry` a no-op -- this still works exactly
 * as before in dev/test/CI, where no Sentry account exists.
 *
 * Pretty-printed in development (readable in a terminal); plain JSON
 * lines in production (what a log aggregator actually wants).
 */
const ERROR_LEVEL = 50;

/**
 * Both imports below are dynamic/lazy, not static top-of-file imports --
 * every call to `logger.error` would otherwise eagerly load `@sentry/nextjs`
 * (a large package) even when no DSN is configured at all, the common case
 * in dev/test/CI.
 *
 * (This was first suspected as the cause of a `MODULE_NOT_FOUND` on
 * `.next/server/vendor-chunks/lib/worker.js` crashing pino-pretty's
 * worker-thread transport in Next.js dev mode -- confirmed NOT the cause by
 * reverting this entire file to its pre-FIG-753 pino-only version and
 * reproducing the exact same crash. It's a pre-existing dev-mode-only
 * pino-pretty/Next.js/Node interaction, unrelated to Sentry or this
 * change -- doesn't affect production, where this transport is disabled
 * entirely (see the `NODE_ENV === "production"` check below). Left as a
 * dynamic import anyway since it's the right call regardless.)
 */
async function reportToSentry(args: unknown[]): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  const [Sentry, { scrubPII }] = await Promise.all([
    import("@sentry/nextjs"),
    import("./sentryScrub"),
  ]);

  const [first, second] = args;
  const context = typeof first === "object" && first !== null
    ? (first as Record<string, unknown>)
    : undefined;
  const message =
    typeof first === "string" ? first : typeof second === "string" ? second : undefined;

  const { err, ...rest } = context ?? {};
  Sentry.captureException(err instanceof Error ? err : new Error(message ?? "Unhandled error"), {
    extra: scrubPII(rest) as Record<string, unknown>,
  });
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
  hooks: {
    logMethod(args, method, level) {
      if (level >= ERROR_LEVEL) {
        // Fire-and-forget -- logging itself must never fail or block on
        // Sentry reporting. A rejection here (a bad DSN, a network blip)
        // only gets a console warning, never an unhandled rejection.
        reportToSentry(args).catch((err) => {
          // eslint-disable-next-line no-console -- the logger itself can't
          // be used to report a failure in its own Sentry bridge.
          console.error("Failed to report error to Sentry:", err);
        });
      }
      return method.apply(this, args);
    },
  },
});
