"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconArchive, IconRestore } from "../_shared/icons";

/**
 * Compact archive/restore icon on a board card. Which button (if any)
 * shows comes from `dealCapabilities`; the API enforces the same rules.
 * Failures are surfaced on the button's tooltip and a small inline note
 * instead of failing silently.
 */
export function DealCardActions({
  orgSlug,
  dealId,
  canArchive,
  canRestore,
}: {
  orgSlug: string;
  dealId: string;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canArchive && !canRestore) return null;

  async function handle(action: "archive" | "restore") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/deals/${dealId}/${action}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not ${action} this deal.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this deal.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="deal-card-actions">
      {canRestore ? (
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
      {error && (
        <span className="row-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
