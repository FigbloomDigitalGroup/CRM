"use client";

import { useState } from "react";

/**
 * A5, the two-step code screen (FIG-1167): a new page that comes after the frozen sign-in, only when two-step sign-in is on for the
 * organisation. It is not part of the frozen pages and does not touch them. Demo until B6.02: any 6 digits other than 000000 pass, any
 * XXXX-XXXX backup code passes, and five wrong tries lock the step for 30 minutes (as the design shows).
 */
const MAX_ATTEMPTS = 5;

export function TwoStepForm({ next = "/" }: { next?: string }) {
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [remember, setRemember] = useState(true);
  const [attempts, setAttempts] = useState(MAX_ATTEMPTS);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const locked = attempts <= 0;

  function verify(e: React.FormEvent) {
    e.preventDefault();
    const c = code.replace(/\s/g, "");
    const ok = useBackup ? /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(c) : /^\d{6}$/.test(c) && c !== "000000";
    if (!c) {
      setError(useBackup ? "Enter one of your backup codes." : "Enter the 6 digits from your app.");
      return;
    }
    if (!ok) {
      const left = attempts - 1;
      setAttempts(left);
      setError(left > 0 ? `That code didn’t work. ${left} attempt${left === 1 ? "" : "s"} left.` : "");
      return;
    }
    setError("");
    setDone(true);
    window.setTimeout(() => window.location.assign(next), 600);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card" data-screen-label="A5 Two-step sign-in" style={{ maxWidth: 440 }}>
        <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#e8f0fa", color: "#1f5fa8", display: "inline-block", marginBottom: 12 }}>
          Two-step sign-in · V1.1 · Demo data
        </span>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>{locked ? "Too many wrong codes" : useBackup ? "Enter a backup code" : "Enter your 6-digit code"}</h1>
        <p style={{ marginTop: 0 }}>
          {locked
            ? "Too many wrong codes. Sign-in is locked for 30 minutes and Management was told. Ask Management to reset two-step sign-in if you lost your phone."
            : useBackup
              ? "Each backup code works once. Lost them all? Ask Management to reset two-step sign-in."
              : "Open your authenticator app and type the code for Figbloom CRM. This step appears after the sign-in page, only when two-step sign-in is on for your organisation."}
        </p>
        {locked ? null : (
          <form onSubmit={verify} noValidate>
            <label htmlFor="two-step-code" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              {useBackup ? "Backup code" : "Authenticator code"}
            </label>
            <input
              id="two-step-code"
              name="code"
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
              <p id="two-step-error" className="error" role="alert">
                {error}
              </p>
            ) : null}
            {useBackup ? null : (
              <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0", fontSize: 14 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 16, height: 16 }} />
                Remember this device for 30 days
              </label>
            )}
            <button type="submit" disabled={done} style={{ width: "100%", marginTop: 8 }}>
              {done ? "Signed in…" : "Verify and continue"}
            </button>
          </form>
        )}
        {done ? (
          <p role="status" style={{ marginBottom: 0 }}>
            Signed in. {remember && !useBackup ? "This device is now trusted for 30 days." : ""}
          </p>
        ) : null}
        {locked ? null : (
          <p style={{ marginBottom: 0 }}>
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
        <p style={{ fontSize: 13, marginBottom: 0 }}>
          <a href="/login">Use a different account</a>
        </p>
      </div>
    </div>
  );
}
