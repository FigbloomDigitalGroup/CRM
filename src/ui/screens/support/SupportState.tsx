"use client";

import type { ReactNode } from "react";
import { QueryFailure } from "../../featureUnavailable";
import { LoadingState } from "../../components/states";

/** What every Customer Support screen shows while its data loads or fails: loading, the feature switch, explained no access, error with retry. */
export function SupportQueryState({
  query,
  area,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  area: string;
  children: ReactNode;
}) {
  if (query.isPending) return <LoadingState label={`Loading ${area.toLowerCase()}`} />;
  if (query.isError) return <QueryFailure error={query.error} area={area} onRetry={() => void query.refetch()} />;
  return <>{children}</>;
}
