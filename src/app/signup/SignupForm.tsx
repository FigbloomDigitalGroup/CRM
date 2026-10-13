"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "../_shared/PasswordInput";

const DEFAULT_ORG_SLUG = "figbloom";

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not create account.");
      }
      router.push(`/o/${DEFAULT_ORG_SLUG}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lg-form">
      <div className="lg-in lg-d1">
        <span className="lg-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          </svg>
          Secure workspace sign-up
        </span>
      </div>

      <div className="lg-in lg-d2">
        <h2>Create your account</h2>
        <div className="lg-sub">
          Creating an account doesn&apos;t grant access to an organization on its
          own &mdash; an admin still needs to add you to one before you can see
          any CRM data.
        </div>
      </div>

      <form className="lg-formtag" onSubmit={handleSubmit}>
        <div className="lg-in lg-d3">
          <div className="lg-label-row">
            <label htmlFor="signup-name">Full name</label>
          </div>
          <div className="lg-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Jane Doe"
              autoFocus
              required
            />
          </div>
        </div>

        <div className="lg-in lg-d4">
          <div className="lg-label-row">
            <label htmlFor="signup-email">Email address</label>
          </div>
          <div className="lg-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 6L2 7" />
            </svg>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              required
            />
          </div>
        </div>

        <div className="lg-in lg-d5">
          <div className="lg-label-row">
            <label htmlFor="signup-password">Password</label>
          </div>
          <PasswordInput
            id="signup-password"
            variant="pill"
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </div>

        {error && (
          <p className="lg-error" role="alert">
            {error}
          </p>
        )}

        <div className="lg-in lg-d6">
          <button type="submit" className="lg-btn" disabled={submitting}>
            {submitting ? "Creating account..." : "Sign up"}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>

      <div className="lg-in lg-d7">
        <div className="lg-or">or</div>
        <div className="lg-new">
          Already have an account? <a href="/login">Log in</a>
        </div>
      </div>
    </div>
  );
}
