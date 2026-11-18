"use client";

import { ModalShell } from "../leads/overlay";

/** The archive confirmation (companies and contacts): archived records leave the lists and turn read-only; nothing is deleted. */
export function ArchiveDialog({ title, noun = "company", onCancel, onConfirm, busy }: { title: string; noun?: string; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <ModalShell
      title={title}
      intro="It leaves the lists and becomes read-only. Nothing is deleted, and you can restore it from the Archived tab."
      onClose={onCancel}
      label={`Archive ${noun}`}
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--solid-danger" disabled={busy} onClick={onConfirm}>
            Archive
          </button>
        </>
      }
    >
      {null}
    </ModalShell>
  );
}
