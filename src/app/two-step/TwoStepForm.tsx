"use client";

import { useEffect, useState } from "react";
import { callUncontracted } from "@/ui/data/client";
import { describeError } from "@/ui/errors";
import { AuthLayout, AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";

/**
 * A5, the two-step code screen (FIG-1167, wired to FIG-1134): a new page that comes after the frozen sign-in, only when two-step sign-in is needed.
 * It is not part of the frozen pages and does not touch them. The password step left a ten-minute pending cookie; this page asks the API which
 * second step it needs (`GET /api/auth/two-step/challenge`), sends the code (`POST /api/auth/two-step/verify`) and opens the organisation. Five wrong
 * codes end the challenge, so the person signs in again (or uses a backup code, or asks Management for a reset).
 */
interface Landing {
  organizationSlug: string;
  awaitingAccess?: boolean;
}

export function landingFor(done: Landing): string {
  return done.awaitingAccess || done.organizationSlug === "account" ? "/" : `/o/${done.organizationSlug}`;
}

export function TwoStepForm() {
  const [phase, setPhase] = useState<"loading" | "ready" | "expired" | "failed">("loading");
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [remember, setRemember] = useState(true);
  const [attempts, setAttempts] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    callUncontracted<{ purpose: "VERIFY" | "ENROL"; attemptsLeft: number }>("GET", "/api/auth/two-step/challenge")
      .then((c) => {
        if (!alive) return;
        if (c.purpose === "ENROL") {
          window.location.assign("/two-step/setup");
          return;
        }
        setAttempts(c.attemptsLeft);
        setPhase("ready");
      })
      .catch((e) => {
        if (alive) setPhase((e as { status?: number }).status === 401 ? "expired" : "failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  const locked = attempts !== null && attempts <= 0;

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) {
      setError(useBackup ? "Enter one of your backup codes." : "Enter the 6 digits from your app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await callUncontracted<Landing>("POST", "/api/auth/two-step/verify", { code: c, rememberDevice: useBackup ? undefined : remember });
      setDone(true);
      window.setTimeout(() => window.location.assign(landingFor(result)), 400);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        const left = Math.max(0, (attempts ?? 5) - 1);
        setAttempts(left);
        setError(left > 0 ? `That code didn’t work. ${left} attempt${left === 1 ? "" : "s"} left.` : "");
      } else if (status === 429) {
        setError("Too many tries. Wait a moment and try again.");
      } else {
        setError(describeError(err).body);
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading" || phase === "expired" || phase === "failed") {
    return (
      <AuthLayout
        screenLabel="A5 Two-step sign-in"
        wide
        title={phase === "loading" ? "One moment" : phase === "expired" ? "Sign in again" : "Something went wrong"}
        lead={
          phase === "loading"
            ? "Checking your sign-in…"
            : phase === "expired"
              ? "This sign-in step has expired or was already used. Sign in with your password again to get a new one."
              : "We couldn’t check your sign-in. Check your connection and reload the page."
        }
      >
        {phase === "loading" ? <span className="auth-spinner" role="status" aria-label="Checking your sign-in" /> : (
          <AuthLinks>
            <a href="/login">Back to sign-in</a>
          </AuthLinks>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      screenLabel="A5 Two-step sign-in"
      wide
      pill="Two-step sign-in"
      title={locked ? "Too many wrong codes" : useBackup ? "Enter a backup code" : "Enter your 6-digit code"}
      lead={
        locked
          ? "Too many wrong codes. This sign-in has ended and Management was told. Sign in again, or ask Management to reset two-step sign-in if you lost your phone."
          : useBackup
            ? "Each backup code works once. Lost them all? Ask Management to reset two-step sign-in."
            : "Open your authenticator app and type the code for Figbloom CRM. This step appears after the sign-in page, only when two-step sign-in is on for you."
      }
    >
      {locked ? null : (
        <form className="auth-form" onSubmit={verify} noValidate>
          <label htmlFor="two-step-code" className="auth-label">
            {useBackup ? "Backup code" : "Authenticator code"}
          </label>
          <input
            id="two-step-code"
            name="code"
            className="auth-code-input"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            placeholder={useBackup ? "XXXX-XXXX" : "123 456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "two-step-error" : undefined}
          />
          {error ? (
            <AuthNotice kind="error" id="two-step-error">
              {error}
            </AuthNotice>
          ) : null}
          {useBackup ? null : (
            <label className="auth-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember this device for 30 days
            </label>
          )}
          <button type="submit" disabled={busy || done} aria-busy={busy || undefined} className="auth-wide">
            {done ? "Signed in…" : "Verify and continue"}
          </button>
        </form>
      )}
      {done ? (
        <AuthNotice kind="success">
          Signed in. {remember && !useBackup ? "This device is now trusted for 30 days." : ""}
        </AuthNotice>
      ) : null}
      {locked ? null : (
        <p className="auth-links">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setUseBackup((v) => !v);
              setCode("");
              setError("");
            }}
          >
            {useBackup ? "Use my authenticator code" : "Use a backup code"}
          </button>
        </p>
      )}
      <AuthLinks>
        <a href="/login">Use a different account</a>
      </AuthLinks>
    </AuthLayout>
  );
}
