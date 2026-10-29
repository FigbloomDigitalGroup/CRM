"use client";

import { Info, X } from "lucide-react";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import { dateShort, PageHead } from "./kit";
import { usePlatform } from "./store";

/** PL12 Flags and limits (V2): per-organisation switches and limits. No prices and no billing. Every change is written to the history and the audit log. */
export function FlagsAndLimits() {
  const { state, dispatch } = usePlatform();
  return (
    <>
      <PageHead title="Flags and limits" release="V2" sub="Per organisation switches. No prices and no billing." />
      <DemoNotice what="Flags and limits" />
      <section className="fb-pl-card fb-pl-card--flush">
        <div className="fb-pl-scroll">
          <table className="fb-pl-table fb-pl-table--flags">
            <thead>
              <tr>{["ORGANISATION", "ASSISTANT", "INTEGRATIONS", "IMPORT SIZE LIMIT", "SEAT LIMIT"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {state.orgs.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.name}</td>
                  <td><input type="checkbox" style={{ accentColor: "#7650b0" }} checked={o.flags.assistant} aria-label={`Assistant for ${o.name}`} onChange={() => dispatch({ type: "flag", org: o.id, flag: "assistant" })} /></td>
                  <td><input type="checkbox" style={{ accentColor: "#7650b0" }} checked={o.flags.integrations} aria-label={`Integrations for ${o.name}`} onChange={() => dispatch({ type: "flag", org: o.id, flag: "integrations" })} /></td>
                  <td>
                    <input className="fb-pl-input fb-pl-input--sm" type="number" min={0} defaultValue={o.flags.importLimit} key={`i-${o.id}-${o.flags.importLimit}`} aria-label={`Import limit for ${o.name}`} onBlur={(e) => dispatch({ type: "limit", org: o.id, limit: "importLimit", value: Number(e.target.value) })} /> rows
                  </td>
                  <td>
                    <input className="fb-pl-input fb-pl-input--sm" style={{ width: 70 }} type="number" min={0} defaultValue={o.flags.seats} key={`s-${o.id}-${o.flags.seats}`} aria-label={`Seat limit for ${o.name}`} onBlur={(e) => dispatch({ type: "limit", org: o.id, limit: "seats", value: Number(e.target.value) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="fb-pl-card fb-pl-card--flush" aria-label="Change history">
        <div style={{ padding: "14px 18px 6px" }}><h2 style={{ fontSize: 15 }}>Change history</h2></div>
        {state.flagHistory.map(([when, who, org, flag, change], i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "9px 18px", borderTop: "1px solid var(--pl-border)", fontSize: 13, flexWrap: "wrap" }}>
            <span className="fb-pl-muted" style={{ width: 110 }}>{when}</span>
            <span style={{ width: 90 }}>{who}</span>
            <span style={{ flex: 1 }}>{org} · <strong>{flag}</strong></span>
            <span className="fb-pl-mono" style={{ fontSize: 12 }}>{change}</span>
          </div>
        ))}
      </section>
    </>
  );
}

/** PL13 Announcements (V2): compose, preview in the organisation's shell, publish, expire. It shows from the start date until the end date, then expires on its own. */
export function Announcements() {
  const { state, dispatch } = usePlatform();
  const an = state.announcement;
  const patch = (p: Partial<typeof an>) => dispatch({ type: "announcement", patch: p });
  const toggleOrg = (id: string) => patch({ orgs: an.orgs.includes(id) ? an.orgs.filter((x) => x !== id) : [...an.orgs, id] });
  return (
    <>
      <PageHead title="Announcements" release="V2" />
      <DemoNotice what="Announcements" />
      <div className="fb-pl-grid">
        <section className="fb-pl-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} aria-label="Compose">
          <label className="fb-pl-field">
            <span className="fb-pl-label">Type</span>
            <select className="fb-pl-select" value={an.kind} onChange={(e) => patch({ kind: e.target.value as typeof an.kind })}>
              <option>Maintenance</option>
              <option>New feature</option>
              <option>Incident</option>
            </select>
          </label>
          <label className="fb-pl-field">
            <span className="fb-pl-label">Headline</span>
            <input className="fb-pl-input" value={an.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="fb-pl-field">
            <span className="fb-pl-label">Message</span>
            <textarea className="fb-pl-textarea" rows={2} value={an.body} onChange={(e) => patch({ body: e.target.value })} />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="fb-pl-label" style={{ padding: 0 }}>Show to</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {state.orgs.map((o) => (
                <label key={o.id} className="fb-pl-check">
                  <input type="checkbox" checked={an.orgs.includes(o.id)} onChange={() => toggleOrg(o.id)} />
                  {o.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="fb-pl-muted2" style={{ fontSize: 13 }}>Shows from <strong>{dateShort(an.start)}</strong> until <strong>{dateShort(an.end)}</strong>, then expires on its own.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="fb-pl-btn fb-pl-btn--primary" onClick={() => dispatch({ type: "announcement-publish" })}>{an.status === "Live" ? "Update" : "Publish now"}</button>
            <button type="button" className="fb-pl-btn" onClick={() => dispatch({ type: "announcement-expire" })}>Expire now</button>
          </div>
        </section>
        <section className="fb-pl-preview" aria-label="Preview">
          <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>PREVIEW · ORGANISATION SHELL</div>
          <div className="fb-pl-preview-shell">
            <div className="fb-pl-preview-bar" />
            <div className="fb-pl-preview-msg">
              <Info size={15} aria-hidden="true" />
              <span style={{ flex: 1 }}><strong>{an.title}</strong> {an.body}</span>
              <X size={14} aria-hidden="true" />
            </div>
            <div style={{ height: 110 }} />
          </div>
          <div className="fb-pl-muted2" style={{ fontSize: 12.5, marginTop: 10 }}>Status: <strong>{an.status}</strong></div>
        </section>
      </div>
    </>
  );
}
