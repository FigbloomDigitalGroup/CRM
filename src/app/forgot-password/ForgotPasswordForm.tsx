"use client";

import { useState } from "react";
import { AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(
        body.message ??
          "If that email has an account, a password reset link has been sent.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (message) {
    return (
      <>
        <AuthNotice kind="success" title="Check your email">
          {message} It can take a minute to arrive. If you do not see it, look in your spam folder.
        </AuthNotice>
        <AuthLinks>
          <a href="/login">Back to sign in</a>
        </AuthLinks>
      </>
    );
  }

  return (
    <>
      <form className="stack auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
      <AuthLinks>
        <a href="/login">Back to sign in</a>
      </AuthLinks>
    </>
  );
}
