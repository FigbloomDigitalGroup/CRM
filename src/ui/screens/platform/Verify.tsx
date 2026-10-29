"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Shield } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PlDialog } from "./kit";
import { VERIFY_ATTEMPTS, verifyCode } from "./logic";

/** The state of one "Verify it's you" attempt series: five tries, then a 30-minute lock (PL14). */
export function useVerifyAttempts(onVerified: () => void) {
  const [attempts, setAttempts] = useState(VERIFY_ATTEMPTS);
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const locked = attempts <= 0;
  function submit() {
    if (locked) return;
    if (verifyCode(code, backup)) {
      setError("");
      onVerified();
      return;
    }
    const left = attempts - 1;
    setAttempts(left);
    setError(left > 0 ? `That code didn’t work. ${left} attempt${left === 1 ? "" : "s"} left.` : "");
  }
  function toggleBackup() {
    setBackup((b) => !b);
    setError("");
    setCode("");
  }
  return { attempts, backup, code, setCode, error, locked, submit, toggleBackup };
}

const BODY = {
  locked: "Too many wrong codes. Platform sign-in is locked for 30 minutes and the other platform admins were alerted.",
  open: "Enter the 6-digit code from your authenticator app, or one of your backup codes. Platform admins always verify; this device won’t be remembered.",
};

/**
 * PL14 Verify it's you, as the page after a platform password (a new route; the frozen sign-in pages are untouched). The dev chips skip this step and
 * show the "Dev only" strip instead. Demo rule: any 6 digits work except 000000, and a backup code looks like XXXX-XXXX.
 */
export function VerifyPage({ next }: { next: string }) {
  const [verified, setVerified] = useState(false);
  const v = useVerifyAttempts(() => setVerified(true));
  return (
    <div className="fb-pl-auth">
      <div className="fb-pl-auth-card" data-screen-label="PL14 Verify it’s you">
        <div className="fb-pl-auth-pill">
          <Shield size={14} aria-hidden="true" />
          Platform · Verify it’s you · V1.1
        </div>
        <div className="fb-pl-auth-prop">PROPOSED ADDITION · NOT PART OF THE FROZEN SET</div>
        <h1>Verify it’s you</h1>
        <p className="fb-pl-auth-body">{v.locked ? BODY.locked : BODY.open}</p>
        {verified ? (
          <div className="fb-pl-auth-note" role="status">
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>Verified. In the demo there is no real platform sign-in to continue to; open the console with the dev Super Admin chip.</span>
          </div>
        ) : null}
        {!v.locked && !verified ? <VerifyFields v={v} /> : null}
        {!v.locked && !verified ? (
          <div className="fb-pl-auth-note" style={{ marginTop: 14 }}>
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>{v.backup ? "Each backup code works once. Lost them all? Another platform admin can start a recovery." : "Lost your phone? Use a backup code instead."}</span>
          </div>
        ) : null}
        {v.error ? (
          <div role="alert" className="fb-pl-auth-err">
            <AlertTriangle size={15} aria-hidden="true" />
            {v.error}
          </div>
        ) : null}
        {v.locked ? (
          <div role="alert" className="fb-pl-auth-err">
            <AlertTriangle size={15} aria-hidden="true" />
            Locked for 30 minutes.
          </div>
        ) : null}
        {!v.locked && !verified ? (
          <button type="button" className="fb-pl-auth-cta" onClick={v.submit}>
            Verify <ArrowRight size={17} aria-hidden="true" />
          </button>
        ) : null}
        <p className="fb-pl-auth-foot">
          Not a platform admin? <Link href={next} style={{ fontWeight: 700, color: "#1a1c19", textDecoration: "underline" }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}

function VerifyFields({ v }: { v: ReturnType<typeof useVerifyAttempts> }) {
  return (
    <>
      <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, paddingLeft: 4 }}>{v.backup ? "Backup code" : "Authenticator code"}</span>
        <span className="fb-pl-auth-wrap">
          <KeyRound size={18} aria-hidden="true" />
          <input
            className="fb-pl-auth-input"
            value={v.code}
            onChange={(e) => v.setCode(e.target.value)}
            placeholder={v.backup ? "XXXX-XXXX" : "123 456"}
            inputMode={v.backup ? "text" : "numeric"}
            autoComplete="one-time-code"
            onKeyDown={(e) => e.key === "Enter" && v.submit()}
          />
        </span>
      </label>
      <button type="button" className="fb-pl-auth-alt" onClick={v.toggleBackup}>{v.backup ? "Use my authenticator code" : "Use a backup code"}</button>
    </>
  );
}

/**
 * The same step as a dialog, for a sensitive action once signed in (removing an admin, approving a deletion from a phone). It confirms who is
 * acting before the action runs; nothing runs on a wrong code.
 */
export function VerifyDialog({ open, onClose, onVerified, action }: { open: boolean; onClose: () => void; onVerified: () => void; action: string }) {
  return open ? <VerifyDialogBody onClose={onClose} onVerified={onVerified} action={action} /> : null;
}

function VerifyDialogBody({ onClose, onVerified, action }: { onClose: () => void; onVerified: () => void; action: string }) {
  const v = useVerifyAttempts(() => {
    onVerified();
    onClose();
  });
  return (
    <PlDialog open onClose={onClose} title="Verify it’s you" label="PL14 Verify it’s you">
      <p className="fb-pl-muted2" style={{ margin: 0, fontSize: 13.5 }}>
        {v.locked ? BODY.locked : `${action} needs a fresh check. Enter the 6-digit code from your authenticator app, or a backup code.`}
      </p>
      {!v.locked ? (
        <>
          <label className="fb-pl-field">
            <span className="fb-pl-label">{v.backup ? "Backup code" : "Authenticator code"}</span>
            <input
              className="fb-pl-input"
              value={v.code}
              onChange={(e) => v.setCode(e.target.value)}
              placeholder={v.backup ? "XXXX-XXXX" : "123 456"}
              inputMode={v.backup ? "text" : "numeric"}
              autoComplete="one-time-code"
              onKeyDown={(e) => e.key === "Enter" && v.submit()}
            />
          </label>
          <button type="button" className="fb-pl-link-btn" style={{ alignSelf: "flex-start" }} onClick={v.toggleBackup}>
            {v.backup ? "Use my authenticator code" : "Use a backup code"}
          </button>
        </>
      ) : null}
      {v.error ? <div role="alert" className="fb-pl-alert"><AlertTriangle size={16} aria-hidden="true" />{v.error}</div> : null}
      <div className="fb-pl-dialog-actions">
        <button type="button" className="fb-pl-btn" onClick={onClose}>Cancel</button>
        {!v.locked ? <button type="button" className="fb-pl-btn fb-pl-btn--primary" onClick={v.submit}>Verify</button> : null}
      </div>
    </PlDialog>
  );
}
