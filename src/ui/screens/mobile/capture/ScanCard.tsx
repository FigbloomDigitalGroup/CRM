"use client";

import { useRef, useState } from "react";
import { Icon } from "../../leads/icons";
import { cardToCapture, extractCard, scanSummary, type ExtractedCard } from "./cardExtract";

export interface Scanned {
  fields: ReturnType<typeof cardToCapture>;
  summary: string;
  unsure: ExtractedCard["unsure"];
}

/**
 * "Scan business card" in Quick capture (M4, FIG-1177): opens the camera, reads the card and fills the capture form. Nothing is saved here: the
 * person checks every field, the ones the reader was unsure of are flagged, and the lead is created only when they press Save in the sheet.
 * The reading is a demo sample until B6.22.
 */
export function ScanCard({ onScanned }: { onScanned: (scanned: Scanned) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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
          setBusy(true);
          try {
            const card = await extractCard(file);
            onScanned({ fields: cardToCapture(card), summary: scanSummary(card), unsure: card.unsure });
          } finally {
            setBusy(false);
          }
        }}
      />
      <button type="button" className="fb-m-scan" aria-disabled={busy || undefined} onClick={() => !busy && input.current?.click()}>
        <Icon name="scan" size={17} />
        {busy ? "Reading the card…" : "Scan business card"}
      </button>
    </>
  );
}

/** The line above the form after a scan, and what to check. */
export function ScannedBanner({ scanned }: { scanned: Scanned }) {
  return (
    <div className="fb-m-scanned" role="status" data-testid="scan-banner">
      <Icon name="check" size={15} />
      <span>
        {scanned.summary} <span className="fb-m-scanned__demo">Demo reading: sample card, not your photo.</span>
      </span>
    </div>
  );
}
