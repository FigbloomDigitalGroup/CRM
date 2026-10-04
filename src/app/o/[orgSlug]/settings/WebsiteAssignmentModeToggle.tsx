"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "ROUND_ROBIN" | "UNASSIGNED";

/** Org-level, Management-only (FIG-599 AC: "assignment rules configurable in settings"). */
export function WebsiteAssignmentModeToggle({
  orgSlug,
  mode,
}: {
  orgSlug: string;
  mode: Mode;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: Mode) {
    if (next === mode) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/integrations/website-key/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="radio"
          name="assignment-mode"
          checked={mode === "ROUND_ROBIN"}
          disabled={submitting}
          onChange={() => handleChange("ROUND_ROBIN")}
        />
        Auto-assign in rotation across active sales reps
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="radio"
          name="assignment-mode"
          checked={mode === "UNASSIGNED"}
          disabled={submitting}
          onChange={() => handleChange("UNASSIGNED")}
        />
        Leave unassigned for manual triage
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
