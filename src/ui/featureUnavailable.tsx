"use client";

import { EmptyState, ErrorState } from "./components/states";

/**
 * The explained "not available yet" state (B0.07). A V1.1 route answers 403 `FEATURE_UNAVAILABLE` with a `feature` block when the
 * organisation is not on the release or the toggle is off; that is a normal state, not a failure, so screens show it as an empty state
 * with the reason instead of the generic error.
 */
export interface FeatureNotice {
  key: string;
  reason: "release" | "toggle";
  availableIn: string | null;
}

export function featureNotice(error: unknown): FeatureNotice | null {
  const envelope = (error as { envelope?: { code?: string; feature?: FeatureNotice } } | null)?.envelope;
  if (envelope?.code !== "FEATURE_UNAVAILABLE") return null;
  return envelope.feature ?? { key: "unknown", reason: "release", availableIn: null };
}

/** What a screen shows when its read failed: the not-available explanation, the explained no-access, or the generic error with retry. */
export function QueryFailure({ error, area, onRetry }: { error: unknown; area: string; onRetry?: () => void }) {
  const feature = featureNotice(error);
  if (feature) {
    return (
      <EmptyState
        title={`${area} is not available yet`}
        body={
          feature.reason === "toggle"
            ? "This feature is switched off for your organisation. Ask your Management users to turn it on."
            : `This arrives with ${feature.availableIn ?? "the next release"}. Your organisation is not on it yet.`
        }
      />
    );
  }
  return <ErrorState error={error} area={area} onRetry={onRetry} />;
}
