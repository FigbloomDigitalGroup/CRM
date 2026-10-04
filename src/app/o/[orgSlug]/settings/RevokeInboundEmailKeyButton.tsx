"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeInboundEmailKeyButton({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (
      !window.confirm(
        "Revoking disables the inbound-email webhook immediately -- any configured provider will get a 401 on every delivery until a new token is generated. Continue?",
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/integrations/inbound-email-key/revoke`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to revoke.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={submitting}>
        Revoke token
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
