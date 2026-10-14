import * as Sentry from "@sentry/nextjs";

/**
 * Server/edge Sentry init (FIG-753) -- Next.js's own instrumentation hook
 * (not Sentry-specific naming; this file and `register()` are a built-in
 * Next.js convention Sentry's build plugin also relies on). Runs once per
 * server process/edge isolate before any request is handled.
 *
 * This app has no edge-runtime routes today (no `middleware.ts`, no route
 * declares `export const runtime = "edge"`), so the `edge` branch is dead
 * code for now -- kept anyway so adding one later doesn't silently skip
 * Sentry for it.
 */
export async function register() {
  // No integration here attaches IP address/cookies/headers by default in
  // this SDK version -- `beforeSend` (scrubSentryEvent) is the active
  // defense for data the app itself puts into an event.
  const sharedOptions = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scrubSentryEvent } = await import("./lib/sentryScrub");
    Sentry.init({
      ...sharedOptions,
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { scrubSentryEvent } = await import("./lib/sentryScrub");
    Sentry.init({
      ...sharedOptions,
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
    });
  }
}

/**
 * Reports errors Next.js itself catches during rendering/data fetching
 * (the framework-level counterpart to `global-error.tsx`'s client-render
 * catch and `handleRoute.ts`'s API-route catch) -- `captureRequestError`
 * applies the same client Sentry was `init`-ed with above, so the same
 * `beforeSend` scrub still runs.
 */
export const onRequestError = Sentry.captureRequestError;
