"use client";

import { useRef, useState } from "react";
import { useApi } from "../../../data/hooks";
import { useMember } from "../../../data/member";
import { describeError } from "../../../errors";
import { Icon } from "../../leads/icons";
import { cardToCapture, extractCard, scanSummary, type ExtractedCard } from "./cardExtract";

export interface Scanned {
  fields: ReturnType<typeof cardToCapture>;
  summary: string;
  unsure: ExtractedCard["unsure"];
  /** The server's capture: Save confirms it (and attaches the photo). Absent only in tests. */
  captureId?: string;
}

/**
 * "Scan business card" in Quick capture (M4, FIG-1177): opens the camera, the server reads the card and the capture form is filled. Nothing is saved
 * here: the person checks every field, the ones the reader was unsure of are flagged, and the lead is created only when they press Save in the sheet.
 * Reading needs a connection (the photo is uploaded); offline it says so and nothing is kept.
 */
export function ScanCard({ onScanned }: { onScanned: (scanned: Scanned) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const api = useApi();
  const { orgSlug } = useMember();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="fb-sr-only"
        aria-label="Photograph a business card"
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!file) return;
          setProblem(null);
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            setProblem("Reading a card needs a connection. Type the details in, or scan it when you are back online.");
            return;
          }
          setBusy(true);
          try {
            const card = await extractCard(api, orgSlug, file);
            onScanned({ fields: cardToCapture(card), summary: scanSummary(card), unsure: card.unsure, captureId: card.captureId });
          } catch (err) {
            const d = describeError(err);
            setProblem(d.kind === "validation" || d.kind === "conflict" ? d.body : d.kind === "noAccess" ? "Your role cannot scan business cards. Type the details in instead." : "The card could not be read just now. Type the details in, or try again.");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button type="button" className="fb-m-scan" aria-disabled={busy || undefined} onClick={() => !busy && input.current?.click()}>
        <Icon name="scan" size={17} />
        {busy ? "Reading the card…" : "Scan business card"}
      </button>
      {problem ? (
        <p className="fb-m-muted" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

/** The line above the form after a scan, and what to check. */
export function ScannedBanner({ scanned }: { scanned: Scanned }) {
  return (
    <div className="fb-m-scanned" role="status" data-testid="scan-banner">
      <Icon name="check" size={15} />
      <span>{scanned.summary}</span>
    </div>
  );
}
