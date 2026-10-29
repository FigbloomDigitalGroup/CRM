"use client";

import Link from "next/link";
import { NoAccess, ReleaseTag, useMember } from "@/ui";
import { DemoNotice } from "../../demo/DemoBadge";
import { deals } from "./demo/data";
import { useDemoStore } from "./demo/store";
import { formatKes, quoteTotals } from "./quoteMath";
import { QuoteStatusPill } from "./QuoteBuilder";

/** Where a quote is reached from: the deals that carry one, and the open deals that could (the real entry is a deal's page; Q1). Demo data. */
export function QuoteList() {
  const { orgSlug, can, roleName } = useMember();
  const store = useDemoStore();
  if (!can("quotes.create") && !can("quotes.approve")) {
    return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;
  }
  const open = deals.filter((d) => d.stage !== "Closed Won");
  return (
    <div className="fb-com" data-screen-label="Quotes">
      <DemoNotice what="Quotes" />
      <header>
        <div className="fb-com-titlerow"><h1 className="fb-com__title">Quotes</h1><ReleaseTag release="v1.1" /></div>
        <p className="fb-com__sub">Build a quote from a deal. Each version is kept; a sent version cannot be edited.</p>
      </header>
      <section className="fb-com-card">
        <div className="fb-com-tablewrap">
          <table className="fb-com-table">
            <caption className="fb-sr-only">Deals and their quotes</caption>
            <thead><tr><th scope="col">Deal</th><th scope="col">Quote</th><th scope="col">Status</th><th scope="col" className="fb-com-num">Total</th></tr></thead>
            <tbody>
              {open.map((d) => {
                const q = store.quotes.find((x) => x.dealId === d.id);
                const t = q ? quoteTotals(q.lines, store.catalogue, q.discount) : null;
                return (
                  <tr key={d.id}>
                    <td><Link className="fb-com-linkbtn" href={`/o/${orgSlug}/quotes/${d.id}`}>{d.company}</Link><div className="fb-com-muted">{d.title}</div></td>
                    <td>{q ? `${q.no} · v${q.version}` : "No quote yet"}</td>
                    <td>{q ? <QuoteStatusPill status={q.status} /> : "—"}</td>
                    <td className="fb-com-num">{t ? formatKes(t.total) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
