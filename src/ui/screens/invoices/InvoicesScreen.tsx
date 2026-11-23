"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { Operations } from "@/api-client";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { Input } from "../../components/forms";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState, NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { HIcon, Seg } from "../home/kit";
import type { InvoiceRow } from "../finance/data";
import { INVOICE_LABEL, INVOICE_TONE, day, kes, kesShort, type InvoiceStatus } from "../finance/format";
import { InvoiceDrawer } from "./InvoiceDrawer";
import {
  AGEING_COLOUR,
  AGEING_KEYS,
  AGEING_LABEL,
  NO_FILTERS,
  barShare,
  filterParams,
  isFiltered,
  listQuery,
  statusForBucket,
  type Ageing,
  type InvoiceFilters,
  type StatusFilter,
  STATUS_CHIPS,
} from "./model";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The totals block of the list, with the ageing buckets UC-R7 adds (additive; the frozen contract leaves `totals` loose). */
interface Totals {
  byStatus: Record<string, { count: number; amount: string; outstanding: string }>;
  outstanding: string;
  nothingToCollect: boolean;
  ageing?: Ageing;
}

/**
 * The Invoices page (UC-R7, FIG-1785, design QI5). Every invoice with its status, due date, amount and balance, an ageing strip of what is still
 * owed, status chips, search and filters, and a drawer for one invoice (UC-R9, `InvoiceDrawer`).
 *
 * Who sees what (rule 7): a role without `invoices.view` gets the explained no-access state. Balances, payments and the overdue state are
 * Finance and Management only (`finance.view.payments`); a role that holds `invoices.view` without it is told so and the screen never asks
 * the API for a figure. Nothing is processed here: payments are recorded, never taken.
 *
 * `newInvoiceSlot` is where UC-R8 (create invoice) plugs its "New invoice" button in: it is rendered at the end of the page header's action row.
 */
