"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeWebsiteKeyButton({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (
      !window.confirm(
        "Revoking disables the integration immediately -- the website will get a 401 on every submission until a new key is generated. Continue?",
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/integrations/website-key/revoke`,
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
        Revoke key
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
