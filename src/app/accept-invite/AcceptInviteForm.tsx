"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "../_shared/PasswordInput";

export function AcceptInviteForm({
  token,
  requiresPassword,
}: {
  token: string;
  requiresPassword: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: requiresPassword ? password : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not accept invite.");
      }
      // The invited membership can belong to any organization, not just
      // the original dev-seeded "figbloom" -- this used to be hardcoded,
      // which meant accepting a real invite for a newly provisioned
      // organization (FIG-604) redirected into an org the new user had no
      // membership in at all.
      router.push(`/o/${body.organizationSlug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      {requiresPassword && (
        <label>
          Set a password
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Accepting..." : "Accept invite"}
      </button>
    </form>
  );
}
