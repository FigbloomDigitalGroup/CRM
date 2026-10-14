"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";

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
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Something went wrong</h1>
        <p className="warning" style={{ marginTop: 8 }}>
          An unexpected error occurred. You can try again, or head back to the
          dashboard.
        </p>
        <div className="stack">
          <button type="button" onClick={reset}>
            Try again
          </button>
          <p className="warning">
            <a href="/">Back to FigBloom CRM</a>
          </p>
        </div>
      </div>
    </div>
  );
}
