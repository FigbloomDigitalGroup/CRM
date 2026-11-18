"use client";

import { LoadingState } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { useQuotePreview } from "./api";

/**
 * The quote as the client receives it (Q1 "Quote document preview"): the API renders the exact HTML that is sent (`GET .../preview`), so the preview
 * can never differ from the sent document, and it carries no cost or margin whoever is previewing. It is shown in a sandboxed frame (the document brings its own styles).
 */
export function QuoteDocument({ orgSlug, quoteId, version, number }: { orgSlug: string; quoteId: string; version: number; number: string }) {
  const q = useQuotePreview(orgSlug, quoteId, version, true);
  if (q.isLoading) return <LoadingState label="Loading the document" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="The quote document" onRetry={() => void q.refetch()} />;
  return (
    <section className="fb-com-doc" data-screen-label="Quote document preview" aria-label={`Quote ${number} document preview`}>
      <iframe title={`Quote ${number} as the client sees it`} sandbox="" srcDoc={q.data.html} style={{ width: "100%", minHeight: 640, border: 0, background: "#fff" }} />
      {q.data.source === "sent" ? <p className="fb-com-muted">This is the document that was sent.</p> : null}
    </section>
  );
}
