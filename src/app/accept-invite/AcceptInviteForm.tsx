"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "../_shared/PasswordInput";

const DEFAULT_ORG_SLUG = "figbloom";

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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not accept invite.");
      }
      router.push(`/o/${DEFAULT_ORG_SLUG}`);
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
