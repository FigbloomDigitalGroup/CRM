"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegenerateInboundEmailKeyButton({
  orgSlug,
  alreadyConfigured,
}: {
  orgSlug: string;
  alreadyConfigured: boolean;
}) {
  const router = useRouter();
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (
      alreadyConfigured &&
      !window.confirm(
        "Regenerating replaces the current token immediately -- any inbound-email provider webhook configured with the old one will stop working until it's updated. Continue?",
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/integrations/inbound-email-key`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to generate a token.");
      setNewToken(body.token);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a token.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={submitting}>
        {alreadyConfigured ? "Regenerate token" : "Generate token"}
      </button>
      {error && <p className="error">{error}</p>}
      {newToken && (
        <div className="warning" style={{ marginTop: 12 }}>
          <strong>Copy this token now -- it will not be shown again:</strong>
          <p>
            <code style={{ wordBreak: "break-all" }}>{newToken}</code>
          </p>
        </div>
      )}
    </div>
  );
}
