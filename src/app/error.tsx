"use client";

import { BrandMark } from "@/app/_shared/BrandMark";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
