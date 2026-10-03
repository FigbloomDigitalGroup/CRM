"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Org-level, Management-only (FIG-597 AC: "configurable per organization"). Off by default -- see notificationService.ts's doc comment on why. */
export function WebsiteAcknowledgementToggle({
  orgSlug,
  enabled,
}: {
  orgSlug: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/integrations/website-key/acknowledgement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !enabled }),
        },
      );
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
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={handleToggle} disabled={submitting} />
        Email the enquirer an acknowledgement when they submit the form
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
