"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { fetchAudit, fetchHealth, type AuditFilters } from "./api";
import { PageHead, SliceGate, StatusPill, whenLabel } from "./kit";
import type { AuditRow } from "./model";
import { usePlatform } from "./store";

const COMPONENTS = ["API", "DATABASE", "JOBS", "EMAIL", "STORAGE"];
const SEVERITIES = ["INFO", "DEGRADED", "OUTAGE"];

/** The health read for PL9 and platform mobile: GET /api/platform/health (each component is probed for real). */
export function useHealth() {
  const { call } = usePlatform();
  const q = useQuery({ queryKey: ["platform", "health"], queryFn: () => fetchHealth(call) });
  return { data: q.data, slice: { loading: q.isLoading, error: q.error, refetch: () => void q.refetch() } };
}

/** PL9 System health: per component, what the check found just now, the open incident markers, and what to do when something is not healthy. */
export function SystemHealth() {
  const { actions, can, now } = usePlatform();
  const { data, slice } = useHealth();
  const [form, setForm] = useState({ component: "API", severity: "DEGRADED", title: "", note: "" });
  const manage = can("platform.health.manage");
  return (
    <>
      <PageHead title="System health" sub="Each component is checked when this page opens. Open incidents are markers the platform team put up." />
      <SliceGate slice={slice} area="System health">
        {data?.components.map((c) => (
          <section key={c.k} className="fb-pl-card fb-pl-comp" aria-label={c.l}>
            <div style={{ flex: "1 1 300px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <strong style={{ fontSize: 15 }}>{c.l}</strong>
                <StatusPill status={c.status} />
              </div>
              <div className="fb-pl-muted2" style={{ fontSize: 13, marginTop: 4 }}>{c.d}</div>
              {c.status !== "Healthy" ? <div className="fb-pl-small" style={{ color: "var(--pl-orange-text)", marginTop: 4, fontWeight: 600 }}>What to do: check this component’s logs, then mark an incident below so the team knows.</div> : null}
            </div>
            <div className="fb-pl-small fb-pl-muted2" style={{ textAlign: "right" }}>
              {c.latencyMs !== null ? `${c.latencyMs} ms` : "—"}
              <div>Checked {whenLabel(c.checkedAt, now)}</div>
            </div>
          </section>
        ))}
        <section className="fb-pl-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }} aria-label="Incidents">
          <h2 style={{ fontSize: 16 }}>Open incidents</h2>
          {data?.incidents.length ? (
            data.incidents.map((i) => (
              <div key={i.id} className="fb-pl-row">
                <span className="fb-pl-grow">
                  <strong>{i.title}</strong> <span className="fb-pl-muted2 fb-pl-small">· {i.component.toLowerCase()} · {i.severity.toLowerCase()} · since {whenLabel(i.startedAt, now)}</span>
                  {i.note ? <span className="fb-pl-muted fb-pl-small" style={{ display: "block" }}>{i.note}</span> : null}
                </span>
                {manage ? <button type="button" className="fb-pl-btn fb-pl-btn--sm" onClick={() => void actions.resolveIncident(i.id)}>Resolve</button> : null}
              </div>
            ))
          ) : (
            <div className="fb-pl-muted2" style={{ fontSize: 13.5 }}>No open incidents.</div>
          )}
          {manage ? (
            <form
              style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await actions.createIncident({ component: form.component, severity: form.severity, title: form.title, ...(form.note ? { note: form.note } : {}) });
                if (res.ok) setForm({ ...form, title: "", note: "" });
              }}
            >
              <select className="fb-pl-select" style={{ width: "auto", height: 36 }} aria-label="Component" value={form.component} onChange={(e) => setForm({ ...form, component: e.target.value })}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select>
              <select className="fb-pl-select" style={{ width: "auto", height: 36 }} aria-label="Severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select>
              <input className="fb-pl-input" style={{ flex: 1, minWidth: 200, height: 36 }} aria-label="Incident title" placeholder="Title (3 to 140 characters)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <button type="submit" className="fb-pl-btn fb-pl-btn--primary" style={{ height: 36 }} disabled={form.title.trim().length < 3}>Mark incident</button>
            </form>
          ) : null}
        </section>
      </SliceGate>
    </>
  );
}

const ACTIONS: [string, string][] = [["", "Any action"], ["organization", "Organisations"], ["data_request", "Data requests"], ["platform", "Sign-in and admins"], ["incident", "Health incidents"], ["audit", "Audit log"]];

