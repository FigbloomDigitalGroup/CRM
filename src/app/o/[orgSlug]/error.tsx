"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorState } from "@/ui/components/states";

/**
 * The app shell's error boundary (F1.05). A page that throws shows the shared error state inside the shell, so the sidebar and top bar stay
 * usable. A person sees our words and the reference (Next's `digest`), never the error's message or stack; Sentry gets the real error.
 * The sign-in pages keep the root boundary and are untouched.
 */
export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="fb-page-detail">
      <ErrorState error={{ status: 500, envelope: { requestId: error.digest ?? "" } }} onRetry={reset} />
    </div>
  );
}
