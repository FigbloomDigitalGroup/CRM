"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "../_shared/PasswordInput";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not reset password.");
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <p className="warning">Password updated. Redirecting to log in...</p>;
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        New password
        <PasswordInput
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          minLength={10}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}
