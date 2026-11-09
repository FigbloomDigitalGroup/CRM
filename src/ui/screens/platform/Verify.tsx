"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { PlDialog } from "./kit";
import { VERIFY_ATTEMPTS, verifyCode, verifyShapeOk } from "./logic";
import { usePlatform } from "./store";

/** The state of one "Verify it's you" attempt series: five tries, then a 30-minute lock (PL14). */
export function useVerifyAttempts(onVerified: () => void, check?: (code: string) => Promise<string | null>) {
  const [attempts, setAttempts] = useState(VERIFY_ATTEMPTS);
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);
  const locked = attempts <= 0;
  async function submit() {
    if (locked || busy) return;
    let ok: boolean;
    if (check) {
      // The real check: the API decides. A badly formed code is not sent.
      if (!verifyShapeOk(code, backup)) ok = false;
      else {
        setBusy(true);
        ok = (await check(code.replace(/\s/g, ""))) === null;
        setBusy(false);
      }
    } else ok = verifyCode(code, backup);
    if (ok) {
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
  return { attempts, backup, code, setCode, error, locked, busy, submit: () => void submit(), toggleBackup };
}

const BODY = {
  locked: "Too many wrong codes. Platform sign-in is locked for 30 minutes and the other platform admins were alerted.",
  open: "Enter the 6-digit code from your authenticator app, or one of your backup codes. Platform admins always verify; this device won’t be remembered.",
};

/**
 * The same step as a dialog, for a sensitive action once signed in (removing an admin, approving a deletion from a phone). It confirms who is
 * acting before the action runs; nothing runs on a wrong code.
 */
export function VerifyDialog({ open, onClose, onVerified, action, check }: { open: boolean; onClose: () => void; onVerified: () => void; action: string; check?: (code: string) => Promise<string | null> }) {
  return open ? <VerifyDialogBody onClose={onClose} onVerified={onVerified} action={action} check={check} /> : null;
}

/**
 * Shows the "Verify it's you" dialog when the API asks for a fresh check before a sensitive change (the store raises it, see `actions` in store.tsx).
 * A right code renews the verification on the session and the change is tried again; Cancel leaves the change undone.
 */
export function ReverifyHost() {
  const { verification, actions } = usePlatform();
  return (
    <VerifyDialog
      open={verification !== null}
      action={verification?.action ?? "This change"}
      check={actions.reverify}
      onVerified={() => actions.finishVerification(true)}
      onClose={() => actions.finishVerification(false)}
    />
  );
}

function VerifyDialogBody({ onClose, onVerified, action, check }: { onClose: () => void; onVerified: () => void; action: string; check?: (code: string) => Promise<string | null> }) {
  const v = useVerifyAttempts(() => {
    onVerified();
    onClose();
  }, check);
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
