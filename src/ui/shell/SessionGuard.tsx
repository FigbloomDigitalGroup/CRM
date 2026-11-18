"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../components/overlays";
import { copy } from "../copy";
import { useApi } from "../data/hooks";
import { SESSION_ENDING_EVENT } from "../drafts";

/**
 * The session-expiring prompt (F1.04, TB5). Five minutes before the session ends (the server says exactly when: `warnAt`) a dialog counts
 * down and offers "Stay signed in", which asks the server for one more policy period. If nobody answers, the session ends: forms are told first
 * (they save their drafts, see `drafts.ts`) and the person is returned to the sign-in page. A 401 from any call does the same.
 */

export interface SessionTimes {
  expiresAt: string;
  warnAt: string;
  canExtend: boolean;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SessionGuard({
  initial,
  signInHref = "/login",
  navigate = (href) => window.location.assign(href),
  now = () => Date.now(),
}: {
  initial: SessionTimes;
  signInHref?: string;
  /** Test seam. */
  navigate?: (href: string) => void;
  now?: () => number;
}) {
  const api = useApi();
  const [times, setTimes] = useState(initial);
  const [tick, setTick] = useState(() => now());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ended = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);

  const expiresMs = Date.parse(times.expiresAt);
  const warnMs = Date.parse(times.warnAt);
  const secondsLeft = Math.max(0, Math.ceil((expiresMs - tick) / 1000));
  const warning = tick >= warnMs && tick < expiresMs;
  const expired = tick >= expiresMs;

  const endSession = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    // Forms save what is on screen before the page goes.
    window.dispatchEvent(new CustomEvent(SESSION_ENDING_EVENT));
    navigate(`${signInHref}?reason=expired`);
  }, [navigate, signInHref]);

  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  // A 401 from any request means the session is already gone.
  useEffect(() => {
    const onSignedOut = () => endSession();
    window.addEventListener("figbloom:signed-out", onSignedOut);
    return () => window.removeEventListener("figbloom:signed-out", onSignedOut);
  }, [endSession]);

  async function stay() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await api.call("extendSession", { params: {} });
      const session = (result as { session?: { expiresAt?: string; warnAt?: string; canExtend?: boolean } }).session;
      if (session?.expiresAt && session.warnAt) setTimes({ expiresAt: session.expiresAt, warnAt: session.warnAt, canExtend: session.canExtend ?? true });
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={warning}
      onClose={() => undefined}
      dismissible={false}
      title="Still there?"
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary" onClick={endSession}>{copy.session.signOut}</button>
          {times.canExtend ? (
            <button type="button" data-autofocus className="fb-btn fb-btn--primary" aria-disabled={busy || undefined} onClick={stay}>
              {copy.session.stay}
            </button>
          ) : null}
        </>
      }
    >
      <p style={{ margin: 0 }} aria-live="polite">
        Your session ends in <strong>{formatCountdown(secondsLeft)}</strong>. {times.canExtend ? "Stay signed in to keep working." : "You have reached the longest a session can last. Anything you typed will be kept for when you sign in again."}
      </p>
      {failed ? <p role="alert" className="fb-error">We could not extend the session. Try again.</p> : null}
    </Dialog>
  );
}
