"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Reused across Lead/Deal/Company/Contact detail pages (FIG-601) -- a
 * plain POST to `<basePath>/archive` or `.../restore`. Soft-delete only:
 * the record and everything linked to it stays intact, just hidden from
 * default lists.
 */
export function ArchiveControl({
  orgSlug,
  basePath,
  archivedAt,
  canArchive,
}: {
  orgSlug: string;
  basePath: string;
  archivedAt: string | null;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canArchive) return null;

  async function handle(action: "archive" | "restore") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/${basePath}/${action}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed to ${action}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      {archivedAt ? (
        <>
          <p className="error">Archived {new Date(archivedAt).toLocaleString()}.</p>
          <button type="button" disabled={submitting} onClick={() => handle("restore")}>
            {submitting ? "Restoring..." : "Restore"}
          </button>
        </>
      ) : (
        <button type="button" disabled={submitting} onClick={() => handle("archive")}>
          {submitting ? "Archiving..." : "Archive"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
