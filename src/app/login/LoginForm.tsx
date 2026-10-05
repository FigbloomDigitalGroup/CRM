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
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void performLogin(email, password);
        }}
      >
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
        <label>
          Password
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in..." : "Log in"}
        </button>
      </form>

      {devAccounts.length > 0 && (
        <div className="warning" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>
            Dev accounts (local only)
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {devAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                disabled={submitting}
                onClick={() => handleQuickLogin(account)}
                title={account.email}
              >
                {account.name} -- {account.roleName}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