/** PL8 Platform audit log: read-only, filterable, exportable (GET /api/platform/audit). Nobody can edit or delete an entry. */
export function PlatformAudit() {
  const { state, now, call, csv, toast } = usePlatform();
  const [f, setF] = useState<AuditFilters>({});
  const [more, setMore] = useState<{ rows: AuditRow[]; cursor: number | null } | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; rowsChecked: number; problem: string | null } | null>(null);
  const q = useQuery({ queryKey: ["platform", "audit", f], queryFn: () => fetchAudit(call, f) });
  const first = q.data?.items ?? [];
  const rows = [...first, ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : q.data?.nextCursor ?? null;
  const admins = new Map<string, string>();
  for (const a of state.admins) admins.set(a.id, a.name);
  for (const r of rows) if (r.byId && !admins.has(r.byId)) admins.set(r.byId, r.by);
  const set = (patch: AuditFilters) => {
    setF({ ...f, ...patch });
    setMore(null);
  };

  async function exportCsv() {
    try {
      const text = await csv("/api/platform/audit/export", { ...f });
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "platform-audit-log.csv";
        a.click();
        URL.revokeObjectURL(url);
      }
      toast("platform-audit-log.csv downloaded");
    } catch {
      toast("The export didn’t work. Try again in a moment.");
    }
  }
  async function verify() {
    try {
      const r = await call<{ ok: boolean; rowsChecked: number; problem: string | null }>("POST", "/api/platform/audit/verify", {});
      setCheck(r);
    } catch {
      toast("The check didn’t run. Try again in a moment.");
    }
  }

  return (
    <>
      <PageHead
        title="Platform audit log"
        sub={<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Lock size={13} aria-hidden="true" />Append-only. Platform admins cannot edit or delete entries.</span>}
      >
        <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => void verify()}>
          <ShieldCheck size={15} aria-hidden="true" />
          Verify the chain
        </button>
        <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => void exportCsv()}>
          <Download size={15} aria-hidden="true" />
          Export
        </button>
      </PageHead>
      {check ? (
        <div role="status" className="fb-pl-banner" style={check.ok ? { background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)" } : { background: "var(--pl-red-soft)", color: "var(--pl-red)" }}>
          {check.ok ? `The log is intact: ${check.rowsChecked.toLocaleString("en-GB")} entries checked.` : `The check failed: ${check.problem ?? "the chain does not hold"}.`}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select className="fb-pl-select" style={{ width: "auto", height: 38 }} aria-label="Admin" value={f.actorIdentityId ?? ""} onChange={(e) => set({ actorIdentityId: e.target.value || undefined })}>
          <option value="">Any admin</option>
          {[...admins].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="fb-pl-select" style={{ width: "auto", height: 38 }} aria-label="Organisation" value={f.organizationId ?? ""} onChange={(e) => set({ organizationId: e.target.value || undefined })}>
          <option value="">Any organisation</option>
          {state.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="fb-pl-select" style={{ width: "auto", height: 38 }} aria-label="Action" value={f.action ?? ""} onChange={(e) => set({ action: e.target.value || undefined })}>
          {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <SliceGate slice={{ loading: q.isLoading, error: q.error, refetch: () => void q.refetch() }} area="The audit log">
        <section className="fb-pl-card fb-pl-card--flush">
          <div className="fb-pl-scroll">
            <table className="fb-pl-table fb-pl-table--audit">
              <thead>
                <tr>{["WHEN", "ADMIN", "ORGANISATION", "ACTION", "TARGET", "REQUEST"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="fb-pl-muted2" style={{ whiteSpace: "nowrap" }}>{whenLabel(a.at, now)}</td>
                    <td>{a.by}</td>
                    <td>{a.org}</td>
                    <td style={{ fontWeight: 600 }}>{a.action}</td>
                    <td>{a.target} <span className="fb-pl-muted">{a.detail}</span></td>
                    <td className="fb-pl-mono fb-pl-muted2" style={{ fontSize: 11.5 }}>{a.requestId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? <div className="fb-pl-muted2" style={{ padding: 30, textAlign: "center" }}>No entries match these filters.</div> : null}
          {cursor !== null ? (
            <div style={{ padding: 12, textAlign: "center" }}>
              <button
                type="button"
                className="fb-pl-btn"
                onClick={async () => {
                  const next = await fetchAudit(call, f, cursor);
                  setMore({ rows: [...(more?.rows ?? []), ...next.items], cursor: next.nextCursor });
                }}
              >
                Load older entries
              </button>
            </div>
          ) : null}
        </section>
      </SliceGate>
    </>
  );
}
