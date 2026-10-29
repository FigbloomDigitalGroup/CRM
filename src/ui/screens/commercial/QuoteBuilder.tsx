"use client";

import { ArrowLeft, CheckCircle2, Clock, Copy, FileText, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner, Button, EmptyState, IconButton, Input, NoAccess, ReleaseTag, Select, Textarea, useMember, useToast } from "@/ui";
import { DemoNotice } from "../../demo/DemoBadge";
import { deals as demoDeals } from "./demo/data";
import { ensureQuote, quoteActions, requestApproval, requestDeposit, setDealValue, useDemoStore } from "./demo/store";
import { MAX_DISCOUNT, formatKes, isLocked, needsApproval, quoteTotals, type QuoteStatus } from "./quoteMath";
import { QuoteDocument } from "./QuoteDocument";
import { SignPreviewDialog } from "./SignPreviewDialog";

/**
 * Quote builder, document preview and versions (Q1, FIG-1168; design-spec/CrmGrowth.dc.html). A quote is built from the service catalogue,
 * priced with a discount that goes to Management above the limit, previewed as the document the client gets, and versioned: a sent, signed or
 * waiting version is read-only and "New version" starts a draft while every earlier version stays in the history.
 *
 * Margin is shown only with `deals.margin` (Management): the column, the summary row and the figure are not rendered for anyone else, not merely
 * hidden. Runs on demo data (docs/RESTRUCTURE_LOG.md) until B6.11 and B6.12 are wired.
 */

const TONE: Record<QuoteStatus, string> = { Draft: "neutral", "Pending approval": "warn", Approved: "info", Sent: "info", Signed: "ok" };

