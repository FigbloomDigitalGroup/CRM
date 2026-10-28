"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { Dialog } from "../../components/overlays";
import { Input } from "../../components/forms";
import { ErrorState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { HIcon, Seg } from "../home/kit";
import { InvoiceDialog } from "./InvoiceDialog";
import { cents, day, dayShort, fromCents, INVOICE_LABEL, INVOICE_TONE, kes, kesShort, STATE_LABEL, STATE_TONE, type DealPayState, type InvoiceStatus } from "./format";
import { useRefreshPayments, type DealPaymentRow, type InvoiceRow } from "./data";

type Tab = "all" | "OVERDUE" | "AWAITING_PAYMENT" | "NOT_INVOICED" | "PAID_IN_FULL";
const PAGE_SIZE = 50;
const INVOICE_HEAD = ["INVOICE", "FOR", "AMOUNT", "DUE", "STATUS"];

/**
 * The Payments tracker (F1, FIG-1100). One row per won deal with what was contracted, received and still owed; open a row for its invoices,
 * the "next" follow-up note and, for Management, the audit trail. Status only: invoices are raised and money received in the accounting
 * system, and bank or M-Pesa details are never stored here. Visible to Finance and Management; everyone else gets the explained no-access
 * state and the screen never asks the API for a figure.
 */
export function PaymentsScreen() {
  const member = useMember();
  const { orgSlug, can } = member;
  const allowed = can("finance.view.payments");
  const canManage = can("finance.manage.payments");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const params = useSearchParams();
  const [invoiceId, setInvoiceId] = useState<string | null>(params?.get("invoice") ?? null);

  const deals = useApiQuery("listWonDealPayments", { params: { orgSlug }, query: { page: String(page), pageSize: String(PAGE_SIZE) } }, { enabled: allowed, placeholderData: (prev) => prev });
  const summary = useApiQuery("getPaymentSummary", { params: { orgSlug } }, { enabled: allowed });
  const totals = useApiQuery("listInvoices", { params: { orgSlug }, query: { pageSize: "1" } }, { enabled: allowed });

  const header = (
    <div className="fb-pay__head">
      <h1 className="fb-pay__title">Payments</h1>
      <div className="fb-pay__sub">Won-deal values, contract amounts and where each payment stands.</div>
      {allowed ? (
        <div className="fb-pay__meta">
          <span className={`fb-scope ${canManage ? "fb-scope--mine" : "fb-scope--organisation"}`}>{canManage ? "Finance · view and update status" : "Organisation · view only"}</span>
          <span className="fb-pay__sub">{canManage ? "You can update invoice status and set payment follow-ups." : "Finance updates these. You can view everything."}</span>
        </div>
      ) : null}
    </div>
  );

  if (!allowed) {
    return (
      <div className="fb-pay" data-screen-label="Payments">
        {header}
        <NoAccess area="Payments" denial={{ yourRole: member.roleName, ownerRoles: ["Finance", "Management"], whoToAsk: ["Your Management lead"] }} />
      </div>
    );
  }

  if (deals.isError) {
    const e = describeError(deals.error);
    return (
      <div className="fb-pay" data-screen-label="Payments">
        {header}
        {e.kind === "noAccess" ? <NoAccess area="Payments" denial={e.denial} /> : <ErrorState error={deals.error} area="Payments" onRetry={() => void deals.refetch()} />}
      </div>
    );
  }

  const rows = (deals.data?.items ?? []) as unknown as DealPaymentRow[];
  const counts: Record<Tab, number> = { all: rows.length, OVERDUE: 0, AWAITING_PAYMENT: 0, NOT_INVOICED: 0, PAID_IN_FULL: 0 };
  for (const r of rows) counts[r.state] += 1;
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => (tab === "all" || r.state === tab) && (!q || r.companyName.toLowerCase().includes(q) || (r.serviceName ?? "").toLowerCase().includes(q)));

  // The headline figures: contracted and invoiced come from the won deals on this page of the tracker; collected, awaiting and overdue from the whole invoice book.
  const sum = summary.data;
  const byStatus = totals.data?.totals?.byStatus as Record<string, { count: number; amount: string; outstanding: string }> | undefined;
  const invoiced = byStatus ? Object.entries(byStatus).filter(([s]) => s !== "DRAFT" && s !== "VOID").reduce((n, [, v]) => n + cents(v.amount), 0) : null;
  const invoicedCount = byStatus ? Object.entries(byStatus).filter(([s]) => s !== "DRAFT" && s !== "VOID").reduce((n, [, v]) => n + v.count, 0) : 0;
  const collected = byStatus ? Object.entries(byStatus).filter(([s]) => s !== "VOID").reduce((n, [, v]) => n + cents(v.amount) - cents(v.outstanding), 0) : null;
  const contracted = rows.length > 0 && rows.every((r) => r.dealValue === null) ? null : rows.reduce((n, r) => n + cents(r.dealValue), 0);
  const overdueN = sum?.overdue.count ?? 0;
  const awaiting = sum ? cents(sum.outstanding) - cents(sum.overdue.outstanding) : null;
  const kpis: { key: string; label: string; value: string; sub: string; dot: string; alert?: boolean }[] = [
    { key: "contracted", label: "Contracted", value: contracted === null ? "—" : kesShort(fromCents(contracted)), sub: `${deals.data?.total ?? 0} won deals`, dot: "var(--primary)" },
    { key: "invoiced", label: "Invoiced", value: invoiced === null ? "—" : kesShort(fromCents(invoiced)), sub: `${invoicedCount} invoices`, dot: "var(--blue)" },
    { key: "collected", label: "Collected", value: collected === null ? "—" : kesShort(fromCents(collected)), sub: sum ? `${kesShort(sum.collectedThisMonth.amount)} this month` : "paid", dot: "var(--primary)" },
    { key: "awaiting", label: "Awaiting", value: awaiting === null ? "—" : kesShort(fromCents(awaiting)), sub: sum ? `${sum.dueThisWeek.count} due this week` : "sent, not yet paid", dot: "var(--orange)" },
    { key: "overdue", label: "Overdue", value: sum ? kesShort(sum.overdue.outstanding) : "—", sub: sum ? `${overdueN} past due date` : "past due date", dot: "var(--red)", alert: overdueN > 0 },
  ];

  return (
    <div className="fb-pay" data-screen-label="Payments">
      {header}
      <div className="fb-pay__lock">
        <HIcon name="lock" size={16} />
        <span>A light tracker. Invoices are raised and payments received in your accounting system; bank and M-Pesa details are never stored here.</span>
      </div>

      <div className="fb-pay__kpis">
        {kpis.map((k) => (
          <div key={k.key} className="fb-pay__kpi" data-testid={`pay-kpi-${k.key}`}>
            <div className="fb-pay__kpil">
              <span className="fb-pay__dot" style={{ background: k.dot }} aria-hidden="true" />
              {k.label}
            </div>
            <div className="fb-pay__kpiv" data-alert={k.alert ? "true" : undefined}>{k.value}</div>
            <div className="fb-pay__kpis2">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-pay__filters">
        <Seg
          label="Payment status"
          value={tab}
          onChange={(t) => setTab(t)}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "OVERDUE", label: "Overdue", count: counts.OVERDUE },
            { id: "AWAITING_PAYMENT", label: "Awaiting payment", count: counts.AWAITING_PAYMENT },
            { id: "NOT_INVOICED", label: "To invoice", count: counts.NOT_INVOICED },
            { id: "PAID_IN_FULL", label: "Paid in full", count: counts.PAID_IN_FULL },
          ]}
        />
        <div className="fb-pay__search">
          <Input label="Search customer or service" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {deals.isPending ? (
        <div className="fb-pay__stack" aria-busy="true">
          <span className="fb-sr-only" role="status">Loading payments</span>
          {[1, 2, 3].map((i) => (
            <div key={i} className="fb-pay__skel" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="fb-pay__state">No won deals yet. When Sales closes one, it appears here with its contract amount.</div>
      ) : visible.length === 0 ? (
        <div className="fb-pay__state" role="status">
          Nothing matches. <button type="button" className="fb-pay__link" onClick={() => { setTab("all"); setSearch(""); }}>Clear the filters</button>
        </div>
      ) : (
        <div className="fb-pay__stack">
          {visible.map((r) => (
            <DealAccount key={r.dealId} row={r} open={Boolean(open[r.dealId])} onToggle={() => setOpen((o) => ({ ...o, [r.dealId]: !o[r.dealId] }))} onInvoice={setInvoiceId} />
          ))}
        </div>
      )}

      {deals.data && deals.data.pageCount > 1 ? (
        <nav className="fb-pay__pager" aria-label="Pages">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <span>Page {deals.data.page} of {deals.data.pageCount}</span>
          <Button size="sm" disabled={page >= deals.data.pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </nav>
      ) : null}

      {invoiceId ? <InvoiceDialog invoiceId={invoiceId} onClose={() => setInvoiceId(null)} /> : null}
    </div>
  );
}

function DealAccount({ row, open, onToggle, onInvoice }: { row: DealPaymentRow; open: boolean; onToggle: () => void; onInvoice: (id: string) => void }) {
  const { orgSlug, can, timeZone } = useMember();
  const canManage = can("finance.manage.payments");
  const canNote = canManage || can("finance.followup.note");
  const [noting, setNoting] = useState(false);
  const tone = STATE_TONE[row.state as DealPayState];
  const invoices = useApiQuery("listInvoices", { params: { orgSlug }, query: { dealId: row.dealId, pageSize: "50", sort: "dueOn" } }, { enabled: open });
  const items = (invoices.data?.items ?? []) as InvoiceRow[];
  const cur = row.currency || "KES";
  return (
    <section className="fb-pay__acct" data-testid={`pay-deal-${row.dealId}`}>
      <button type="button" className="fb-pay__acctbtn" aria-expanded={open} onClick={onToggle}>
        <span>
          <span className="fb-pay__co">{row.companyName}</span>
          <span className="fb-pay__what">{row.serviceName ?? "Deal"} · won {day(row.wonAt, timeZone)}</span>
        </span>
        <span><span className="fb-pay__k">CONTRACT</span><span className="fb-pay__v">{row.dealValue === null ? "—" : kes(row.dealValue, cur)}</span></span>
        <span><span className="fb-pay__k">PAID</span><span className="fb-pay__v">{kes(row.received, cur)}</span></span>
        <span><span className="fb-pay__k">BALANCE</span><span className="fb-pay__v" data-alert={row.state === "OVERDUE" ? "true" : undefined}>{kes(row.outstanding, cur)}</span></span>
        <span><span className="fb-pay__pill" style={{ background: tone.bg, color: tone.fg }}>{STATE_LABEL[row.state as DealPayState]}</span></span>
        <span className="fb-pay__chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="fb-pay__detail">
          {invoices.isPending ? (
            <div role="status" className="fb-pay__dlgnote">Loading invoices…</div>
          ) : invoices.isError ? (
            <div role="alert" className="fb-pay__dlgnote">{describeError(invoices.error).body}</div>
          ) : items.length === 0 ? (
            <div className="fb-pay__dlgnote">No invoices tracked for this deal yet.</div>
          ) : (
            <div className="fb-pay__tablewrap">
              <table className="fb-pay__table">
                <caption className="fb-sr-only">Invoices for {row.companyName}</caption>
                <thead>
                  <tr>{INVOICE_HEAD.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {items.map((i) => <InvoiceLine key={i.id} inv={i} canManage={canManage} onManage={() => onInvoice(i.id)} />)}
                </tbody>
              </table>
            </div>
          )}
          <div className="fb-pay__next">
            <span className="fb-pay__nexttxt">
              <strong>Next:</strong> {row.nextNote ? row.nextNote.note : "Nothing pending"}
              {row.nextNote?.nextOn ? ` · ${dayShort(row.nextNote.nextOn, timeZone)}` : ""}
            </span>
            {canNote ? (
              <Button size="sm" onClick={() => setNoting(true)}>
                <HIcon name="clock" size={14} />
                {row.nextNote ? "Edit payment follow-up" : "Add payment follow-up"}
              </Button>
            ) : null}
            <Link href={`/o/${orgSlug}/companies/${row.companyId}`} className="fb-pay__open">Open customer</Link>
          </div>
        </div>
      ) : null}
      {noting ? <NoteDialog row={row} onClose={() => setNoting(false)} /> : null}
    </section>
  );
}

function InvoiceLine({ inv, canManage, onManage }: { inv: InvoiceRow; canManage: boolean; onManage: () => void }) {
  const { orgSlug, timeZone } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshPayments();
  const [busy, setBusy] = useState(false);
  const status = inv.status as InvoiceStatus;
  const tone = INVOICE_TONE[status];
  const open = status === "SENT" || status === "PART_PAID" || status === "OVERDUE";

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.show({ tone: "success", message: done });
      refresh();
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="fb-pay__mono">{inv.number}</td>
      <td>{(inv.notes as string | null | undefined) || <span className="fb-pay__muted">—</span>}</td>
      <td className="fb-pay__strong">{kes(inv.amount, inv.currency)}</td>
      <td className="fb-pay__muted">
        {day(inv.dueOn, timeZone)}
        {inv.overdue ? <span className="fb-pay__late"> · {inv.daysOverdue}d late</span> : null}
      </td>
      <td>
        <div className="fb-pay__statuscell">
          <span className="fb-pay__pill" style={{ background: tone.bg, color: tone.fg }}>{INVOICE_LABEL[status]}</span>
          {canManage && status === "DRAFT" ? (
            <Button size="sm" loading={busy} onClick={() => void act(() => api.call("markInvoiceSent", { params: { orgSlug, invoiceId: inv.id } }), `${inv.number} marked sent.`)}>Mark sent</Button>
          ) : null}
          {canManage && open ? (
            <Button
              size="sm"
              loading={busy}
              aria-label={`Mark ${inv.number} paid in full`}
              onClick={() =>
                void act(
                  () => api.call("recordPayment", { params: { orgSlug, invoiceId: inv.id }, body: { amount: inv.balance }, idempotencyKey: newIdempotencyKey() }),
                  `${inv.number} marked paid in full. Reverse it from Manage if that was a mistake.`,
                )
              }
            >
              Mark paid in full
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-label={`${canManage ? "Manage" : "Open"} ${inv.number}`} onClick={onManage}>{canManage ? "Manage" : "Details"}</Button>
        </div>
      </td>
    </tr>
  );
}

/** The one "next" follow-up note Finance keeps on a won deal (a note, not a task: signed departure 1.5). */
function NoteDialog({ row, onClose }: { row: DealPaymentRow; onClose: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshPayments();
  const [note, setNote] = useState(row.nextNote?.note ?? "");
  const [nextOn, setNextOn] = useState(row.nextNote?.nextOn ? row.nextNote.nextOn.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = useMemo(() => Boolean(row.nextNote), [row.nextNote]);

  async function save() {
    if (!note.trim()) {
      setError("Write what happens next.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.call("setDealPaymentNote", { params: { orgSlug, dealId: row.dealId }, body: { note: note.trim(), nextOn: nextOn || null } });
      toast.show({ tone: "success", message: `Payment follow-up saved for ${row.companyName}.` });
      refresh();
      onClose();
    } catch (e) {
      setError(describeError(e).body);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await api.call("clearDealPaymentNote", { params: { orgSlug, dealId: row.dealId } });
      toast.show({ tone: "success", message: "Follow-up cleared." });
      refresh();
      onClose();
    } catch (e) {
      setError(describeError(e).body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Payment follow-up · ${row.companyName}`}
      actions={
        <>
          {existing ? <Button variant="ghost" onClick={() => void clear()} loading={busy}>Clear</Button> : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>Save</Button>
        </>
      }
    >
      <div className="fb-pay__dlg">
        <Input label="What happens next?" required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call accounts about the second invoice" />
        <Input label="By when" type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} />
        {error ? <div role="alert" className="fb-pay__error">{error}</div> : null}
      </div>
    </Dialog>
  );
}
