"use client";

import { useEffect, useState } from "react";
import { callUncontracted } from "@/ui/data/client";
import { describeError } from "@/ui/errors";
import { AuthLayout, AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";

/**
 * Two-step enrolment (FIG-1167, wired to FIG-1134): the key (and the otpauth link) for the authenticator app, one code to confirm, then the backup
 * codes, shown once. Two ways in: forced at sign-in by the organisation's policy (a pending ENROL challenge: `/api/auth/two-step/enrol/*`, which
 * also signs the person in) or chosen from Settings (a session: `/api/me/two-step/enrol/*`). The page asks the challenge route which one applies.
 */
interface Enrolment {
  secret: string;
  otpauthUri: string;
}
interface Done {
  backupCodes: string[];
  organizationSlug?: string;
  awaitingAccess?: boolean;
}

export function SetupForm() {
  const [mode, setMode] = useState<"signin" | "settings" | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<"scan" | "codes">("scan");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let m: "signin" | "settings" = "settings";
      try {
        const c = await callUncontracted<{ purpose: string }>("GET", "/api/auth/two-step/challenge");
        if (c.purpose === "ENROL") m = "signin";
      } catch {
        m = "settings";
      }
      try {
        const e = await callUncontracted<Enrolment>("POST", m === "signin" ? "/api/auth/two-step/enrol/start" : "/api/me/two-step/enrol/start");
        if (!alive) return;
        setMode(m);
        setEnrolment(e);
      } catch (err) {
        if (alive) setLoadError((err as { status?: number }).status === 401 ? "Your sign-in has expired. Sign in again to set up two-step sign-in." : describeError(err).body);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      setError("Enter the 6 digits from your app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await callUncontracted<Done>("POST", mode === "signin" ? "/api/auth/two-step/enrol/confirm" : "/api/me/two-step/enrol/confirm", {
        code: code.replace(/\s/g, ""),
      });
      setDone(result);
      setStep("codes");
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  const landing = done?.organizationSlug && !done.awaitingAccess && done.organizationSlug !== "account" ? `/o/${done.organizationSlug}` : "/";

  const title = loadError ? "We couldn’t start the set-up" : !enrolment ? "Getting ready" : step === "scan" ? "Set up an authenticator" : "Keep your backup codes";

  return (
    <AuthLayout screenLabel="Two-step enrolment" wide pill="Two-step sign-in" title={title}>
      {loadError ? (
        <>
          <AuthNotice kind="error">{loadError}</AuthNotice>
          <AuthLinks>
            <a href="/login">Back to sign-in</a>
          </AuthLinks>
        </>
      ) : !enrolment ? (
        <p className="auth-lead" role="status">
          <span className="auth-spinner" aria-hidden="true" /> Preparing your key…
        </p>
      ) : step === "scan" ? (
        <>
          <p className="auth-lead">Add this key to an authenticator app (or open the link on your phone). Then enter the 6-digit code the app shows.</p>
          <p className="auth-key">
            <span>Key</span> <code>{enrolment.secret}</code>
          </p>
          <p className="auth-links">
            <a href={enrolment.otpauthUri}>Open in an authenticator app</a>
          </p>
          <form className="auth-form" onSubmit={confirm} noValidate>
            <label htmlFor="setup-code" className="auth-label">
              Code from your app
            </label>
            <input
              id="setup-code"
              className="auth-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "setup-error" : undefined}
            />
            {error ? (
              <AuthNotice kind="error" id="setup-error">
                {error}
              </AuthNotice>
            ) : null}
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="auth-wide">
              Turn on two-step sign-in
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="auth-lead">Each code works once if you lose your phone. They are shown only now. Store them somewhere safe.</p>
          <ul className="auth-codes">
            {(done?.backupCodes ?? []).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <label className="auth-check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved these codes
          </label>
          <button type="button" className="auth-wide" disabled={!saved} onClick={() => window.location.assign(landing)}>
            Done
          </button>
        </>
      )}
    </AuthLayout>
  );
}