export function InvoicesScreen({ newInvoiceSlot }: { newInvoiceSlot?: ReactNode } = {}) {
  const member = useMember();
  const { orgSlug, can, timeZone } = member;
  const mayOpen = can("invoices.view");
  const mayFigures = can("finance.view.payments");
  const params = useSearchParams();
  const [filters, setFilters] = useState<InvoiceFilters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [invoiceId, setInvoiceId] = useState<string | null>(params?.get("invoice") ?? null);
  const debounced = useDebounced(search);
  useEffect(() => setFilters((f) => (f.q === debounced ? f : { ...f, q: debounced, page: 1 })), [debounced]);
  const set = (patch: Partial<InvoiceFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const allowed = mayOpen && mayFigures;
  const query = listQuery(filters);
  const list = useApiQuery(
    "listInvoices",
    { params: { orgSlug }, query: query as Operations["listInvoices"]["query"] },
    { enabled: allowed, placeholderData: (prev) => prev },
  );
  // The ageing strip and chip counts follow customer and due-date filters only, never the status chip, so they stay a map of the whole book.
  const totals = list.data?.totals as Totals | undefined;
  const items = (list.data?.items ?? []) as InvoiceRow[];

  const header = (
    <div className="fb-inv__head">
      <div>
        <h1 className="fb-inv__title">Invoices</h1>
        <div className="fb-inv__sub">What has been billed, what has been paid and what is still owed. Payments are recorded here, never processed.</div>
      </div>
      <div className="fb-inv__actions" data-slot="new-invoice">
        {allowed && can("finance.export") ? (
          <a className="fb-btn fb-btn--secondary" href={`/api/orgs/${orgSlug}/invoices/export${exportQuery(filters)}`} download>
            Export CSV
          </a>
        ) : null}
        {newInvoiceSlot}
      </div>
    </div>
  );

  if (!mayOpen) {
    return (
      <div className="fb-inv" data-screen-label="Invoices">
        {header}
        <NoAccess area="Invoices" denial={{ yourRole: member.roleName, ownerRoles: ["Finance", "Management"], whoToAsk: ["Your Management lead"] }} />
      </div>
    );
  }

  if (!mayFigures) {
    return (
      <div className="fb-inv" data-screen-label="Invoices">
        {header}
        <div className="fb-inv__masked" role="status" data-testid="inv-masked">
          <HIcon name="lock" size={16} />
          <span>Balances and payments are visible to Finance and Management. They are not shown to your role, so there is nothing to list here.</span>
        </div>
      </div>
    );
  }

  if (list.isError) {
    const e = describeError(list.error);
    return (
      <div className="fb-inv" data-screen-label="Invoices">
        {header}
        {e.kind === "noAccess" ? <NoAccess area="Invoices" denial={e.denial} /> : <ErrorState error={list.error} area="Invoices" onRetry={() => void list.refetch()} />}
      </div>
    );
  }

  const count = (s: StatusFilter) => (s === "" ? Object.values(totals?.byStatus ?? {}).reduce((n, v) => n + v.count, 0) : (totals?.byStatus[s]?.count ?? 0));
  const ageing = totals?.ageing ?? {};
  const ageingTotal = totals ? kes(totals.outstanding) : "";
  const filtered = isFiltered(filters);
  const bookEmpty = !list.isPending && !filtered && items.length === 0 && (list.data?.total ?? 0) === 0;

  const columns: Column<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      alwaysVisible: true,
      sortValue: (r) => r.number,
      cell: (r) => (
        <button type="button" className="fb-inv__open" aria-label={`Open ${r.number}`} onClick={() => setInvoiceId(r.id)}>
          {r.number}
        </button>
      ),
    },
    { key: "customer", header: "Customer", cell: (r) => <span><span className="fb-inv__co">{r.companyName}</span>{r.notes ? <span className="fb-inv__what">{String(r.notes)}</span> : null}</span> },
    {
      key: "dueOn",
      header: "Due",
      sortValue: (r) => r.dueOn,
      cell: (r) => (
        <span data-late={r.overdue ? "true" : undefined} className="fb-inv__due">
          {r.status === "VOID" ? "—" : day(r.dueOn, timeZone)}
          {r.overdue ? ` · ${r.daysOverdue}d late` : ""}
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => Number(r.amount), cell: (r) => kes(r.amount, r.currency) },
    { key: "balance", header: "Balance", align: "right", cell: (r) => <span data-late={r.overdue ? "true" : undefined}>{r.status === "VOID" ? "—" : kes(r.balance, r.currency)}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const s = r.status as InvoiceStatus;
        return <span className="fb-inv__pill" style={{ background: INVOICE_TONE[s].bg, color: INVOICE_TONE[s].fg }}>{INVOICE_LABEL[s]}</span>;
      },
    },
  ];

  return (
    <div className="fb-inv" data-screen-label="Invoices">
      {header}

      <section className="fb-inv__ageing" aria-label="Ageing of what is still owed" data-testid="inv-ageing">
        <div className="fb-inv__ageinghead">
          <h2>Ageing of what is still owed</h2>
          <span>{totals ? `${ageingTotal} outstanding` : ""}</span>
        </div>
        <div className="fb-inv__bar" role="img" aria-label={AGEING_KEYS.map((k) => `${AGEING_LABEL[k]} ${kesShort(ageing[k]?.outstanding ?? "0")}`).join(", ")}>
          {AGEING_KEYS.map((k) => (
            <span key={k} style={{ width: `${barShare(ageing, k)}%`, background: AGEING_COLOUR[k] }} />
          ))}
        </div>
        <div className="fb-inv__buckets">
          {AGEING_KEYS.map((k) => (
            <button key={k} type="button" className="fb-inv__bucket" onClick={() => set({ status: statusForBucket(k) })} aria-label={`Show ${AGEING_LABEL[k]} invoices`}>
              <span className="fb-inv__bucketl"><span className="fb-inv__dot" style={{ background: AGEING_COLOUR[k] }} aria-hidden="true" />{AGEING_LABEL[k]}</span>
              <span className="fb-inv__bucketv">{totals ? kesShort(ageing[k]?.outstanding ?? "0") : "—"}</span>
              <span className="fb-inv__bucketn">{totals ? `${ageing[k]?.count ?? 0} invoice${(ageing[k]?.count ?? 0) === 1 ? "" : "s"}` : ""}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="fb-inv__filters">
        <Seg
          label="Invoice status"
          value={filters.status}
          onChange={(status) => set({ status })}
          options={STATUS_CHIPS.map((c) => ({ id: c.id, label: c.label, count: totals ? count(c.id) : undefined }))}
        />
        <div className="fb-inv__search">
          <Input label="Search invoice number or customer" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="fb-inv__more" role="group" aria-label="More filters">
        <Input label="Due from" type="date" value={filters.dueFrom} onChange={(e) => set({ dueFrom: e.target.value })} />
        <Input label="Due to" type="date" value={filters.dueTo} onChange={(e) => set({ dueTo: e.target.value })} />
        <Input label="Amount from" inputMode="decimal" value={filters.amountMin} onChange={(e) => set({ amountMin: e.target.value })} />
        <Input label="Amount to" inputMode="decimal" value={filters.amountMax} onChange={(e) => set({ amountMax: e.target.value })} />
        <label className="fb-inv__check">
          <input type="checkbox" checked={filters.hasBalance} onChange={(e) => set({ hasBalance: e.target.checked })} />
          Still owed only
        </label>
        {filtered ? <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilters(NO_FILTERS); }}>Clear filters</Button> : null}
      </div>

      {bookEmpty ? (
        <EmptyState
          icon={<HIcon name="file" size={20} />}
          title="No invoices yet"
          body="Create one from a won deal, an accepted quote or straight from a customer."
          action={newInvoiceSlot}
        />
      ) : (
        <DataTable<InvoiceRow>
          caption="Invoices"
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={list.isPending}
          sort={filters.sort}
          onSortChange={(sort) => set({ sort })}
          onRowClick={(r) => setInvoiceId(r.id)}
          empty={
            <div className="fb-inv__state" role="status">
              Nothing matches. <button type="button" className="fb-inv__link" onClick={() => { setSearch(""); setFilters(NO_FILTERS); }}>Clear the filters</button>
            </div>
          }
        />
      )}

      {list.data ? (
        <div className="fb-inv__foot">
          <span>{`Showing ${items.length} of ${list.data.total} invoices`}</span>
          {list.data.pageCount > 1 ? (
            <nav className="fb-inv__pager" aria-label="Pages">
              <Button size="sm" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}>Previous</Button>
              <span>Page {list.data.page} of {list.data.pageCount}</span>
              <Button size="sm" disabled={filters.page >= list.data.pageCount} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </nav>
          ) : null}
        </div>
      ) : null}

      {invoiceId ? <InvoiceDrawer invoiceId={invoiceId} onClose={() => setInvoiceId(null)} /> : null}
    </div>
  );
}

function exportQuery(f: InvoiceFilters): string {
  const p = new URLSearchParams(filterParams(f));
  const s = p.toString();
  return s ? `?${s}` : "";
}
