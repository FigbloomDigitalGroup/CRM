"use client";

import { Download, Lock } from "lucide-react";
import { useState } from "react";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import type { DemoHealth } from "./demo/data";
import { PageHead, StatusPill, whenLabel } from "./kit";
import { usePlatform } from "./store";

export const TL_COLOUR = { 1: "var(--pl-primary)", 2: "var(--pl-orange)", 3: "var(--pl-red)" } as const;

export function HealthTimeline({ c }: { c: DemoHealth }) {
  return (
    <div className="fb-pl-tl" role="img" aria-label={`${c.l}, last 8 days: ${c.tl.map((v) => (v === 1 ? "healthy" : v === 2 ? "degraded" : "down")).join(", ")}`}>
      {c.tl.map((t, i) => <span key={i} style={{ background: TL_COLOUR[t] }} />)}
    </div>
  );
}

/** PL9 System health: per component, last eight days, with what to do when something is not healthy. */
export function SystemHealth() {
  const { state, toast } = usePlatform();
  return (
    <>
      <PageHead title="System health" sub={<>Per component, last 8 days. <a href="#errors" onClick={(e) => { e.preventDefault(); toast("Opens the error-tracking service in a new tab"); }}>Open error tracking ↗</a></>} />
      <DemoNotice what="System health" />
      {state.health.map((c) => (
        <section key={c.k} className="fb-pl-card fb-pl-comp" aria-label={c.l}>
          <div style={{ flex: "1 1 300px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <strong style={{ fontSize: 15 }}>{c.l}</strong>
              <StatusPill status={c.status} />
            </div>
            <div className="fb-pl-muted2" style={{ fontSize: 13, marginTop: 4 }}>{c.d}</div>
            {c.hint ? <div className="fb-pl-small" style={{ color: "var(--pl-orange-text)", marginTop: 4, fontWeight: 600 }}>What to do: {c.hint}</div> : null}
          </div>
          <HealthTimeline c={c} />
        </section>
      ))}
    </>
  );
}

/** PL8 Platform audit log: read-only, filterable, exportable. Nobody can edit or delete an entry. */
export function PlatformAudit() {
  const { state, now, dispatch, toast } = usePlatform();
  const [f, setF] = useState({ admin: "", org: "", action: "" });
  const rows = state.audit.filter((a) => (!f.admin || a.by === f.admin) && (!f.org || a.org === f.org) && (!f.action || a.action.toLowerCase().includes(f.action)));
  const who = (id: string) => state.admins.find((a) => a.id === id)?.name ?? id;
  const filters: { l: string; k: keyof typeof f; opts: [string, string][] }[] = [
    { l: "Admin", k: "admin", opts: [["", "Any admin"], ...state.admins.map((a): [string, string] => [a.id, a.name])] },
    { l: "Organisation", k: "org", opts: [["", "Any organisation"], ...state.orgs.map((o): [string, string] => [o.name, o.name])] },
    { l: "Action", k: "action", opts: [["", "Any action"], ["support", "Support access"], ["provision", "Provisioning"], ["suspend", "Suspensions"], ["flag", "Flag changes"], ["admin", "Admin changes"], ["export", "Exports"]] },
  ];
  return (
    <>
      <PageHead
        title="Platform audit log"
        sub={<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Lock size={13} aria-hidden="true" />Append-only. Platform admins cannot edit or delete entries.</span>}
      >
        <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => { dispatch({ type: "audit", action: "Audit log exported", target: `${rows.length} rows` }); toast("platform-audit.csv downloaded"); }}>
          <Download size={15} aria-hidden="true" />
          Export
        </button>
      </PageHead>
      <DemoNotice what="The audit log" />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {filters.map((x) => (
          <select key={x.k} className="fb-pl-select" style={{ width: "auto", height: 38 }} aria-label={x.l} value={f[x.k]} onChange={(e) => setF({ ...f, [x.k]: e.target.value })}>
            {x.opts.map(([v, l]) => <option key={v + l} value={v}>{l}</option>)}
          </select>
        ))}
      </div>
      <section className="fb-pl-card fb-pl-card--flush">
        <div className="fb-pl-scroll">
          <table className="fb-pl-table fb-pl-table--audit">
            <thead>
              <tr>{["WHEN", "ADMIN", "ORGANISATION", "ACTION", "TARGET", "IP · DEVICE"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td className="fb-pl-muted2" style={{ whiteSpace: "nowrap" }}>{whenLabel(a.at, now)}</td>
                  <td>{who(a.by)}</td>
                  <td>{a.org}</td>
                  <td style={{ fontWeight: 600 }}>{a.action}</td>
                  <td>{a.target} <span className="fb-pl-muted">{a.detail}</span></td>
                  <td className="fb-pl-mono fb-pl-muted2" style={{ fontSize: 11.5 }}>{a.ip} · {a.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className="fb-pl-muted2" style={{ padding: 30, textAlign: "center" }}>No entries match these filters.</div> : null}
      </section>
    </>
  );
}
