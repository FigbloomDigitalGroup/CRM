"use client";

import Link from "next/link";
import { Lock, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, LoadingState, NoAccess, ReleaseTag, useMember } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { useRefData } from "../deals/data";
import { SavedViewsBar } from "../views/SavedViewsBar";
import { dateLabel, kes, useOpenDeals, useQuoteSearch, useQuotesForDeals } from "./api";
import type { QuoteRow } from "./api";
import { NewQuoteDialog } from "./NewQuoteDialog";
import { QuoteDrawer } from "./QuoteDrawer";
import { QuoteStatusPill } from "./QuoteBuilder";
import { CHIPS, NO_FILTERS, activityLines, fromViewState, isFiltered, toViewState } from "./quoteListModel";
import type { QuoteFilters } from "./quoteListModel";

const firstLine = (text: string | null | undefined) => (text ?? "").split(/\r?\n/)[0]!.trim();

type View = "deals" | "quotes";

interface Row {
  dealId: string;
  company: string;
  title: string;
  quote: QuoteRow | undefined;
}

/**
 * The Quotes page. Two views, both paged and searched by the server, neither loaded whole:
 *  - "Open deals": every open deal, with its quote if it has one ("No quote yet" if not).
 *  - "All quotes" (UC-R3, FIG-1784): the quotes that exist, with search, status chips and counts, owner and validity filters and saved views.
 * "New quote" (UC-R4, FIG-1777) picks a customer and a deal, then opens the builder; a quote's drawer shares it by email, link or WhatsApp.
 */
