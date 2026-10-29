"use client";

import { Info, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { agoLabel, dateShort, PageHead, StatusPill } from "./kit";
import { filterOrgs, type OrgSort } from "./logic";
import { usePlatform } from "./store";

const HEAD = ["NAME", "SLUG", "STATUS", "MEMBERS", "LAST ACTIVITY", "CREATED", "FLAGS (V2)", "ADOPTION"];
const ADOPT: Record<string, number> = { High: 4, Medium: 2, Low: 1 };

/** PL2 Organisations: each organisation is a separate tenant; counts only, no business data. */
export function Organisations() {
  const { state, now } = usePlatform();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<OrgSort>("last");
  const rows = filterOrgs(state.orgs, q, status, sort);
  const firstRun = state.orgs.filter((o) => !o.sandbox && o.status === "Active").length === 1 && !q;

  return (
    <>
      <PageHead title="Organisations" sub="Each organisation is a separate tenant. Counts only; no business data.">
        <Link href="/platform/organisations/new" className="fb-pl-btn fb-pl-btn--primary">
          <Plus size={16} aria-hidden="true" />
          Provision organisation
        </Link>
      </PageHead>
      
      <div className="fb-pl-filterbar">
        <input className="fb-pl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or slug" aria-label="Search name or slug" />
        <select className="fb-pl-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option>Active</option>
          <option>Suspended</option>
          <option>Offboarding</option>
        </select>
        <select className="fb-pl-select" value={sort} onChange={(e) => setSort(e.target.value as OrgSort)} aria-label="Sort">
          <option value="last">Last activity</option>
          <option value="name">Name</option>
          <option value="created">Created</option>
        </select>
      </div>
      <section className="fb-pl-card fb-pl-card--flush">
        <div className="fb-pl-scroll">
          <table className="fb-pl-table">
            <thead>
              <tr>
                {HEAD.map((h) => (
                  <th key={h} scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/platform/organisations/${o.id}`} className="fb-pl-org-link">{o.name}</Link>
                    {o.sandbox ? <span className="fb-pl-tag">Sandbox</span> : null}
                  </td>
                  <td className="fb-pl-mono fb-pl-muted2" style={{ fontSize: 12 }}>{o.slug}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td>{o.members}</td>
                  <td className="fb-pl-muted2">{agoLabel(o.last, now)}</td>
                  <td className="fb-pl-muted2">{dateShort(o.created)}</td>
                  <td className="fb-pl-muted2">{state.release === "v2" ? `${o.flags.assistant ? "Assistant on" : "Assistant off"} · ${o.flags.seats} seats` : "—"}</td>
                  <td>
                    <span className="fb-pl-adopt" role="img" aria-label={`Adoption: ${o.adoption}`}>
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} style={{ background: i < (ADOPT[o.adoption] ?? 0) ? "var(--pl-primary)" : "var(--pl-surface-3)" }} />
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className="fb-pl-muted2" style={{ padding: 36, textAlign: "center" }}>No organisation matches “{q}”.</div> : null}
        {firstRun ? (
          <div className="fb-pl-small fb-pl-muted2" style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--pl-border)", background: "var(--pl-surface-2)" }}>
            <Info size={14} aria-hidden="true" />
            First run: only FigBloom Digital Group exists until you provision the next organisation.
          </div>
        ) : null}
      </section>
    </>
  );
}
