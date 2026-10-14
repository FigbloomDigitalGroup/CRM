"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconArchive, IconRestore } from "../_shared/icons";

/**
 * Compact icon-button variant of `ArchiveControl` for the board card --
 * that one renders a full labeled `.card` block meant for a detail page, too
 * bulky for a kanban card. Same archive/restore POST underneath.
 */
export function DealCardActions({
  orgSlug,
  dealId,
  archivedAt,
  canArchive,
}: {
  orgSlug: string;
  dealId: string;
  archivedAt: string | null;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  if (!canArchive) return null;

  async function handle(action: "archive" | "restore") {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/deals/${dealId}/${action}`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="deal-card-actions">
      {archivedAt ? (
        <button
          type="button"
          className="deal-card-action-btn"
          disabled={submitting}
          onClick={() => handle("restore")}
          aria-label="Restore deal"
          title="Restore"
        >
          <IconRestore />
        </button>
      ) : (
        <button
          type="button"
          className="deal-card-action-btn"
          disabled={submitting}
          onClick={() => handle("archive")}
          aria-label="Archive deal"
          title="Archive"
        >
          <IconArchive />
        </button>
      )}
    </div>
  );
}
