import pino from "pino";

/**
 * Basic error monitoring/logging (FIG-595). Structured JSON to stdout --
 * every container platform (and `docker logs`) already captures stdout,
 * so this needs no infrastructure of its own to be useful, unlike a real
 * error-tracking service (Sentry or similar), which would need a real
 * account/DSN this project doesn't have. That's a deliberate next step,
 * not built here: it would hook in at the same call sites as
 * `logger.error` below (see IMPLEMENTATION_NOTES.md).
 *
 * Pretty-printed in development (readable in a terminal); plain JSON
 * lines in production (what a log aggregator actually wants).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});
