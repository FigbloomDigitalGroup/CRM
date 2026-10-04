"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Shared by Company and Contact detail pages (FIG-601) -- merges *this*
 * record (the "loser") into another one of the same type (the "winner,"
 * picked from `options`). A two-click confirm since it's not reversible
 * (the loser's history moves for good, even though the loser row itself
 * is only archived, not deleted).
 */
export function MergeControl({
  orgSlug,
  basePath,
  bodyKey,
  options,
  canMerge,
}: {
  orgSlug: string;
  basePath: string;
  bodyKey: "intoCompanyId" | "intoContactId";
  options: { id: string; label: string }[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState(options[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canMerge || options.length === 0) return null;

  async function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/${basePath}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [bodyKey]: targetId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to merge.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <strong>Merge duplicate</strong>
      <p className="who">
        Moves this record&apos;s activities, tasks, communications, leads, and deals onto the
        record you pick below, then archives this one. The archived record stays visible but
        no longer receives new activity.
      </p>
      <select
        value={targetId}
        onChange={(e) => {
          setTargetId(e.target.value);
          setConfirming(false);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>{" "}
      <button type="button" disabled={submitting || !targetId} onClick={handleClick}>
        {submitting ? "Merging..." : confirming ? "Confirm merge (cannot be undone)" : "Merge into selected"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
