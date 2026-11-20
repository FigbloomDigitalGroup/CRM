"use client";

import { useState } from "react";
import { AuthLinks, AuthNotice, PasswordRules } from "@/app/_shared/AuthLayout";
import { PasswordInput } from "@/app/_shared/PasswordInput";
import { callUncontracted } from "@/ui/data/client";
import { describeError } from "@/ui/errors";

type Call = typeof callUncontracted;

interface Accepted {
  organizationSlug: string;
  twoStepRequired?: boolean;
  twoStepUrl?: string;
}

const MIN_PASSWORD = 10;

/**
 * UC-F2: chooses a fresh password and completes the accept (`POST /api/auth/accept-invite`, the same endpoint the frozen page uses). The link in
 * the invite email is what proves the mailbox; whatever password the account had before is replaced and its sessions end. Where the organisation
 * needs a second step, the API answers with the same hand-off as sign-in and this page follows it.
 */
export function VerifyInviteForm({
  token,
  call = callUncontracted,
  onDone = (to: string) => window.location.assign(to),
}: {
  token: string;
  call?: Call;
  onDone?: (to: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const done = await call<Accepted>("POST", "/api/auth/accept-invite", { token, password });
      onDone(done.twoStepRequired ? (done.twoStepUrl ?? "/two-step") : `/o/${done.organizationSlug}`);
    } catch (err) {
      setError(describeError(err).body);
      setBusy(false);
    }
  }

  return (
    <>
      <form className="stack auth-form" onSubmit={submit} noValidate>
        <label>
          Choose a new password
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            describedBy={error ? "verify-rules verify-error" : "verify-rules"}
            invalid={Boolean(error)}
          />
        </label>
        <PasswordRules id="verify-rules" value={password} />
        <label>
          Repeat the password
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={MIN_PASSWORD} required invalid={Boolean(error)} />
        </label>
        {error && (
          <AuthNotice kind="error" id="verify-error">
            {error}
          </AuthNotice>
        )}
        <button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Joining..." : "Confirm and join"}
        </button>
      </form>
      {error && (
        <AuthLinks>
          <a href="/login">Back to sign in</a>
        </AuthLinks>
      )}
    </>
  );
}
