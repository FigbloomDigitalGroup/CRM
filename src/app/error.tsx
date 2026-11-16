"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AuthLayout } from "@/app/_shared/AuthLayout";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // FIG-753: this boundary catches render errors Next.js's own
  // instrumentation (captureRequestError, wired in instrumentation.ts)
  // doesn't see -- client-side render/hydration failures, not data-
  // fetching/route-handler errors. Sentry's beforeSend (instrumentation-
  // client.ts) still scrubs whatever this reports.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <AuthLayout title="Something went wrong" lead="An unexpected error occurred. Nothing you saved has been lost. You can try again, or go back to FigBloom CRM.">
      <div className="auth-actions">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <a className="auth-btn auth-btn--quiet" href="/">
          Back to FigBloom CRM
        </a>
      </div>
      {error.digest ? (
        <p className="auth-ref">
          If this keeps happening, tell support this reference: <code>{error.digest}</code>
        </p>
      ) : null}
    </AuthLayout>
  );
}
