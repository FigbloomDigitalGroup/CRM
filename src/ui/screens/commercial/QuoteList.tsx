"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadingState, NoAccess, ReleaseTag, useMember } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { kes, useOpenDeals, useQuotes, useQuotesForDeals } from "./api";
import type { QuoteListItem } from "./api";
import { QuoteStatusPill } from "./QuoteBuilder";

const firstLine = (text: string | null | undefined) => (text ?? "").split(/\r?\n/)[0]!.trim();

type View = "deals" | "quotes";

interface Row {
  dealId: string;
  company: string;
  title: string;
  quote: QuoteListItem | undefined;
}

/**
 * Where a quote is reached from (the real entry is a deal's page; Q1). Two views, both paged and searched by the server, neither loaded whole:
 *  - "Open deals": every open deal, with its quote if it has one ("No quote yet" if not). One page of deals, then the quotes of just those deals
 *    in one request.
 *  - "All quotes": the quotes that exist, including those on deals that are no longer open.
 */
export function QuoteList() {
  const { orgSlug, can, roleName } = useMember();
  const allowed = can("quotes.create") || can("quotes.approve");
  const [view, setView] = useState<View>("deals");
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");

  const deals = useOpenDeals(orgSlug, text, page, allowed && view === "deals");
  const dealIds = (deals.data?.items ?? []).map((d) => d.id);
  const dealQuotes = useQuotesForDeals(orgSlug, dealIds, allowed && view === "deals");
  const allQuotes = useQuotes(orgSlug, page, allowed && view === "quotes");
  if (!allowed) return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;

  const byDeal = new Map((dealQuotes.data?.items ?? []).map((q) => [q.dealId, q]));
  const rows: Row[] =
    view === "deals"
      ? (deals.data?.items ?? []).map((d) => ({ dealId: d.id, company: d.company.name, title: firstLine(d.notes) || d.service?.name || "Deal", quote: byDeal.get(d.id) }))
      : (allQuotes.data?.items ?? []).map((q) => ({ dealId: q.dealId, company: q.companyName, title: "", quote: q }));
  const current = view === "deals" ? deals : allQuotes;
  const pageCount = current.data?.pageCount ?? 1;
  const failure = view === "deals" ? deals.error ?? dealQuotes.error : allQuotes.error;
  const loading = view === "deals" ? deals.isLoading || (dealIds.length > 0 && dealQuotes.isLoading) : allQuotes.isLoading;
  const switchView = (next: View) => (setView(next), setPage(1));

  return (
    <div className="fb-com" data-screen-label="Quotes">
      <header>
        <div className="fb-com-titlerow"><h1 className="fb-com__title">Quotes</h1><ReleaseTag release="v1.1" /></div>
        <p className="fb-com__sub">Build a quote from a deal. Each version is kept; a sent version cannot be edited.</p>
      </header>
      <section className="fb-com-card fb-com-form">
        <div className="fb-com-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div role="group" aria-label="Show" className="fb-com-seg">
            <button type="button" aria-pressed={view === "deals"} onClick={() => switchView("deals")}>Open deals</button>
            <button type="button" aria-pressed={view === "quotes"} onClick={() => switchView("quotes")}>All quotes</button>
          </div>
          {view === "deals" ? (
            <input
              type="search"
              className="fb-input"
              aria-label="Search open deals"
              placeholder="Search open deals by company or notes"
              value={text}
              onChange={(e) => (setText(e.target.value), setPage(1))}
            />
          ) : null}
        </div>
      </section>
      {loading ? (
        <LoadingState label="Loading quotes" />
      ) : failure ? (
        <QueryFailure error={failure} area="Quotes" onRetry={() => void (view === "deals" ? (deals.refetch(), dealQuotes.refetch()) : allQuotes.refetch())} />
      ) : (
        <section className="fb-com-card">
          <div className="fb-com-tablewrap">
            <table className="fb-com-table">
              <caption className="fb-sr-only">{view === "deals" ? "Open deals and their quotes" : "Quotes"}</caption>
              <thead><tr><th scope="col">Deal</th><th scope="col">Quote</th><th scope="col">Status</th><th scope="col" className="fb-com-num">Total</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={4}>{view === "deals" ? (text ? "No open deal matches." : "No open deals or quotes yet.") : "No quotes yet."}</td></tr> : null}
                {rows.map((r) => (
                  <tr key={r.dealId}>
                    <td><Link className="fb-com-linkbtn" href={`/o/${orgSlug}/quotes/${r.dealId}`}>{r.company}</Link>{r.title ? <div className="fb-com-muted">{r.title}</div> : null}</td>
                    <td>{r.quote ? `${r.quote.number} · v${r.quote.latest.version}` : "No quote yet"}</td>
                    <td>{r.quote ? <QuoteStatusPill status={r.quote.latest.status} /> : "—"}</td>
                    <td className="fb-com-num">{r.quote ? (r.quote.latest.amountMasked ? "Hidden" : kes(r.quote.latest.total, r.quote.currency)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <nav className="fb-com-actions" aria-label="Quotes pages" style={{ padding: "8px 12px", justifyContent: "space-between" }}>
              <button type="button" className="fb-btn fb-btn--secondary" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>Previous</button>
              <span className="fb-com-muted">Page {page} of {pageCount}</span>
              <button type="button" className="fb-btn fb-btn--secondary" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>Next</button>
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
