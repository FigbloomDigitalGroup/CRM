"use client";

import { useState } from "react";

/**
 * Two-step enrolment (FIG-1167): scan the code (or type the key), confirm with one code from the app, then keep the eight backup codes.
 * Demo until B6.02: the QR square is a placeholder and the codes are samples, not secrets.
 */
const SAMPLE_CODES = ["7K3M-PQ9X", "A82D-LF4R", "XW5T-N6HB", "Q9ZC-2VJE", "M4RY-8UGA", "T7BD-K3SN", "H2LP-W5FQ", "E6XA-9CMV"];

export function SetupForm() {
  const [step, setStep] = useState<"scan" | "codes">("scan");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      setError("Enter the 6 digits from your app.");
      return;
    }
    setError("");
    setStep("codes");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card" data-screen-label="Two-step enrolment" style={{ maxWidth: 480 }}>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#e8f0fa", color: "#1f5fa8", display: "inline-block", marginBottom: 12 }}>
          Two-step sign-in · V1.1 · Demo data
        </span>
        {step === "scan" ? (
          <>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Set up an authenticator</h1>
            <p style={{ marginTop: 0 }}>Scan the square with an authenticator app, or type the key. Then enter the 6-digit code the app shows.</p>
            <div
              role="img"
              aria-label="Sample code square (demo)"
              style={{ width: 168, height: 168, borderRadius: 12, border: "1px solid #888", background: "repeating-conic-gradient(#111 0 25%, #fff 0 50%) 0 0 / 24px 24px", margin: "8px 0" }}
            />
            <p style={{ fontFamily: "monospace", fontSize: 14 }}>Key: DEMO KEY 7K3M PQ9X A82D</p>
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
              <button type="submit" style={{ width: "100%", marginTop: 12 }}>
                Turn on two-step sign-in
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Keep your backup codes</h1>
            <p style={{ marginTop: 0 }}>Each code works once if you lose your phone. They are shown only now. Store them somewhere safe.</p>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: "monospace", fontSize: 15 }}>
              {SAMPLE_CODES.map((c) => (
                <li key={c} style={{ padding: "8px 12px", border: "1px solid #bbb", borderRadius: 8, textAlign: "center" }}>
                  {c}
                </li>
              ))}
            </ul>
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0", fontSize: 14 }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 16, height: 16 }} />I saved these codes
            </label>
            <button type="button" disabled={!saved} onClick={() => window.location.assign("/")} style={{ width: "100%" }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
