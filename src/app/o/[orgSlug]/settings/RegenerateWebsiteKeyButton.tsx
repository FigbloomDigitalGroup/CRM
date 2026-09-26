"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegenerateWebsiteKeyButton({
  orgSlug,
  alreadyConfigured,
}: {
  orgSlug: string;
  alreadyConfigured: boolean;
}) {
  const router = useRouter();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (
      alreadyConfigured &&
      !window.confirm(
        "Regenerating replaces the current key immediately -- the website's existing key will stop working until it's updated. Continue?",
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/integrations/website-key`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate a key.");
      setNewKey(body.apiKey);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={submitting}>
        {alreadyConfigured ? "Regenerate key" : "Generate key"}
      </button>
      {error && <p className="error">{error}</p>}
      {newKey && (
        <div className="warning" style={{ marginTop: 12 }}>
          <strong>Copy this key now -- it will not be shown again:</strong>
          <p>
            <code style={{ wordBreak: "break-all" }}>{newKey}</code>
          </p>
        </div>
      )}
    </div>
  );
}
