"use client";

import { ArrowLeft, Clock, Copy, FileText, Send, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiRequestError } from "@/api-client";
import { Banner, Button, EmptyState, IconButton, Input, LoadingState, NoAccess, ReleaseTag, Select, Textarea, useApiQuery, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import {
  STATUS_LABEL,
  dateLabel,
  describeError,
  estimateTotals,
  historyOf,
  kes,
  useApplyToDeal,
  useCatalogue,
  useCreateQuote,
  useDealQuote,
  useNewVersion,
  useQuoteActivity,
  useQuoteVersion,
  useRecordResponse,
  useRequestQuoteApproval,
  useSaveVersion,
  useSendQuote,
  whenLabel,
  type QuoteStatus,
  type QuoteVersionView,
} from "./api";
import { QuoteDocument } from "./QuoteDocument";

/**
 * Quote builder, document preview and versions (Q1, FIG-1168), on the real quote API (docs/QUOTES_AND_APPROVALS.md). A quote is built from the
 * catalogue, discounted (above the limit it goes to Management), previewed as the document the client gets, and versioned: a version that was
 * submitted or sent is locked by the database and "New version" starts a draft while earlier versions stay in the history.
 *
 * Money, cost and margin are rendered as the API returns them: masked fields arrive as null and are shown as hidden, never rebuilt.
 */

const TONE: Record<QuoteStatus, string> = { DRAFT: "neutral", PENDING_APPROVAL: "warn", APPROVED: "info", REJECTED: "bad", SENT: "info", ACCEPTED: "ok", DECLINED: "bad" };

export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return <span className={`fb-com-pill fb-com-pill--${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

interface DraftLine {
  key: string;
  lineId?: string;
  catalogueItemId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  unitCost: number | null;
}
interface Draft {
  lines: DraftLine[];
  discount: string;
  terms: string;
}

const fromVersion = (v: QuoteVersionView): Draft => ({
  lines: v.lines.map((l) => ({ key: l.id, lineId: l.id, catalogueItemId: l.catalogueItemId, description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost })),
  discount: String(v.discountPercent),
  terms: v.terms ?? "",
});

interface DealView {
  id: string;
  value?: string | number | null;
  valueMasked?: boolean;
  currency?: string;
  notes?: string | null;
  company: { name: string };
  service?: { name?: string } | null;
}

export function QuoteBuilder({ dealId }: { dealId: string }) {
  const { orgSlug, can, roleName } = useMember();
  const allowed = can("quotes.create") || can("quotes.approve");
  const deal = useApiQuery("getDeal", { params: { orgSlug, dealId } }, { enabled: allowed, retry: false });
  const quote = useDealQuote(orgSlug, dealId);
  const noQuote = quote.error instanceof ApiRequestError && quote.error.status === 404;

  if (!allowed) return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;
  if (deal.error) return <QueryFailure error={deal.error} area="This deal" onRetry={() => void deal.refetch()} />;
  const d = deal.data as unknown as DealView | undefined;
  if (!d || quote.isLoading) return <LoadingState label="Loading the quote" />;
  if (noQuote) return <StartQuote dealId={dealId} deal={d} />;
  if (quote.error || !quote.data) return <QueryFailure error={quote.error} area="Quotes" onRetry={() => void quote.refetch()} />;
  return <Builder deal={d} quoteId={quote.data.id} number={quote.data.number} current={quote.data.currentVersion ?? 1} />;
}

function StartQuote({ dealId, deal }: { dealId: string; deal: DealView }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const create = useCreateQuote();
  if (!can("quotes.create")) {
    return <EmptyState title="No quote on this deal yet" body="Sales builds the quote; it appears here once it is sent for approval." action={<Link href={`/o/${orgSlug}/approvals`}>Back to approvals</Link>} />;
  }
  return (
    <div className="fb-com" data-screen-label="Quote builder">
      <Link href={`/o/${orgSlug}/quotes`} className="fb-com-back">
        <ArrowLeft size={15} aria-hidden="true" /> {deal.company.name} deal
      </Link>
      <EmptyState
        title="No quote on this deal yet"
        body="Start a draft, then add items from the catalogue."
        action={
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutateAsync({ params: { orgSlug, dealId }, body: {} }).then(
                () => toast.show({ message: "Draft quote created", tone: "success" }),
                (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
              )
            }
          >
            Start a quote
          </Button>
        }
      />
    </div>
  );
}

function Builder({ deal, quoteId, number, current }: { deal: DealView; quoteId: string; number: string; current: number }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const mayBuild = can("quotes.create");
  const mayApprove = can("quotes.approve");
  const [previewing, setPreviewing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picked, setPicked] = useState(0);

  const versionQ = useQuoteVersion(orgSlug, quoteId, current);
  const quoteQ = useDealQuote(orgSlug, deal.id);
  const catalogue = useCatalogue(orgSlug, mayBuild);
  const activity = useQuoteActivity(orgSlug, quoteId, current);
  const save = useSaveVersion();
  const newVersion = useNewVersion();
  const send = useSendQuote();
  const ask = useRequestQuoteApproval();
  const respond = useRecordResponse();
  const apply = useApplyToDeal();

  const v = versionQ.data;
  if (!v) return versionQ.error ? <QueryFailure error={versionQ.error} area="This quote" onRetry={() => void versionQ.refetch()} /> : <LoadingState label="Loading the quote" />;

  const fail = (e: unknown) => toast.show({ message: describeError(e).body, tone: "danger" });
  const params = { orgSlug, quoteId, version: String(v.version) };
  const locked = v.locked || v.status !== "DRAFT";
  const canEdit = mayBuild && !locked;
  const rows = (draft ?? fromVersion(v)).lines;
  const dirty = draft !== null;
  const discountNum = Number(draft?.discount ?? v.discountPercent);
  const catItems = catalogue.data?.items ?? [];
  const estimate = dirty && !v.amountMasked ? estimateTotals(rows, Number.isFinite(discountNum) ? discountNum : 0) : null;
  const subtotal = estimate ? estimate.subtotal : v.subtotal;
  const discountAmt = estimate ? estimate.discount : v.discountAmount;
  const total = estimate ? estimate.total : v.total;
  const showMargin = !v.marginMasked;
  const dealTitle = deal.notes?.split(/\r?\n/)[0] || deal.service?.name || "Deal";
  const edit = (next: Partial<Draft>) => setDraft({ ...(draft ?? fromVersion(v)), ...next });
  const history = historyOf(quoteQ.data?.versions ?? [v]);
  const views = (activity.data?.events ?? []).filter((e) => e.type === "VIEWED").length;
  const differs = v.total !== null && ["APPROVED", "SENT", "ACCEPTED"].includes(v.status) && mayBuild && !deal.valueMasked && Math.abs(v.total - Number(deal.value ?? 0)) > 0.5;
  const approvalNeeded = v.approvalRequired === true && v.status === "DRAFT";

  const saveDraft = async (): Promise<boolean> => {
    if (!dirty) return true;
    try {
      await save.mutateAsync({
        params,
        body: {
          lines: rows.map((l) => (l.lineId ? { lineId: l.lineId, quantity: l.quantity } : { catalogueItemId: l.catalogueItemId, quantity: l.quantity })),
          discountPercent: discountNum,
          terms: draft?.terms ?? v.terms ?? "",
        },
      });
      setDraft(null);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const onSend = async () => {
    if (!rows.length) return toast.show({ message: "Add at least one line item first", tone: "danger" });
    if (!(await saveDraft())) return;
    try {
      if (approvalNeeded) {
        await ask.mutateAsync({ params });
        toast.show({ message: "Sent to Management for approval", tone: "success" });
      } else {
        await send.mutateAsync({ params });
        toast.show({ message: "Quote sent with a secure link", tone: "success" });
      }
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="fb-com" data-screen-label="Quote builder">
      <Link href={`/o/${orgSlug}/quotes`} className="fb-com-back">
        <ArrowLeft size={15} aria-hidden="true" /> {deal.company.name} deal
      </Link>

      <header className="fb-com-head">
        <div>
          <div className="fb-com-titlerow">
            <h1 className="fb-com__title">Quote {number}</h1>
            <span className="fb-com-pill fb-com-pill--neutral">Version {v.version}</span>
            <QuoteStatusPill status={v.status} />
            {v.expired ? <span className="fb-com-pill fb-com-pill--warn">Expired</span> : null}
            <ReleaseTag release="v1.1" />
          </div>
          <p className="fb-com__sub">
            {deal.company.name} · {dealTitle} · valid until {dateLabel(v.validUntil)}
          </p>
        </div>
        <div className="fb-com-actions">
          <Button onClick={() => setPreviewing((p) => !p)}>
            <FileText size={16} aria-hidden="true" /> {previewing ? "Back to editing" : "Preview document"}
          </Button>
          {mayBuild && locked ? (
            <Button
              disabled={newVersion.isPending}
              onClick={() =>
                newVersion.mutateAsync({ params: { orgSlug, quoteId }, body: {} }).then(
                  (r) => toast.show({ message: `Version ${r.version} created. Earlier versions stay in history.`, tone: "success" }),
                  fail,
                )
              }
            >
              <Copy size={15} aria-hidden="true" /> New version
            </Button>
          ) : null}
          {dirty && canEdit ? (
            <Button disabled={save.isPending} onClick={() => void saveDraft().then((ok) => ok && toast.show({ message: "Draft saved", tone: "success" }))}>
              Save draft
            </Button>
          ) : null}
          {mayBuild && (v.status === "DRAFT" || v.status === "APPROVED") ? (
            <Button variant="primary" disabled={send.isPending || ask.isPending} onClick={() => void onSend()}>
              <Send size={15} aria-hidden="true" /> {approvalNeeded ? "Request approval" : "Send quote"}
            </Button>
          ) : null}
        </div>
      </header>

      {v.status === "PENDING_APPROVAL" ? (
        <Banner tone="warning" icon={<Clock size={16} />} title="Waiting for Management." action={mayApprove ? <Link className="fb-btn fb-btn--secondary" href={`/o/${orgSlug}/approvals`}>Open approvals</Link> : undefined}>
          A {v.discountPercent}% discount is above the limit, so this version can’t be sent until it’s approved. You’ll be notified.
        </Banner>
      ) : null}
      {v.status === "REJECTED" ? (
        <Banner tone="warning" title="Not approved.">
          {v.decisionReason ? `Reason: ${v.decisionReason}. ` : ""}Use “New version” to change the discount and ask again.
        </Banner>
      ) : null}

      <div className="fb-com-cols">
        <div className="fb-com-main">
          {!previewing ? (
            <>
              <section className="fb-com-card">
                <div className="fb-com-card__head">
                  <h2>Line items</h2>
                  <span className="fb-com-muted">Prices from the service catalogue</span>
                </div>
                {rows.length === 0 ? (
                  <p className="fb-com-empty">No line items yet. Add one from the catalogue below.</p>
                ) : (
                  <div className="fb-com-tablewrap">
                    <table className="fb-com-table">
                      <caption className="fb-sr-only">Quote line items</caption>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col" className="fb-com-num">Qty</th>
                          <th scope="col" className="fb-com-num">Unit price</th>
                          {showMargin ? <th scope="col" className="fb-com-num">Margin</th> : null}
                          <th scope="col" className="fb-com-num">Amount</th>
                          <th scope="col"><span className="fb-sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((l) => (
                          <tr key={l.key}>
                            <td>
                              <div className="fb-com-strong">{l.description}</div>
                              <div className="fb-com-muted">per {l.unit}</div>
                            </td>
                            <td className="fb-com-num">
                              <input
                                className="fb-input fb-com-qty"
                                type="number"
                                min={1}
                                value={l.quantity}
                                readOnly={!canEdit}
                                aria-label={`Quantity for ${l.description}`}
                                onChange={(e) => edit({ lines: rows.map((x) => (x.key === l.key ? { ...x, quantity: Number(e.target.value) } : x)) })}
                              />
                            </td>
                            <td className="fb-com-num">{kes(l.unitPrice, v.currency)}</td>
                            {showMargin ? <td className="fb-com-num">{l.unitCost !== null && l.unitPrice ? `${Math.round(((l.unitPrice - l.unitCost) / l.unitPrice) * 100)}%` : "—"}</td> : null}
                            <td className="fb-com-num fb-com-strong">{l.unitPrice === null ? "Hidden" : kes(l.unitPrice * l.quantity, v.currency)}</td>
                            <td>
                              {canEdit ? (
                                <IconButton label={`Remove ${l.description}`} onClick={() => edit({ lines: rows.filter((x) => x.key !== l.key) })}>
                                  <X size={14} aria-hidden="true" />
                                </IconButton>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEdit ? (
                  <div className="fb-com-add">
                    <Select
                      key={picked}
                      label="Add a catalogue item"
                      value=""
                      placeholder="+ Add from catalogue…"
                      options={catItems.map((c) => ({ value: c.id, label: `${c.name} · ${kes(c.price, c.currency)}` }))}
                      onChange={(e) => {
                        const item = catItems.find((c) => c.id === e.target.value);
                        if (!item) return;
                        const has = rows.find((x) => x.catalogueItemId === item.id && !x.lineId);
                        edit({
                          lines: has
                            ? rows.map((x) => (x === has ? { ...x, quantity: x.quantity + 1 } : x))
                            : [...rows, { key: `new-${picked}-${rows.length}`, catalogueItemId: item.id, description: item.name, unit: item.unit, quantity: 1, unitPrice: item.price, unitCost: item.cost }],
                        });
                        setPicked((n) => n + 1);
                      }}
                    />
                  </div>
                ) : null}
              </section>

              <section className="fb-com-card fb-com-form">
                <Input
                  label="Discount %"
                  type="number"
                  min={0}
                  max={30}
                  value={draft?.discount ?? String(v.discountPercent)}
                  readOnly={!canEdit}
                  help="Above the approval limit, the quote goes to Management first."
                  onChange={(e) => edit({ discount: e.target.value })}
                />
                <Textarea label="Terms" rows={2} value={draft?.terms ?? v.terms ?? ""} readOnly={!canEdit} onChange={(e) => edit({ terms: e.target.value })} />
                {locked ? <p className="fb-com-muted">This version is {v.status === "PENDING_APPROVAL" ? "waiting for a decision" : STATUS_LABEL[v.status].toLowerCase()} and cannot be changed. Use “New version” to edit.</p> : null}
                {dirty ? <p className="fb-com-muted" role="status">Unsaved changes. Totals are final once you save.</p> : null}
              </section>
            </>
          ) : (
            <QuoteDocument orgSlug={orgSlug} quoteId={quoteId} version={v.version} number={number} />
          )}
        </div>

        <aside className="fb-com-side" aria-label="Quote summary">
          <section className="fb-com-card">
            <h2>Summary</h2>
            <dl className="fb-com-sum">
              <div><dt>Subtotal</dt><dd>{kes(subtotal, v.currency)}</dd></div>
              <div><dt>Discount {Number.isFinite(discountNum) ? discountNum : v.discountPercent}%</dt><dd>{discountAmt === null ? "Hidden" : `−${kes(discountAmt, v.currency)}`}</dd></div>
              <div className="fb-com-sum__total"><dt>Total</dt><dd>{kes(total, v.currency)}</dd></div>
              {showMargin && v.marginPct !== null ? (
                <div><dt>Margin (Management only)</dt><dd className={v.marginPct < 25 ? "fb-com-bad" : undefined}>{v.marginPct}%</dd></div>
              ) : null}
            </dl>
            {v.amountMasked ? <p className="fb-com-note">Amounts are hidden for your role.</p> : null}
            {differs ? (
              <p className="fb-com-note">
                Deal value is {kes(Number(deal.value), deal.currency)}.{" "}
                <button type="button" className="fb-com-linkbtn" onClick={() => apply.mutateAsync({ params }).then(() => toast.show({ message: "Deal value updated", tone: "success" }), fail)}>
                  Use the quote total
                </button>
              </p>
            ) : null}
          </section>

          <section className="fb-com-card">
            <h2>Client response</h2>
            {v.status === "SENT" ? (
              <>
                <p className="fb-com-muted">The client opens a secure link{views ? ` (opened ${views} time${views === 1 ? "" : "s"})` : ""}. Record their answer here when you hear back.</p>
                {mayBuild ? (
                  <div className="fb-com-actions">
                    <Button onClick={() => respond.mutateAsync({ params, body: { outcome: "ACCEPTED" } }).then(() => toast.show({ message: "Marked accepted. The deal stays where it is until you mark it won.", tone: "success" }), fail)}>Mark accepted</Button>
                    <Button onClick={() => respond.mutateAsync({ params, body: { outcome: "DECLINED" } }).then(() => toast.show({ message: "Marked declined", tone: "info" }), fail)}>Mark declined</Button>
                  </div>
                ) : null}
              </>
            ) : v.status === "ACCEPTED" || v.status === "DECLINED" ? (
              <p className="fb-com-ok">{STATUS_LABEL[v.status]}{v.respondedAt ? ` · ${whenLabel(v.respondedAt)}` : ""}</p>
            ) : (
              <p className="fb-com-muted">Send the quote first. E-signature in the browser arrives with V2.</p>
            )}
          </section>

          <section className="fb-com-card">
            <h2>Version history</h2>
            <ol className="fb-com-history">
              {[...history].reverse().map((h) => (
                <li key={h.key}>
                  <span className="fb-com-pill fb-com-pill--neutral">v{h.v}</span>
                  <div>
                    <div className="fb-com-strong">{h.note}</div>
                    <div className="fb-com-muted">{whenLabel(h.at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
