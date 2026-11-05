"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { fetchSecurity } from "./api";
import { dateShort, PageHead, SliceGate, StatusPill } from "./kit";
import { adminEmailOk, canRemoveAdmin, initials, MIN_ADMINS, nameFromEmail } from "./logic";
import { usePlatform } from "./store";

/**
 * PL10 Platform admins (GET /api/platform/admins): at least two active, always (the API refuses to go below). Inviting, removing and recovering ask
 * "Verify it's you" (PL14) whenever the last verification is older than the platform's verification window.
 */
export function PlatformAdmins() {
  const { state, actions, toast, slices, can } = usePlatform();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const manage = can("platform.admins.manage");
  const active = state.admins.filter((a) => a.status === "ACTIVE").length;
  const atMinimum = active <= MIN_ADMINS;

  async function askRemove(id: string) {
    const c = canRemoveAdmin(state.admins, state.me, id);
    if (!c.ok) return toast(c.reason);
    await actions.removeAdmin(id);
  }

  return (
    <>
      <PageHead title="Platform admins" sub="At least two admins are always required, so one can approve the other and recover a lost device.">
        {manage ? (
          <form
            className="fb-pl-row"
            style={{ border: 0, padding: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!adminEmailOk(email)) return toast("Enter a valid email address.");
              const res = await actions.inviteAdmin(email, name.trim() || nameFromEmail(email));
              if (res.ok) {
                setEmail("");
                setName("");
              }
            }}
          >
            <input className="fb-pl-input" style={{ width: 180 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New admin’s name" />
            <input className="fb-pl-input" style={{ width: 260 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@platform.figbloom.co.ke" aria-label="New admin’s email" />
            <button type="submit" className="fb-pl-btn fb-pl-btn--primary">Invite admin</button>
          </form>
        ) : null}
      </PageHead>
      <SliceGate slice={slices.admins} area="Platform admins">
        <section className="fb-pl-card fb-pl-card--flush" aria-label="Platform admins">
          {state.admins.map((a) => (
            <div key={a.id} className="fb-pl-admin">
              <span className="fb-pl-admin-av" aria-hidden="true">{initials(a.name)}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700 }}>
                  {a.name}
                  {a.isYou ? <span className="fb-pl-muted" style={{ fontWeight: 500 }}> (you)</span> : null}
                  {a.status !== "ACTIVE" ? <span style={{ marginLeft: 8 }}><StatusPill status={a.status === "SUSPENDED" ? "Suspended" : a.status} /></span> : null}
                  {a.locked ? <span style={{ marginLeft: 8 }}><StatusPill status="Down" label="Locked" /></span> : null}
                </div>
                <div className="fb-pl-muted fb-pl-small">{a.email}</div>
              </div>
              <span className="fb-pl-pill" style={{ background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)", fontWeight: 600 }}>2FA {a.tfa}</span>
              <span className="fb-pl-muted2 fb-pl-small" style={{ width: 140 }}>Last sign-in {a.last}</span>
              {manage ? (
                <>
                  <button type="button" className="fb-pl-btn fb-pl-btn--sm" aria-disabled={a.isYou || undefined} disabled={a.isYou} title={a.isYou ? "Ask another admin to recover you" : undefined} onClick={() => void actions.resetTwoStep(a.id)}>Lost device</button>
                  <button type="button" className="fb-pl-btn fb-pl-btn--sm fb-pl-btn--outline-danger" aria-disabled={atMinimum || a.isYou || undefined} onClick={() => void askRemove(a.id)}>Remove</button>
                </>
              ) : null}
            </div>
          ))}
          {!state.admins.length ? <div className="fb-pl-muted2" style={{ padding: 24, textAlign: "center" }}>No platform admins yet.</div> : null}
        </section>
        {state.invitations.length ? (
          <section className="fb-pl-card fb-pl-card--flush" aria-label="Open invitations">
            <div className="fb-pl-card-h"><h2>Open invitations</h2></div>
            {state.invitations.map((i) => (
              <div key={i.id} className="fb-pl-row" style={{ padding: "10px 18px" }}>
                <span className="fb-pl-grow">{i.email}</span>
                <span className="fb-pl-muted fb-pl-small">expires {dateShort(i.expiresAt)}</span>
                {manage ? <button type="button" className="fb-pl-btn fb-pl-btn--sm" onClick={() => void actions.revokeInvite(i.id)}>Withdraw</button> : null}
              </div>
            ))}
          </section>
        ) : null}
        {atMinimum && state.admins.length ? (
          <div role="alert" className="fb-pl-warn">
            <AlertTriangle size={16} aria-hidden="true" />
            Only two active admins left. Removing either is blocked until another admin accepts an invite.
          </div>
        ) : null}
      </SliceGate>
    </>
  );
}

const FIELDS = ["idleHours", "absoluteHours", "reverifyMinutes", "maxFailedAttempts", "lockoutMinutes"] as const;
const HELP: Record<string, string> = {
  idleHours: "Signed out after this long without activity.",
  absoluteHours: "A session never lasts longer than this. Idle can’t exceed it.",
  reverifyMinutes: "Sensitive changes need a code newer than this.",
  maxFailedAttempts: "Wrong passwords or codes before the account locks.",
  lockoutMinutes: "How long a locked account stays locked.",
};

/** PL11 Platform security: verification is locked on; the rest are the real settings (GET/PATCH /api/platform/security/settings), each change audited. */
export function PlatformSecurity() {
  const { actions, call, can } = usePlatform();
  const q = useQuery({ queryKey: ["platform", "security"], queryFn: () => fetchSecurity(call) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const manage = can("platform.security.manage");
  const settings = q.data?.settings ?? {};
  const value = (k: string) => draft[k] ?? String(settings[k] ?? "");
  const changed = Object.fromEntries(FIELDS.filter((k) => draft[k] !== undefined && Number(draft[k]) !== settings[k]).map((k) => [k, Number(draft[k])]));
  const dirty = Object.keys(changed).length > 0;

  return (
    <>
      <PageHead title="Platform security" />
      <SliceGate slice={{ loading: q.isLoading, error: q.error, refetch: () => void q.refetch() }} area="Platform security">
        <section className="fb-pl-card" style={{ maxWidth: 780, display: "flex", flexDirection: "column", gap: 4 }} aria-label="Platform security">
          <div className="fb-pl-sec-row">
            <input type="checkbox" checked disabled aria-label="Verification required at every sign-in" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Verification required at every sign-in <span className="fb-pl-muted" style={{ fontSize: 11.5 }}> · locked on</span></div>
              <div className="fb-pl-muted2 fb-pl-small">Authenticator code or backup code. Trusted devices are not offered for platform admins.</div>
            </div>
          </div>
          {FIELDS.map((k) => {
            const lim = q.data?.limits[k];
            return (
              <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", fontSize: 14 }}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{lim?.label ?? k}</span>
                  <span className="fb-pl-muted2 fb-pl-small">{HELP[k]}{lim ? ` (${lim.min} to ${lim.max})` : ""}</span>
                </span>
                <input className="fb-pl-input" style={{ width: 90, height: 36 }} type="number" min={lim?.min} max={lim?.max} disabled={!manage} aria-label={lim?.label ?? k} value={value(k)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </label>
            );
          })}
          <div className="fb-pl-muted2 fb-pl-small">An IP allowlist and sign-in alerts are not part of the platform API yet.</div>
          {manage ? (
            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
              <button
                type="button"
                className="fb-pl-btn fb-pl-btn--primary"
                disabled={!dirty}
                onClick={async () => {
                  const res = await actions.updateSecurity(changed);
                  if (res.ok) {
                    setDraft({});
                    void q.refetch();
                  }
                }}
              >
                Save changes
              </button>
            </div>
          ) : null}
        </section>
      </SliceGate>
    </>
  );
}