export function QuoteList() {
  const { orgSlug, can, roleName } = useMember();
  const allowed = can("quotes.view") || can("quotes.create") || can("quotes.approve");
  const mayCreate = can("quotes.create");
  const [view, setView] = useState<View>("deals");
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<QuoteFilters>(NO_FILTERS);
  const [picking, setPicking] = useState(false);

  const deals = useOpenDeals(orgSlug, text, page, allowed && view === "deals");
  const dealIds = (deals.data?.items ?? []).map((d) => d.id);
  const dealQuotes = useQuotesForDeals(orgSlug, dealIds, allowed && view === "deals");
  if (!allowed) return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Finance"], whoToAsk: ["Management"] }} />;

  const byDeal = new Map((dealQuotes.data?.items ?? []).map((q) => [q.dealId, q as QuoteRow]));
  const rows: Row[] = (deals.data?.items ?? []).map((d) => ({ dealId: d.id, company: d.company.name, title: firstLine(d.notes) || d.service?.name || "Deal", quote: byDeal.get(d.id) }));
  const pageCount = deals.data?.pageCount ?? 1;
  const failure = deals.error ?? dealQuotes.error;
  const loading = deals.isLoading || (dealIds.length > 0 && dealQuotes.isLoading);
  const switchView = (next: View) => (setView(next), setPage(1));

  return (
    <div className="fb-com" data-screen-label="Quotes">
      <header className="fb-com-head">
        <div>
          <div className="fb-com-titlerow"><h1 className="fb-com__title">Quotes</h1><ReleaseTag release="v1.1" /></div>
          <p className="fb-com__sub">Every quote across deals, with its status and how long it is valid. Each version is kept; a sent version cannot be edited.</p>
        </div>
        {mayCreate ? (
          <Button variant="primary" onClick={() => setPicking(true)}>
            <Plus size={16} aria-hidden="true" /> New quote
          </Button>
        ) : (
          <span className="fb-com-lock" title="Quotes are created by Sales and Management"><Lock size={14} aria-hidden="true" /> Quotes are created by Sales and Management</span>
        )}
      </header>

      <SavedViewsBar
        page="quotes"
        current={toViewState(filters)}
        onApply={(state) => {
          setFilters(fromViewState(state));
          setView("quotes");
          setPage(1);
        }}
      />

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

      {view === "quotes" ? (
        <AllQuotes filters={filters} setFilters={(f) => (setFilters(f), setPage(1))} page={page} setPage={setPage} mayCreate={mayCreate} onNew={() => setPicking(true)} />
      ) : loading ? (
        <LoadingState label="Loading quotes" />
      ) : failure ? (
        <QueryFailure error={failure} area="Quotes" onRetry={() => void (deals.refetch(), dealQuotes.refetch())} />
      ) : (
        <section className="fb-com-card">
          <div className="fb-com-tablewrap">
            <table className="fb-com-table">
              <caption className="fb-sr-only">Open deals and their quotes</caption>
              <thead><tr><th scope="col">Deal</th><th scope="col">Quote</th><th scope="col">Status</th><th scope="col" className="fb-com-num">Total</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={4}>{text ? "No open deal matches." : "No open deals or quotes yet."}</td></tr> : null}
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
          <Pager page={page} pageCount={pageCount} setPage={setPage} />
        </section>
      )}
      {picking ? <NewQuoteDialog onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

function Pager({ page, pageCount, setPage }: { page: number; pageCount: number; setPage: (f: (n: number) => number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="fb-com-actions" aria-label="Quotes pages" style={{ padding: "8px 12px", justifyContent: "space-between" }}>
      <button type="button" className="fb-btn fb-btn--secondary" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>Previous</button>
      <span className="fb-com-muted">Page {page} of {pageCount}</span>
      <button type="button" className="fb-btn fb-btn--secondary" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>Next</button>
    </nav>
  );
}

/** The "All quotes" view: filters, chips with counts, the table, and the drawer of the quote that was opened. */
function AllQuotes({ filters, setFilters, page, setPage, mayCreate, onNew }: { filters: QuoteFilters; setFilters: (f: QuoteFilters) => void; page: number; setPage: (f: (n: number) => number) => void; mayCreate: boolean; onNew: () => void }) {
  const { orgSlug, can } = useMember();
  const quotes = useQuoteSearch(orgSlug, filters, page, true);
  const ref = useRefData();
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (patch: Partial<QuoteFilters>) => setFilters({ ...filters, ...patch });

  const members = ref.data?.members ?? [];
  const nameOf = (id: string | null | undefined) => members.find((m) => m.membershipId === id)?.userName ?? "—";
  // Anyone who may see all deals may filter by owner; a salesperson sees only their own quotes, so the filter would be empty noise.
  const ownerFilter = can("deals.view.all") && members.length > 0;
  const items = quotes.data?.items ?? [];
  const counts = quotes.data?.statusCounts;
  const filtered = isFiltered(filters);
  const anyMasked = items.some((q) => q.latest.amountMasked);
  const open = items.find((q) => q.id === openId) ?? null;
  const pageCount = quotes.data?.pageCount ?? 1;

  return (
    <>
      <section className="fb-com-card fb-com-filters" aria-label="Filters">
        <label className="fb-com-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" className="fb-input" aria-label="Search quotes" placeholder="Search quote number, customer or deal" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </label>
        <div role="group" aria-label="Status" className="fb-com-chips">
          {CHIPS.map((c) => (
            <button key={c.key} type="button" className="fb-com-chip" aria-pressed={filters.chip === c.key} onClick={() => set({ chip: c.key })}>
              {c.label}
              {counts ? <span className="fb-com-count" aria-label={`${counts[c.key]} quotes`}>{counts[c.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="fb-com-actions">
          {ownerFilter ? (
            <select className="fb-input" aria-label="Owner" value={filters.owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="">Any owner</option>
              {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.userName}</option>)}
            </select>
          ) : null}
          <label className="fb-com-datefield"><span>Valid from</span><input type="date" className="fb-input" value={filters.validFrom} onChange={(e) => set({ validFrom: e.target.value })} /></label>
          <label className="fb-com-datefield"><span>Valid to</span><input type="date" className="fb-input" value={filters.validTo} onChange={(e) => set({ validTo: e.target.value })} /></label>
          {filtered ? <Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button> : null}
        </div>
      </section>

      {anyMasked ? (
        <p role="note" className="fb-com-lock"><Lock size={14} aria-hidden="true" /> Totals are hidden for your role. You see each quote&apos;s status and dates.</p>
      ) : null}

      {quotes.isLoading ? (
        <LoadingState label="Loading quotes" />
      ) : quotes.error ? (
        <QueryFailure error={quotes.error} area="Quotes" onRetry={() => void quotes.refetch()} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState title="No quote matches these filters" body="Change or clear the filters to see more." action={<Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>} />
        ) : (
          <EmptyState
            title="No quotes yet"
            body="Build a quote from any open deal. It picks prices from the service catalogue and keeps every version."
            action={mayCreate ? <Button variant="primary" onClick={onNew}>New quote</Button> : undefined}
          />
        )
      ) : (
        <section className="fb-com-card">
          <div className="fb-com-tablewrap">
            <table className="fb-com-table">
              <caption className="fb-sr-only">Quotes</caption>
              <thead>
                <tr>
                  <th scope="col">Quote</th><th scope="col">Customer</th><th scope="col">Owner</th><th scope="col">Valid until</th>
                  <th scope="col" className="fb-com-num">Total</th><th scope="col">Activity</th><th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((q) => {
                  const lines = activityLines({ sentAt: q.latest.sentAt, ...(q.activity ? { activity: q.activity } : {}) }, dateLabel);
                  return (
                    <tr key={q.id}>
                      <td><button type="button" className="fb-com-linkbtn" onClick={() => setOpenId(q.id)}>{`${q.number} · v${q.latest.version}`}</button></td>
                      <td><Link className="fb-com-linkbtn" href={`/o/${orgSlug}/quotes/${q.dealId}`}>{q.companyName}</Link></td>
                      <td>{nameOf(q.ownerMembershipId)}</td>
                      <td className={q.latest.expired ? "fb-com-bad" : undefined}>{dateLabel(q.latest.validUntil)}</td>
                      <td className="fb-com-num">{q.latest.amountMasked ? "Hidden" : kes(q.latest.total, q.currency)}</td>
                      <td>{lines.length === 0 ? <span className="fb-com-muted">—</span> : lines.map((l) => <div key={l} className="fb-com-muted">{l}</div>)}</td>
                      <td>{q.latest.expired ? <span className="fb-com-pill fb-com-pill--warn">Expired</span> : <QuoteStatusPill status={q.latest.status} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fb-com-muted" style={{ padding: "0 12px" }}>Showing {items.length} of {quotes.data?.total ?? items.length} quotes</p>
          <Pager page={page} pageCount={pageCount} setPage={setPage} />
        </section>
      )}
      {open ? <QuoteDrawer row={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
