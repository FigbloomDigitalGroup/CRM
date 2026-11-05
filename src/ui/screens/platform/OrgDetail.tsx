"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowLeft, Ban, ChevronDown, Code, Download, Eye, RefreshCw, Send, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchOrgDetail } from "./api";
import { dateShort, failureText, PlDialog, StatusPill, whenLabel } from "./kit";
import { dialogValid, ORG_DIALOGS } from "./logic";
import { PlatformNotFound } from "./Misc";
import { usePlatform } from "./store";

type DialogKind = keyof typeof ORG_DIALOGS;

/** PL4 Organisation detail: operational counts only (no business data), with the actions that change an organisation's state. */
export function OrgDetail({ id }: { id: string }) {
  const { now, call, can } = usePlatform();
  const q = useQuery({ queryKey: ["platform", "org", id], queryFn: () => fetchOrgDetail(call, id) });
  const org = q.data;
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

  if (q.isLoading) return <div className="fb-pl-tiles" role="status" aria-label="Loading organisation"><div className="fb-pl-skel" /><div className="fb-pl-skel" /></div>;
  if (q.error && (q.error as { status?: number }).status === 404) return <PlatformNotFound />;
  if (q.error) {
    const f = failureText(q.error, "Organisation");
    return (
      <div role="alert" className="fb-pl-errbox">
        <div style={{ fontWeight: 700 }}>{f.title}</div>
        <div className="fb-pl-sub">{f.body}</div>
        {f.retry ? <button type="button" className="fb-pl-btn fb-pl-btn--primary" style={{ marginTop: 12, height: 38 }} onClick={() => void q.refetch()}>Retry</button> : null}
      </div>
    );
  }
  if (!org) return <PlatformNotFound />;
  const final = org.status === "Offboarded";
  const canSuspend = can("platform.organizations.suspend");
  const banner =
    org.status === "Suspended"
      ? { text: "Suspended: members can’t sign in. Data is kept. Website enquiries are rejected with a polite message.", bg: "var(--pl-red-soft)", fg: "var(--pl-red)" }
      : org.status === "Offboarding"
        ? { text: "Offboarding: sign-in is suspended. Data is deleted only after an approved deletion request and the retention period.", bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" }
        : org.status === "Offboarded"
          ? { text: "Offboarded: the organisation’s data was deleted. Only this record and its certificate remain.", bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" }
          : null;
  const audit = org.recentAudit.slice(0, 5);

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
    { label: "Resend admin invite", icon: Send, disabled: true, reason: "Not available yet: the platform API has no resend route" },
    org.status === "Active"
      ? { label: "Suspend", icon: Ban, run: () => setDialog("suspend"), danger: true, disabled: !canSuspend, reason: "Your platform role can’t suspend organisations" }
      : { label: "Reactivate", icon: RefreshCw, run: () => setDialog("reactivate"), disabled: final || !canSuspend, reason: final ? "An offboarded organisation can’t be reactivated" : "Your platform role can’t change an organisation’s status" },
    { label: "Request support access", icon: Eye, href: `/platform/support-access?org=${id}`, disabled: false },
    { label: "Data requests", icon: Download, href: "/platform/data-requests" },
    { label: "Start offboarding", icon: Archive, run: () => setDialog("offboard"), danger: true, disabled: final || org.status === "Offboarding" || !canSuspend, reason: final ? "Already offboarded" : org.status === "Offboarding" ? "Offboarding has already started" : "Your platform role can’t change an organisation’s status" },
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
            {([["Status", org.status], ["Created", dateShort(org.created)], ["Owner contact", org.owner ? `${org.owner}${org.invitePending ? " (invite pending)" : ""}` : "—"], ["Time zone", org.tz ?? "—"], ["Currency", org.cur ?? "—"]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="fb-pl-card" aria-label="Counts">
          <h2 style={{ marginBottom: 4 }}>Counts</h2>
          <div className="fb-pl-muted fb-pl-small" style={{ marginBottom: 10 }}>Numbers only. No names, values or business data.</div>
          {[["Members (active of all)", `${org.activeMembers} of ${org.members}`], ["Companies", org.companies], ["Contacts", org.contacts], ["Leads", org.leads], ["Deals", org.deals]].map(([k, v]) => (
            <div key={k} className="fb-pl-row">
              <span className="fb-pl-grow fb-pl-muted2">{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </section>
        <section className="fb-pl-card" aria-label="Status history">
          <h2 style={{ marginBottom: 12 }}>Status history</h2>
          {org.lifecycle.length ? org.lifecycle.slice(0, 6).map((l) => (
            <div key={l.id} className="fb-pl-row" style={{ alignItems: "flex-start" }}>
              <span className="fb-pl-grow">
                <strong>{l.action}</strong>{l.from && l.to ? <span className="fb-pl-muted2"> · {l.from} → {l.to}</span> : null}
                {l.reason ? <span className="fb-pl-muted fb-pl-small" style={{ display: "block" }}>{l.reason}</span> : null}
              </span>
              <span className="fb-pl-muted fb-pl-small">{dateShort(l.at)}</span>
            </div>
          )) : <div className="fb-pl-muted2" style={{ fontSize: 13.5 }}>No status changes yet.</div>}
        </section>
        <section className="fb-pl-card" aria-label="Data requests">
          <h2 style={{ marginBottom: 12 }}>Data requests</h2>
          {org.requestIds.length ? org.requestIds.map((r) => (
            <div key={r.id} className="fb-pl-row">
              <Link href={`/platform/data-requests?id=${r.id}`} className="fb-pl-grow fb-pl-org-link">{r.kind === "DELETE" ? "Organisation deletion" : "Data export"}</Link>
              <span className="fb-pl-muted2 fb-pl-small">{r.status.toLowerCase()}</span>
            </div>
          )) : <div className="fb-pl-muted2" style={{ fontSize: 13.5 }}>No data requests from this organisation.</div>}
        </section>
      </div>

      <section className="fb-pl-card fb-pl-card--flush" aria-label="Recent platform actions">
        <div className="fb-pl-card-h">
          <h2>Recent platform actions on this organisation</h2>
          <Link href="/platform/audit" className="fb-pl-link-btn">Full audit log</Link>
        </div>
        {audit.length ? (
          audit.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--pl-border)", fontSize: 13.5 }}>
              <span className="fb-pl-muted fb-pl-small" style={{ width: 110 }}>{whenLabel(a.at, now)}</span>
              <span style={{ flex: 1 }}><strong>{a.action}</strong> · {a.target}</span>
              <span className="fb-pl-muted2">{a.by}</span>
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
  const { actions } = usePlatform();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  if (!kind) return null;
  const d = ORG_DIALOGS[kind];
  const valid = dialogValid(reason, typed, orgName);
  return (
    <PlDialog open onClose={onClose} title={d.title(orgName)} label={`PL5 ${d.cta}`}>
      <ul className="fb-pl-effects">
        {d.effects.map((e) => <li key={e}>{e}</li>)}
      </ul>
      <label className="fb-pl-field">
        <span className="fb-pl-label">Reason (5 to 500 characters) <span style={{ color: "var(--pl-red)" }}>*</span></span>
        <textarea className="fb-pl-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
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
          aria-disabled={!valid || busy || undefined}
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            const res = await actions.setOrgStatus(orgId, kind, reason);
            setBusy(false);
            if (res.ok) onClose();
          }}
        >
          {d.cta}
        </button>
      </div>
    </PlDialog>
  );
}
