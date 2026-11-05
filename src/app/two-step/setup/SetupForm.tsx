"use client";

import { useEffect, useState } from "react";
import { callUncontracted } from "@/ui/data/client";
import { describeError } from "@/ui/errors";

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

  return (
    <div className="auth-shell">
      <div className="auth-card" data-screen-label="Two-step enrolment" style={{ maxWidth: 480 }}>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#e8f0fa", color: "#1f5fa8", display: "inline-block", marginBottom: 12 }}>
          Two-step sign-in
        </span>
        {loadError ? (
          <>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>We couldn’t start the set-up</h1>
            <p role="alert">{loadError}</p>
            <p>
              <a href="/login">Back to sign-in</a>
            </p>
          </>
        ) : !enrolment ? (
          <p role="status">Preparing your key…</p>
        ) : step === "scan" ? (
          <>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Set up an authenticator</h1>
            <p style={{ marginTop: 0 }}>Add this key to an authenticator app (or open the link on your phone). Then enter the 6-digit code the app shows.</p>
            <p style={{ fontFamily: "monospace", fontSize: 14, wordBreak: "break-all" }}>Key: {enrolment.secret}</p>
            <p>
              <a href={enrolment.otpauthUri}>Open in an authenticator app</a>
            </p>
            <form onSubmit={confirm} noValidate>
              <label htmlFor="setup-code" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                Code from your app
              </label>
              <input id="setup-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={error ? true : undefined} />
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 12 }}>
                Turn on two-step sign-in
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Keep your backup codes</h1>
            <p style={{ marginTop: 0 }}>Each code works once if you lose your phone. They are shown only now. Store them somewhere safe.</p>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: "monospace", fontSize: 15 }}>
              {(done?.backupCodes ?? []).map((c) => (
                <li key={c} style={{ padding: "8px 12px", border: "1px solid #bbb", borderRadius: 8, textAlign: "center" }}>
                  {c}
                </li>
              ))}
            </ul>
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0", fontSize: 14 }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 16, height: 16 }} />I saved these codes
            </label>
            <button type="button" disabled={!saved} onClick={() => window.location.assign(landing)} style={{ width: "100%" }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
