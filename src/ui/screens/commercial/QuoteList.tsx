"use client";

import Link from "next/link";
import { LoadingState, NoAccess, ReleaseTag, useApiQuery, useMember } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { kes, useQuotes } from "./api";
import { QuoteStatusPill } from "./QuoteBuilder";

interface OpenDeal {
  id: string;
  outcome: string;
  notes?: string | null;
  company: { name: string };
  service?: { name?: string } | null;
}

/** Where a quote is reached from: the deals that carry one, and the open deals that could (the real entry is a deal's page; Q1). */
export function QuoteList() {
  const { orgSlug, can, roleName } = useMember();
  const allowed = can("quotes.create") || can("quotes.approve");
  const quotes = useQuotes(orgSlug);
  const deals = useApiQuery("getDeals", { params: { orgSlug }, query: { pageSize: "100", outcome: "OPEN" } }, { enabled: allowed, retry: false });
  if (!allowed) return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;

  const byDeal = new Map((quotes.data?.items ?? []).map((q) => [q.dealId, q]));
  const open = ((deals.data as unknown as { items?: OpenDeal[] } | undefined)?.items ?? []).filter((d) => d.outcome === "OPEN");
  const rows = [
    ...open.map((d) => ({ dealId: d.id, company: d.company.name, title: d.notes?.split(/\r?\n/)[0] || d.service?.name || "Deal", quote: byDeal.get(d.id) })),
    ...(quotes.data?.items ?? []).filter((q) => !open.some((d) => d.id === q.dealId)).map((q) => ({ dealId: q.dealId, company: q.companyName, title: "", quote: q })),
  ];

  return (
    <div className="fb-com" data-screen-label="Quotes">
      <header>
        <div className="fb-com-titlerow"><h1 className="fb-com__title">Quotes</h1><ReleaseTag release="v1.1" /></div>
        <p className="fb-com__sub">Build a quote from a deal. Each version is kept; a sent version cannot be edited.</p>
      </header>
      {quotes.isLoading ? (
        <LoadingState label="Loading quotes" />
      ) : quotes.error ? (
        <QueryFailure error={quotes.error} area="Quotes" onRetry={() => void quotes.refetch()} />
      ) : (
        <section className="fb-com-card">
          <div className="fb-com-tablewrap">
            <table className="fb-com-table">
              <caption className="fb-sr-only">Deals and their quotes</caption>
              <thead><tr><th scope="col">Deal</th><th scope="col">Quote</th><th scope="col">Status</th><th scope="col" className="fb-com-num">Total</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={4}>No open deals or quotes yet.</td></tr> : null}
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
        </section>
      )}
    </div>
  );
}