export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return <span className={`fb-com-pill fb-com-pill--${TONE[status]}`}>{status}</span>;
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function QuoteBuilder({ dealId }: { dealId: string }) {
  const { orgSlug, can, userName, roleName } = useMember();
  const toast = useToast();
  const store = useDemoStore();
  const [previewing, setPreviewing] = useState(false);
  const [signing, setSigning] = useState(false);

  const deal = demoDeals.find((d) => d.id === dealId);
  const mayBuild = can("quotes.create");
  const mayApprove = can("quotes.approve");
  const has = store.quotes.some((x) => x.dealId === dealId);
  useEffect(() => {
    if (deal && mayBuild && !has) ensureQuote(deal.id, deal.title, userName);
  }, [deal, mayBuild, has, userName]);
  if (!mayBuild && !mayApprove) return <NoAccess area="Quotes" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;
  if (!deal) return <EmptyState title="This deal is not in the demo data" body="Open a quote from the Quotes list." action={<Link href={`/o/${orgSlug}/quotes`}>Back to quotes</Link>} />;

  const q = store.quotes.find((x) => x.dealId === deal.id);
  if (!q) return mayBuild ? null : <EmptyState title="No quote on this deal yet" body="Sales builds the quote; it appears here once it is sent for approval." action={<Link href={`/o/${orgSlug}/approvals`}>Back to approvals</Link>} />;
  const showMargin = can("deals.margin");
  const totals = quoteTotals(q.lines, store.catalogue, q.discount);
  const locked = isLocked(q.status);
  const canEdit = mayBuild && !locked;
  const waiting = q.status === "Pending approval";
  const v2 = true; // the e-signature panel shows whatever the release allows; the demo is V2-enabled (FIG-1193)
  const dealValue = store.dealValues[deal.id] ?? deal.value;
  const differs = totals.total > 0 && Math.abs(totals.total - dealValue) > 1 && mayBuild;
  const signed = q.status === "Signed";

  const send = () => {
    if (!q.lines.length) return toast.show({ message: "Add at least one line item first", tone: "danger" });
    if (needsApproval(q.discount, q.status, store.discountLimit)) {
      quoteActions.setStatus(deal!.id, "Pending approval", userName, `${q.discount}% discount · sent for approval`);
      requestApproval({ kind: "Discount", target: `${deal!.company} · ${q.no} v${q.version}`, detail: `${q.discount}% discount. Rule: above ${store.discountLimit}% needs Management.`, by: userName, quoteDealId: deal!.id });
      return toast.show({ message: "Sent to Management for approval", tone: "success" });
    }
    quoteActions.setStatus(deal!.id, "Sent", userName, `Sent to ${deal!.contact.split(",")[0]}${v2 ? " with a signing link" : " by email"}`);
    toast.show({ message: "Quote sent. A follow-up task was added for 3 days from now", tone: "success" });
  };

  const approveHere = () => {
    quoteActions.setStatus(deal!.id, "Approved", userName, "Discount approved");
    toast.show({ message: "Approved. Sales can send it now.", tone: "success" });
  };

  return (
    <div className="fb-com" data-screen-label="Quote builder">
      <DemoNotice what="The quote builder" />
      <Link href={`/o/${orgSlug}/quotes`} className="fb-com-back">
        <ArrowLeft size={15} aria-hidden="true" /> {deal.company} deal
      </Link>

      <header className="fb-com-head">
        <div>
          <div className="fb-com-titlerow">
            <h1 className="fb-com__title">Quote {q.no}</h1>
            <span className="fb-com-pill fb-com-pill--neutral">Version {q.version}</span>
            <QuoteStatusPill status={q.status} />
            <ReleaseTag release="v1.1" />
          </div>
          <p className="fb-com__sub">
            {deal.company} · {deal.title} · valid until {dateLabel(q.validUntil)}
          </p>
        </div>
        <div className="fb-com-actions">
          <Button onClick={() => setPreviewing((p) => !p)}>
            <FileText size={16} aria-hidden="true" /> {previewing ? "Back to editing" : "Preview document"}
          </Button>
          {mayBuild && locked ? (
            <Button
              onClick={() => {
                quoteActions.newVersion(deal.id, userName);
                toast.show({ message: `Version ${q.version + 1} created. Earlier versions stay in history.`, tone: "success" });
              }}
            >
              <Copy size={15} aria-hidden="true" /> New version
            </Button>
          ) : null}
          {mayBuild && (q.status === "Draft" || q.status === "Approved") ? (
            <Button variant="primary" onClick={send}>
              <Send size={15} aria-hidden="true" /> {needsApproval(q.discount, q.status, store.discountLimit) ? "Request approval" : "Send quote"}
            </Button>
          ) : null}
        </div>
      </header>

      {waiting ? (
        <Banner
          tone="warning"
          icon={<Clock size={16} />}
          title="Waiting for Management."
          action={mayApprove ? <Button size="sm" variant="primary" onClick={approveHere}>Approve</Button> : undefined}
        >
          A {q.discount}% discount is above the {store.discountLimit}% limit, so this version can’t be sent until it’s approved. You’ll be notified.
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
                {q.lines.length === 0 ? (
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
                        {q.lines.map((l) => {
                          const item = store.catalogue.find((c) => c.id === l.cat);
                          if (!item) return null;
                          const price = l.price ?? item.price;
                          const cost = l.cost ?? item.cost;
                          return (
                            <tr key={l.cat}>
                              <td>
                                <div className="fb-com-strong">{item.name}</div>
                                <div className="fb-com-muted">per {item.unit}</div>
                              </td>
                              <td className="fb-com-num">
                                <input
                                  className="fb-input fb-com-qty"
                                  type="number"
                                  min={0}
                                  value={l.qty}
                                  readOnly={!canEdit}
                                  aria-label={`Quantity for ${item.name}`}
                                  onChange={(e) => quoteActions.setQty(deal.id, l.cat, Number(e.target.value))}
                                />
                              </td>
                              <td className="fb-com-num">{formatKes(price)}</td>
                              {showMargin ? <td className="fb-com-num">{cost ? `${Math.round(((price - cost) / price) * 100)}%` : "—"}</td> : null}
                              <td className="fb-com-num fb-com-strong">{formatKes(price * l.qty)}</td>
                              <td>
                                {canEdit ? (
                                  <IconButton label={`Remove ${item.name}`} onClick={() => quoteActions.removeLine(deal.id, l.cat)}>
                                    <X size={14} aria-hidden="true" />
                                  </IconButton>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEdit ? (
                  <div className="fb-com-add">
                    <Select
                      label="Add a catalogue item"
                      value=""
                      placeholder="+ Add from catalogue…"
                      options={store.catalogue.map((c) => ({ value: c.id, label: `${c.name} · ${formatKes(c.price)}` }))}
                      onChange={(e) => e.target.value && quoteActions.addLine(deal.id, e.target.value)}
                    />
                  </div>
                ) : null}
              </section>

              <section className="fb-com-card fb-com-form">
                <Input
                  label="Discount %"
                  type="number"
                  min={0}
                  max={MAX_DISCOUNT}
                  value={q.discount}
                  readOnly={!canEdit}
                  help={`Above ${store.discountLimit}% goes to Management for approval.`}
                  onChange={(e) => quoteActions.setDiscount(deal.id, Number(e.target.value))}
                />
                <Textarea label="Terms" rows={2} value={q.terms} readOnly={!canEdit} onChange={(e) => quoteActions.setTerms(deal.id, e.target.value)} />
                {locked ? <p className="fb-com-muted">This version is {q.status === "Pending approval" ? "waiting for a decision" : q.status.toLowerCase()} and cannot be changed. Use “New version” to edit.</p> : null}
              </section>
            </>
          ) : (
            <QuoteDocument quote={q} company={deal.company} contact={deal.contact} catalogue={store.catalogue} />
          )}
        </div>

        <aside className="fb-com-side" aria-label="Quote summary">
          <section className="fb-com-card">
            <h2>Summary</h2>
            <dl className="fb-com-sum">
              <div><dt>Subtotal</dt><dd>{formatKes(totals.subtotal)}</dd></div>
              <div><dt>Discount {q.discount}%</dt><dd>−{formatKes(totals.discount)}</dd></div>
              <div className="fb-com-sum__total"><dt>Total</dt><dd>{formatKes(totals.total)}</dd></div>
              {showMargin ? (
                <div><dt>Margin (Management only)</dt><dd className={totals.marginPct < 25 ? "fb-com-bad" : undefined}>{totals.marginPct}%</dd></div>
              ) : null}
            </dl>
            {differs ? (
              <p className="fb-com-note">
                Deal value is {formatKes(dealValue)}.{" "}
                <button type="button" className="fb-com-linkbtn" onClick={() => { setDealValue(deal.id, totals.total); toast.show({ message: "Deal value updated", tone: "success" }); }}>
                  Use the quote total
                </button>
              </p>
            ) : null}
          </section>

          <section className="fb-com-card">
            <div className="fb-com-card__head"><h2>Client signature</h2><span className="fb-com-tag">V2</span></div>
            {signed ? (
              <p className="fb-com-ok"><CheckCircle2 size={16} aria-hidden="true" /> Signed {q.signedAt ? whenLabel(q.signedAt) : ""} by {q.signer}</p>
            ) : (
              <>
                <p className="fb-com-muted">Send a signing link with the quote. The client signs in the browser; nothing to install.</p>
                <Button disabledReason={q.status === "Sent" ? undefined : "Send the quote first"} onClick={() => setSigning(true)}>Preview client signing (demo)</Button>
              </>
            )}
          </section>

          <section className="fb-com-card">
            <div className="fb-com-card__head"><h2>Deposit request</h2><span className="fb-com-tag fb-com-tag--warn">Open decision</span></div>
            <p className="fb-com-muted">
              The MVP excludes payment processing. This sends an M-Pesa / bank request through your payment provider; the CRM only records the status. Needs Michael’s decision before it’s built.
            </p>
            <Button
              disabledReason={!signed ? "Available once the quote is signed" : store.deposit[q.id] ? "Already requested" : undefined}
              onClick={() => { requestDeposit(q.id); toast.show({ message: "Deposit request sent. Finance sees its status.", tone: "success" }); }}
            >
              {store.deposit[q.id] ? "Deposit requested · awaiting payment" : signed ? `Request 50% deposit (${formatKes(Math.round(totals.total / 2))})` : "Available once signed"}
            </Button>
          </section>

          <section className="fb-com-card">
            <h2>Version history</h2>
            <ol className="fb-com-history">
              {[...q.history].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="fb-com-pill fb-com-pill--neutral">v{h.v}</span>
                  <div>
                    <div className="fb-com-strong">{h.note}</div>
                    <div className="fb-com-muted">{h.by} · {whenLabel(h.at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <SignPreviewDialog
        open={signing}
        onClose={() => setSigning(false)}
        quoteNo={q.no}
        total={formatKes(totals.total)}
        defaultName={deal.contact.split(",")[0] ?? ""}
        onSign={(name) => {
          quoteActions.sign(deal.id, name);
          setSigning(false);
          setPreviewing(true);
          toast.show({ message: `Signed. The deal stays in ${deal.stage} until you mark it won.`, tone: "success" });
        }}
      />
    </div>
  );
}
