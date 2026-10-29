"use client";

import { Eye } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import { PageHead, whenLabel } from "./kit";
import { countdown, supportMsLeft, supportTone, SUPPORT_SCOPES } from "./logic";
import { usePlatform } from "./store";

/**
 * PL7 Support access (V2, FIG-1192 platform half): break-glass, read-only views inside an organisation. A request needs a reason, a time limit and
 * the organisation's own approval; every page viewed is logged and the session ends on its own. The organisation side (approval card, banner,
 * history) is built by the tenant-side agent and reads the same records once wired.
 */
export function SupportAccess() {
  const { state, now, dispatch, toast } = usePlatform();
  const params = useSearchParams();
  const [form, setForm] = useState({ org: params?.get("org") ?? state.orgs[0]!.id, reason: "", ticket: "", mins: "60", scope: SUPPORT_SCOPES[0]!, mask: true });
  const orgName = (id: string) => state.orgs.find((o) => o.id === id)?.name ?? "—";
  const adminName = (id: string) => state.admins.find((a) => a.id === id)?.name ?? "admin";
  const active = state.support.find((s) => s.id === state.activeSupport);
  const left = supportMsLeft(active, now);
  const isV2 = state.release === "v2";
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <PageHead title="Support access" release="V2" sub="Break-glass, read-only views inside an organisation. Needs a reason, a time limit and the organisation’s approval. Every page viewed is logged." />
      <DemoNotice what="Support access" />
      {!isV2 ? <div className="fb-pl-muted2" style={{ padding: "14px 16px", borderRadius: 12, background: "var(--pl-surface-2)", fontSize: 13.5 }}>Turn on V2 in the Demo release switch to use support access.</div> : null}
      {isV2 ? (
        <>
          {active ? (
            <div role="status" className="fb-pl-support-live">
              <Eye size={17} aria-hidden="true" />
              <span style={{ flex: 1 }}>Support view, read-only · {orgName(active.org)} · ends in {countdown(left)}</span>
              <button type="button" className="fb-pl-btn" onClick={() => toast("Opens the organisation’s settings read-only with customer values masked. Every page is logged.")}>Open support view</button>
              <button type="button" className="fb-pl-btn fb-pl-btn--ghost" onClick={() => dispatch({ type: "support-end", id: active.id })}>End</button>
            </div>
          ) : null}
          <div className="fb-pl-grid">
            <section className="fb-pl-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} aria-label="Request access">
              <h2 style={{ fontSize: 16 }}>Request access</h2>
              <label className="fb-pl-field">
                <span className="fb-pl-label">Organisation</span>
                <select className="fb-pl-select" value={form.org} onChange={(e) => set("org", e.target.value)}>
                  {state.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="fb-pl-field">
                <span className="fb-pl-label">Reason</span>
                <textarea className="fb-pl-textarea" rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="What are you checking and why?" />
              </label>
              <div className="fb-pl-two">
                <label className="fb-pl-field">
                  <span className="fb-pl-label">Ticket</span>
                  <input className="fb-pl-input" value={form.ticket} onChange={(e) => set("ticket", e.target.value)} placeholder="FIG-000" />
                </label>
                <label className="fb-pl-field">
                  <span className="fb-pl-label">Duration</span>
                  <select className="fb-pl-select" value={form.mins} onChange={(e) => set("mins", e.target.value)}>
                    <option value="30">30 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="120">120 minutes</option>
                  </select>
                </label>
              </div>
              <label className="fb-pl-field">
                <span className="fb-pl-label">Scope</span>
                <select className="fb-pl-select" value={form.scope} onChange={(e) => set("scope", e.target.value)}>
                  {SUPPORT_SCOPES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="fb-pl-check">
                <input type="checkbox" checked={form.mask} onChange={() => set("mask", !form.mask)} />
                Mask customer values (on by default)
              </label>
              <button
                type="button"
                className="fb-pl-btn fb-pl-btn--primary"
                style={{ height: 42 }}
                onClick={() => {
                  const res = dispatch({ type: "support-request", org: form.org, reason: form.reason, ticket: form.ticket, mins: Number(form.mins), scope: form.scope, mask: form.mask });
                  if (res.ok) setForm((f) => ({ ...f, reason: "", ticket: "" }));
                  else toast(res.message);
                }}
              >
                Send request to the organisation
              </button>
            </section>

            <section className="fb-pl-card fb-pl-card--flush" aria-label="Sessions">
              <div style={{ padding: "16px 18px 8px" }}><h2 style={{ fontSize: 16 }}>Sessions</h2></div>
              {state.support.map((s) => {
                const t = supportTone(s);
                return (
                  <div key={s.id} style={{ padding: "12px 18px", borderTop: "1px solid var(--pl-border)", fontSize: 13.5 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong style={{ flex: 1 }}>{orgName(s.org)}</strong>
                      <span className="fb-pl-pill" style={{ background: t.bg, color: t.fg, fontSize: 11.5, padding: "2px 9px" }}>{s.status}</span>
                    </div>
                    <div className="fb-pl-muted2" style={{ marginTop: 3 }}>{s.reason}</div>
                    <div className="fb-pl-muted fb-pl-small" style={{ marginTop: 3 }}>
                      {s.ticket} · {s.scope} · {s.mins} min · by {adminName(s.by)}
                      {s.pages ? ` · ${s.pages.length} pages viewed` : ""} · {whenLabel(s.at, now)}
                    </div>
                    {s.status === "Pending organisation approval" ? (
                      <button type="button" className="fb-pl-pending-demo" onClick={() => dispatch({ type: "support-approve", id: s.id })}>
                        Demo: approve as the organisation
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
