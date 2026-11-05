"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dateShort, PageHead, SliceGate, StatusPill } from "./kit";
import { filterOrgs, type OrgSort } from "./logic";
import { usePlatform } from "./store";

const HEAD = ["NAME", "SLUG", "STATUS", "MEMBERS", "COMPANIES", "LEADS", "DEALS", "CREATED", "FLAGS (V2)"];

/** PL2 Organisations: each organisation is a separate tenant; counts only, no business data (GET /api/platform/organizations). */
export function Organisations() {
  const { state, slices, can } = usePlatform();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<OrgSort>("name");
  const rows = filterOrgs(state.orgs, q, status, sort);

  return (
    <>
      <PageHead title="Organisations" sub="Each organisation is a separate tenant. Counts only; no business data.">
        {can("platform.organizations.provision") ? (
          <Link href="/platform/organisations/new" className="fb-pl-btn fb-pl-btn--primary">
            <Plus size={16} aria-hidden="true" />
            Provision organisation
          </Link>
        ) : null}
      </PageHead>
      <SliceGate slice={slices.orgs} area="Organisations">
        <div className="fb-pl-filterbar">
          <input className="fb-pl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or slug" aria-label="Search name or slug" />
          <select className="fb-pl-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option>Active</option>
            <option>Suspended</option>
            <option>Offboarding</option>
            <option>Offboarded</option>
          </select>
          <select className="fb-pl-select" value={sort} onChange={(e) => setSort(e.target.value as OrgSort)} aria-label="Sort">
            <option value="name">Name</option>
            <option value="created">Created</option>
            <option value="members">Members</option>
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
                    <td><Link href={`/platform/organisations/${o.id}`} className="fb-pl-org-link">{o.name}</Link></td>
                    <td className="fb-pl-mono fb-pl-muted2" style={{ fontSize: 12 }}>{o.slug}</td>
                    <td><StatusPill status={o.status} /></td>
                    <td>{o.activeMembers} of {o.members}</td>
                    <td>{o.companies}</td>
                    <td>{o.leads}</td>
                    <td>{o.deals}</td>
                    <td className="fb-pl-muted2">{dateShort(o.created)}</td>
                    <td className="fb-pl-muted2">{state.release === "v2" ? `${o.flags.assistant ? "Assistant on" : "Assistant off"} · ${o.flags.seats} seats` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? (
            <div className="fb-pl-muted2" style={{ padding: 36, textAlign: "center" }}>
              {state.orgs.length ? <>No organisation matches “{q}”.</> : <>No organisations yet. Provision the first one.</>}
            </div>
          ) : null}
        </section>
      </SliceGate>
    </>
  );
}
