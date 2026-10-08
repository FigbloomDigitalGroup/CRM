"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEV_FIXTURE_PASSWORD } from "@/auth/devAccounts";
import { PasswordInput } from "../_shared/PasswordInput";

interface DevAccount {
  email: string;
  name: string;
  roleName: string;
}

export function LoginForm({ devAccounts = [] }: { devAccounts?: DevAccount[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function performLogin(loginEmail: string, loginPassword: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Login failed.");
      }
      // organizationSlug is null for an account with no active membership
      // anywhere -- the session cookie is already set at this point, but
      // there's nowhere to land, so say so instead of redirecting into an
      // organization this account has no access to (this used to be
      // hardcoded to the dev-seeded "figbloom" org regardless).
      if (!body.organizationSlug) {
        setError("Your account is not an active member of any organization yet.");
        setSubmitting(false);
        return;
      }
      router.push(`/o/${body.organizationSlug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleQuickLogin(account: DevAccount) {
    setEmail(account.email);
    setPassword(DEV_FIXTURE_PASSWORD);
    void performLogin(account.email, DEV_FIXTURE_PASSWORD);
  }

  return (
    <div className="lg-form">
      <div className="lg-in lg-d1">
        <span className="lg-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          </svg>
          Secure workspace sign-in
        </span>
      </div>

      <div className="lg-in lg-d2">
        <h2>Welcome back</h2>
        <div className="lg-sub">
          Sign in to pick up your leads, deals and tasks right where you left off.
        </div>
      </div>

      <form
        className="lg-formtag"
        onSubmit={(e) => {
          e.preventDefault();
          void performLogin(email, password);
        }}
      >
        <div className="lg-in lg-d3">
          <div className="lg-label-row">
            <label htmlFor="login-email">Email address</label>
          </div>
          <div className="lg-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 6L2 7" />
            </svg>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              autoFocus
              required
            />
          </div>
        </div>

        <div className="lg-in lg-d4">
          <div className="lg-label-row">
            <label htmlFor="login-password">Password</label>
            <a href="/forgot-password">Forgot password?</a>
          </div>
          <PasswordInput
            id="login-password"
            variant="pill"
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p className="lg-error" role="alert">
            {error}
          </p>
        )}

        <div className="lg-in lg-d5">
          <button type="submit" className="lg-btn" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>

      <div className="lg-in lg-d6">
        <div className="lg-or">or</div>
        <div className="lg-new">
          New to Figbloom CRM? <a href="/signup">Create an account</a>
        </div>
      </div>

      {devAccounts.length > 0 && (
        <div className="lg-in lg-d7">
          <div className="lg-dev">
            <div className="lg-dev-h">Dev accounts &middot; local only</div>
            <div className="lg-dev-ch">
              {devAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="lg-dev-chip"
                  disabled={submitting}
                  onClick={() => handleQuickLogin(account)}
                  title={`${account.email} (${account.roleName})`}
                >
                  {account.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
