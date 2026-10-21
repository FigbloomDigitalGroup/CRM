import { notFound } from "next/navigation";
import { SentryTestButtons } from "./SentryTestButtons";

/**
 * Dev-only page to verify FIG-753 (Sentry error tracking) end-to-end: both
 * buttons trigger a real, deliberate error through the actual app code paths
 * (error.tsx boundary / the logger.error -> Sentry bridge), not a mock.
 * Enabled ONLY when NODE_ENV is explicitly "development" (FIG-605 convention,
 * see src/app/dev-login/page.tsx).
 */
export default function DevSentryTestPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      <h1 style={{ fontSize: 19 }}>Sentry test (FIG-753)</h1>
      <p className="warning">
        Dev-only page, unavailable outside local development. Requires
        `NEXT_PUBLIC_SENTRY_DSN` to be set for anything to actually reach
        Sentry -- see docs/DEPLOYMENT.md.
      </p>
      <SentryTestButtons />
    </div>
  );
}
