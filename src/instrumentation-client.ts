import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/sentryScrub";

/**
 * Browser-side Sentry init (FIG-753). Auto-loaded by Next.js -- this exact
 * filename/location is the convention `@sentry/nextjs`'s build plugin looks
 * for, no explicit import anywhere else is needed.
 *
 * A missing DSN (local dev, CI, or any environment that hasn't set one up)
 * makes this a complete no-op -- `Sentry.init` with an empty/undefined
 * `dsn` just never sends anything, so no account is required to run this
 * app locally.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  // This SDK version doesn't attach IP address/cookies/headers unless an
  // integration that does so is explicitly added (none are here) -- the
  // `beforeSend` scrub below is still the active defense for data the app
  // itself puts into an event (messages, extra context, breadcrumbs, the
  // `user` object).

  // A pilot-scale, cost-conscious default -- every error is still captured
  // regardless of this setting (it only affects performance traces).
  tracesSampleRate: 0.1,

  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});

// Required by the SDK to instrument App Router navigations -- see the
// build-time warning this silences in @sentry/nextjs's own source.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
