"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { PageHead } from "./kit";
import { canRemoveAdmin, initials, MIN_ADMINS } from "./logic";
import { usePlatform } from "./store";
import { VerifyDialog } from "./Verify";

type Pending = { kind: "remove"; id: string } | { kind: "invite" } | null;

/** PL10 Platform admins: at least two, always. Removing or inviting an admin asks "Verify it's you" first (PL14). */
export function PlatformAdmins() {
  const { state, dispatch, toast } = usePlatform();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const atMinimum = state.admins.length <= MIN_ADMINS;

  function askRemove(id: string) {
    const c = canRemoveAdmin(state.admins, state.me, id);
    if (!c.ok) return toast(c.reason);
    setPending({ kind: "remove", id });
  }
  const verified = () => {
    if (pending?.kind === "remove") dispatch({ type: "admin-remove", id: pending.id });
    if (pending?.kind === "invite") {
      const res = dispatch({ type: "admin-invite", email });
      if (res.ok) setEmail("");
    }
    setPending(null);
  };

  return (
    <>
      <PageHead title="Platform admins" sub="At least two admins are always required, so one can approve the other and recover a lost device.">
        <form className="fb-pl-row" style={{ border: 0, padding: 0 }} onSubmit={(e) => { e.preventDefault(); setPending({ kind: "invite" }); }}>
          <input className="fb-pl-input" style={{ width: 280 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@platform.figbloom.co.ke" aria-label="New admin’s email" />
          <button type="submit" className="fb-pl-btn fb-pl-btn--primary">Invite admin</button>
        </form>
      </PageHead>
      
      <section className="fb-pl-card fb-pl-card--flush" aria-label="Platform admins">
        {state.admins.map((a) => (
          <div key={a.id} className="fb-pl-admin">
            <span className="fb-pl-admin-av" aria-hidden="true">{initials(a.name)}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>
                {a.name}
                {a.id === state.me ? <span className="fb-pl-muted" style={{ fontWeight: 500 }}> (you)</span> : null}
              </div>
              <div className="fb-pl-muted fb-pl-small">{a.email} · added by {a.by}</div>
            </div>
            <span className="fb-pl-pill" style={{ background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)", fontWeight: 600 }}>2FA {a.tfa}</span>
            <span className="fb-pl-muted2 fb-pl-small" style={{ width: 140 }}>Last sign-in {a.last}</span>
            <button type="button" className="fb-pl-btn fb-pl-btn--sm" onClick={() => dispatch({ type: "admin-recover", id: a.id })}>Lost device</button>
            <button type="button" className="fb-pl-btn fb-pl-btn--sm fb-pl-btn--outline-danger" aria-disabled={atMinimum || undefined} onClick={() => askRemove(a.id)}>Remove</button>
          </div>
        ))}
      </section>
      {atMinimum ? (
        <div role="alert" className="fb-pl-warn">
          <AlertTriangle size={16} aria-hidden="true" />
          Only two admins left. Removing either is blocked until another admin accepts an invite.
        </div>
      ) : null}
      <VerifyDialog open={pending !== null} onClose={() => setPending(null)} onVerified={verified} action={pending?.kind === "invite" ? "Inviting a platform admin" : "Removing a platform admin"} />
    </>
  );
}

const SECURITY_ROWS = [
  { key: "verify", label: "Verification required at every sign-in", d: "Authenticator code or backup code. Trusted devices are not offered for platform admins.", locked: true },
  { key: "ip", label: "IP allowlist", d: "Only allow platform sign-in from these addresses." },
  { key: "newdev", label: "Alert on sign-in from a new device", d: "All platform admins get an email." },
  { key: "failed", label: "Alert after 3 failed sign-ins", d: "The account locks for 30 minutes." },
] as const;

/** PL11 Platform security: verification is locked on; the rest are switches that are written to the platform audit log. */
export function PlatformSecurity() {
  const { state, dispatch } = usePlatform();
  const sec = state.security;
  return (
    <>
      <PageHead title="Platform security" />
      
      <section className="fb-pl-card" style={{ maxWidth: 780, display: "flex", flexDirection: "column", gap: 4 }} aria-label="Platform security">
        {SECURITY_ROWS.map((r) => {
          const on = r.key === "verify" ? true : sec[r.key];
          const locked = "locked" in r && r.locked;
          return (
            <div key={r.key} className="fb-pl-sec-row">
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                aria-label={r.label}
                onChange={() => r.key !== "verify" && dispatch({ type: "security", key: r.key, label: r.label })}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.label}
                  {locked ? <span className="fb-pl-muted" style={{ fontSize: 11.5 }}> · locked on</span> : null}
                </div>
                <div className="fb-pl-muted2 fb-pl-small">{r.d}</div>
                {r.key === "ip" && sec.ip ? <input className="fb-pl-input fb-pl-mono" style={{ marginTop: 8, height: 36, background: "var(--pl-surface-2)", fontSize: 12 }} readOnly value="41.90.64.0/24, 105.163.2.8" aria-label="Allowed addresses" /> : null}
              </div>
            </div>
          );
        })}
        <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 0", fontSize: 14, fontWeight: 600 }}>
          Session length
          <select className="fb-pl-select" style={{ width: "auto", height: 34, fontWeight: 500 }} value={sec.sessLen} onChange={(e) => dispatch({ type: "session-length", value: e.target.value })}>
            <option value="30">30 minutes idle</option>
            <option value="60">1 hour idle</option>
            <option value="240">4 hours max</option>
          </select>
        </label>
      </section>
    </>
  );
}
