"use client";

import { AlertTriangle, Archive, ArrowLeft, Ban, ChevronDown, Code, Download, Eye, RefreshCw, Send, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import { dateShort, PlDialog, StatusPill, whenLabel } from "./kit";
import { dialogValid, ORG_DIALOGS } from "./logic";
import { PlatformNotFound } from "./Misc";
import { usePlatform } from "./store";

type DialogKind = keyof typeof ORG_DIALOGS;

/** PL4 Organisation detail: operational counts only (no business data), with the actions that change an organisation's state. */
export function OrgDetail({ id }: { id: string }) {
  const { state, now, dispatch, toast: say } = usePlatform();
  const org = state.orgs.find((o) => o.id === id);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!org) return <PlatformNotFound />;
  const banner =
    org.status === "Suspended"
      ? { text: "Suspended: members can’t sign in. Data is kept. Website enquiries are rejected with a polite message.", bg: "var(--pl-red-soft)", fg: "var(--pl-red)" }
      : org.status === "Offboarding"
        ? { text: "Offboarding: export sent, deletion scheduled after the retention period.", bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" }
        : null;
  const audit = state.audit.filter((a) => a.org === org.name).slice(0, 5);
  const adminName = (by: string) => state.admins.find((a) => a.id === by)?.name ?? by;

  interface ActionDef {
    label: string;
    icon: LucideIcon;
    run?: () => void;
    done?: string;
    href?: string;
    danger?: boolean;
    disabled?: boolean;
    reason?: string;
  }
  const actions: ActionDef[] = [
    { label: "Resend admin invite", icon: Send, run: () => dispatch({ type: "org-note", id, action: "Admin invite resent" }), done: "Invite resent to the organisation’s admin" },
    org.status === "Suspended" ? { label: "Reactivate", icon: RefreshCw, run: () => setDialog("reactivate") } : { label: "Suspend", icon: Ban, run: () => setDialog("suspend"), danger: true },
    { label: "Request support access", icon: Eye, href: `/platform/support-access?org=${id}`, disabled: state.release !== "v2", reason: "Support access arrives in V2" },
    { label: "Export data", icon: Download, run: () => dispatch({ type: "org-note", id, action: "Organisation export created", target: "Full export", detail: "Link expires in 7 days" }), done: "Export is being prepared. The link expires in 7 days." },
    { label: "Start offboarding", icon: Archive, run: () => setDialog("offboard"), danger: true, disabled: org.status === "Offboarding", reason: "Offboarding has already started" },
  ];

  return (
    <>
      <Link href="/platform/organisations" className="fb-pl-back">
        <ArrowLeft size={15} aria-hidden="true" />
        Organisations
      </Link>
      {banner ? (
        <div role="status" className="fb-pl-banner" style={{ background: banner.bg, color: banner.fg }}>
          <AlertTriangle size={16} aria-hidden="true" />
          {banner.text}
        </div>
      ) : null}
      <DemoNotice what="This organisation" />
      <div className="fb-pl-head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="fb-pl-title-row">
            <h1 className="fb-pl-h1">{org.name}</h1>
            <StatusPill status={org.status} />
          </div>
          <div className="fb-pl-sub fb-pl-mono">{org.slug} · created {dateShort(org.created)}</div>
        </div>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button type="button" className="fb-pl-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Actions
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {open ? (
            <div role="menu" style={{ position: "absolute", right: 0, top: 46, width: 250, zIndex: 20, background: "var(--pl-surface)", border: "1px solid var(--pl-border)", borderRadius: 12, boxShadow: "var(--pl-shadow-md)", padding: 6 }}>
              {actions.map((a) => {
                const Icon = a.icon;
                const style = { color: a.danger ? "var(--pl-red)" : undefined, opacity: a.disabled ? 0.45 : 1 };
                const inner = (
                  <>
                    <Icon size={15} aria-hidden="true" />
                    {a.label}
                    {a.disabled && a.reason ? <span className="fb-pl-sr"> ({a.reason})</span> : null}
                  </>
                );
                if (a.href && !a.disabled) return <Link key={a.label} role="menuitem" href={a.href} className="fb-pl-menu-item" style={style}>{inner}</Link>;
                return (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    className="fb-pl-menu-item"
                    style={style}
                    aria-disabled={a.disabled || undefined}
                    title={a.disabled ? a.reason : undefined}
                    onClick={() => {
                      if (a.disabled) return;
                      setOpen(false);
                      a.run?.();
                      if (a.done) say(a.done);
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="fb-pl-grid">
        <section className="fb-pl-card" aria-label="Overview">
          <h2 style={{ marginBottom: 12 }}>Overview</h2>
          <dl className="fb-pl-dl">
            {([["Status", org.status], ["Created", dateShort(org.created)], ["Owner contact", org.owner], ["Time zone", org.tz], ["Currency", org.cur]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="fb-pl-card" aria-label="Members">
          <h2 style={{ marginBottom: 4 }}>Members</h2>
          <div className="fb-pl-muted fb-pl-small" style={{ marginBottom: 10 }}>Names, emails and roles only. No business data.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {org.roles.map(([l, n]) => (
              <span key={l} className="fb-pl-pill fb-pl-pill--soft">{l} · {n}</span>
            ))}
          </div>
          {org.people.map(([n, e, r]) => (
            <div key={e + r} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: "1px solid var(--pl-border)", fontSize: 13 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{n}</span>
              <span className="fb-pl-muted2">{e}</span>
              <span className="fb-pl-muted" style={{ width: 120, textAlign: "right" }}>{r}</span>
            </div>
          ))}
        </section>
        <section className="fb-pl-card" aria-label="Integrations health">
          <h2 style={{ marginBottom: 12 }}>Integrations health</h2>
          {[
            { k: "Website key last used", v: org.web.last, dot: org.web.bad ? "var(--pl-orange)" : "var(--pl-primary)" },
            { k: "Accepted · 24 h", v: org.web.ok, dot: "var(--pl-primary)" },
            { k: "Rejected · 24 h", v: org.web.bad, dot: org.web.bad ? "var(--pl-orange)" : "var(--pl-primary)" },
            { k: "Inbound email last received", v: org.mail, dot: org.mail === "Not connected" ? "var(--pl-surface-3)" : "var(--pl-primary)" },
          ].map((r) => (
            <div key={r.k} className="fb-pl-row">
              <span className="fb-pl-dot" style={{ background: r.dot }} />
              <span className="fb-pl-grow">{r.k}</span>
              <strong>{r.v}</strong>
            </div>
          ))}
        </section>
        <section className="fb-pl-card" aria-label="Usage and jobs">
          <h2 style={{ marginBottom: 12 }}>Usage and jobs</h2>
          {[["Page views · 30 days", org.usage.views], ["Active users · 7 days", org.usage.users], ["Data volume", org.usage.volume], ["Notification sweep", "Last run 15:00 · OK"]].map(([k, v]) => (
            <div key={k} className="fb-pl-row">
              <span className="fb-pl-grow fb-pl-muted2">{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </section>
      </div>

      <section className="fb-pl-card fb-pl-card--flush" aria-label="Recent platform actions">
        <div className="fb-pl-card-h">
          <h2>Recent platform actions on this organisation</h2>
          <Link href="/platform/audit" className="fb-pl-link-btn">Full audit log</Link>
        </div>
        {audit.length ? (
          audit.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--pl-border)", fontSize: 13.5 }}>
              <span className="fb-pl-muted fb-pl-small" style={{ width: 110 }}>{whenLabel(a.at, now)}</span>
              <span style={{ flex: 1 }}><strong>{a.action}</strong> · {a.target}</span>
              <span className="fb-pl-muted2">{adminName(a.by)}</span>
            </div>
          ))
        ) : (
          <div className="fb-pl-muted2" style={{ padding: "10px 18px 18px", fontSize: 13.5 }}>No platform actions on this organisation yet.</div>
        )}
      </section>
      <div className="fb-pl-muted fb-pl-small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Code size={13} aria-hidden="true" />
        For engineers: platform actions run under a separate service identity, not the tenant application role, so row-level security and organisation scoping stay intact.
      </div>

      <OrgActionDialog key={dialog ?? "none"} kind={dialog} orgId={org.id} orgName={org.name} onClose={() => setDialog(null)} />
    </>
  );
}

/** PL5: suspend, reactivate and offboard. Each lists what will happen, needs a reason, and needs the organisation's name typed back. */
export function OrgActionDialog({ kind, orgId, orgName, onClose }: { kind: DialogKind | null; orgId: string; orgName: string; onClose: () => void }) {
  const { dispatch } = usePlatform();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [notify, setNotify] = useState(true);
  if (!kind) return null;
  const d = ORG_DIALOGS[kind];
  const valid = dialogValid(reason, typed, orgName);
  return (
    <PlDialog open onClose={onClose} title={d.title(orgName)} label={`PL5 ${d.cta}`}>
      <ul className="fb-pl-effects">
        {d.effects.map((e) => <li key={e}>{e}</li>)}
      </ul>
      <label className="fb-pl-field">
        <span className="fb-pl-label">Reason <span style={{ color: "var(--pl-red)" }}>*</span></span>
        <textarea className="fb-pl-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="fb-pl-check">
        <input type="checkbox" checked={notify} onChange={() => setNotify((n) => !n)} />
        Email the organisation’s Management users
      </label>
      <label className="fb-pl-field">
        <span className="fb-pl-label">Type <code className="fb-pl-kbd">{orgName}</code> to confirm</span>
        <input className="fb-pl-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      <div className="fb-pl-dialog-actions">
        <button type="button" className="fb-pl-btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={d.danger ? "fb-pl-btn fb-pl-btn--danger" : "fb-pl-btn fb-pl-btn--primary"}
          aria-disabled={!valid || undefined}
          disabled={!valid}
          onClick={() => {
            const res = dispatch({ type: "org-status", id: orgId, kind, reason, notify });
            if (res.ok) onClose();
          }}
        >
          {d.cta}
        </button>
      </div>
    </PlDialog>
  );
}
