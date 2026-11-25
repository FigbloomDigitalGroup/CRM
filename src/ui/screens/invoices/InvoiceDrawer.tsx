"use client";

import { useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { Drawer } from "../../components/overlays";
import { Input, Select, Textarea } from "../../components/forms";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { HIcon } from "../home/kit";
import { InvoiceHistory } from "../finance/InvoiceDialog";
import { useRefreshPayments, type InvoiceDetail, type PaymentRecord } from "../finance/data";
import { INVOICE_LABEL, INVOICE_TONE, cents, day, fromCents, kes, type InvoiceStatus } from "../finance/format";

const METHODS = ["M-Pesa", "Bank transfer", "Cheque", "Cash"];
const NEEDS = {
  send: "Sending an invoice needs the permission to send invoices. Ask Finance or Management.",
  edit: "Voiding an invoice needs the permission to edit invoices. Ask Finance or Management.",
  record: "Recording or reversing a payment needs the permission to record payments. Ask Finance or Management.",
};

/** What the person is being asked a reason for: voiding the invoice, or reversing one payment (design QI6). */
type Asking = { kind: "void" } | { kind: "reverse"; paymentId: string; label: string } | null;

/**
 * One invoice in a drawer (UC-R9, FIG-1780, design QI6), opened from a row of the Invoices page. The same behaviour the Payments tracker's
 * dialog has, behind the split keys: sending needs `invoices.send`, voiding `invoices.edit`, recording and reversing a payment
 * `payments.record`. A button the role may not use stays visible and says why. Payments are RECORDED, never processed: nothing here moves
 * money, and no bank or M-Pesa detail is asked for (the method is a label). The API enforces every one of these keys again.
 *
 * Masking (rule 7): payments, balances and the overdue state need `finance.view.payments`. Without it the drawer says so and never asks the API.
 */
export function InvoiceDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { orgSlug, can, timeZone } = useMember();
  const mayFigures = can("finance.view.payments");
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshPayments();
  const q = useApiQuery("getInvoice", { params: { orgSlug, invoiceId } }, { enabled: mayFigures });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [method, setMethod] = useState(METHODS[0]!);
  const [reference, setReference] = useState("");
  const [asking, setAsking] = useState<Asking>(null);
  const [reason, setReason] = useState("");

  const inv = q.data as InvoiceDetail | undefined;
  const status = (inv?.status ?? "DRAFT") as InvoiceStatus;
  const payments = ((inv?.payments ?? []) as unknown as PaymentRecord[]).slice();
  const live = payments.filter((p) => !p.reversed);
  const balance = inv?.balance ?? "0.00";
  const open = status === "SENT" || status === "PART_PAID" || status === "OVERDUE";
  const typed = amount.trim();
  const value = typed || balance;
  const over = cents(value) > cents(balance);
  const part = Boolean(typed) && cents(typed) > 0 && cents(typed) < cents(balance);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.show({ tone: "success", message: done });
      refresh();
      return true;
    } catch (e) {
      setError(describeError(e).body);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const record = async () => {
    if (!(Number(value) > 0)) return setError("Enter the amount received, more than zero.");
    if (over) return setError(`That is more than the balance, ${kes(balance, inv?.currency)}. Record the balance or less.`);
    const ok = await run(
      () =>
        api.call("recordPayment", {
          params: { orgSlug, invoiceId },
          body: { amount: value, ...(paidOn ? { paidOn } : {}), methodLabel: method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
          idempotencyKey: newIdempotencyKey(),
        }),
      part ? `Part payment of ${kes(value, inv?.currency)} recorded on ${inv?.number}.` : `Payment of ${kes(value, inv?.currency)} recorded on ${inv?.number}.`,
    );
    if (ok) {
      setAmount("");
      setPaidOn("");
      setReference("");
    }
  };

  const submitReason = async () => {
    if (!asking || !reason.trim() || !inv) return;
    const ok = await run(
      () =>
        asking.kind === "void"
          ? api.call("voidInvoice", { params: { orgSlug, invoiceId }, body: { reason: reason.trim() } })
          : api.call("reversePayment", { params: { orgSlug, paymentId: asking.paymentId }, body: { reason: reason.trim() } }),
      asking.kind === "void" ? `${inv.number} voided.` : "Payment reversed. The record stays in the history and the balance goes back up.",
    );
    if (ok) {
      setAsking(null);
      setReason("");
    }
  };

  const voidWhy = !can("invoices.edit") ? NEEDS.edit : status === "VOID" ? "Already void." : live.length > 0 ? "Reverse the payments first." : undefined;

  return (
    <Drawer open onClose={onClose} title={inv ? `Invoice ${inv.number}` : "Invoice"}>
      <div className="fb-inv__drawer" data-testid="invoice-drawer">
        {!mayFigures ? (
          <div className="fb-inv__masked" role="status" data-testid="drawer-masked">
            <HIcon name="lock" size={16} />
            <span>Payment details and balances are hidden for your role. They are visible to Finance and Management.</span>
          </div>
        ) : q.isPending ? (
          <div role="status" className="fb-inv__note">Loading the invoice…</div>
        ) : q.isError || !inv ? (
          <div role="alert" className="fb-inv__note">{describeError(q.error).body}</div>
        ) : (
          <>
            <div className="fb-inv__dsum">
              <span className="fb-inv__pill" style={{ background: INVOICE_TONE[status].bg, color: INVOICE_TONE[status].fg }}>{INVOICE_LABEL[status]}</span>
              <span>
                {inv.companyName} · due {day(inv.dueOn, timeZone)}
                {inv.overdue ? ` · ${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue` : ""}
              </span>
            </div>
            {status === "VOID" ? (
              <div role="status" className="fb-inv__void"><HIcon name="alert" size={16} /><span><strong>Void.</strong> {String((inv as { voidReason?: string | null }).voidReason ?? "")}</span></div>
            ) : null}

            <div className="fb-inv__dactions">
              {status === "DRAFT" ? (
                <Button
                  variant="primary"
                  loading={busy}
                  disabledReason={can("invoices.send") ? undefined : NEEDS.send}
                  onClick={() => void run(() => api.call("markInvoiceSent", { params: { orgSlug, invoiceId } }), `${inv.number} marked as sent.`)}
                >
                  Mark as sent
                </Button>
              ) : null}
              {status !== "VOID" ? (
                <Button variant="secondary" disabledReason={voidWhy} onClick={() => { setAsking({ kind: "void" }); setReason(""); }}>
                  Void invoice
                </Button>
              ) : null}
            </div>
            {status === "DRAFT" ? <p className="fb-inv__help">Marking as sent records that the invoice went to the customer. The email itself is sent from your accounting system.</p> : null}

            <dl className="fb-inv__facts">
              <div><dt>Amount</dt><dd>{kes(inv.amount, inv.currency)}</dd></div>
              <div><dt>Received</dt><dd>{kes(inv.paidAmount, inv.currency)}</dd></div>
              <div><dt>Balance</dt><dd data-late={inv.overdue ? "true" : undefined}>{status === "VOID" ? "—" : kes(inv.balance, inv.currency)}</dd></div>
            </dl>
            {Number(inv.overpaid) > 0 ? <p className="fb-inv__help">Paid {kes(inv.overpaid, inv.currency)} more than the invoice (overpayment was allowed).</p> : null}

            <section className="fb-inv__payments" aria-label="Payments">
              <div className="fb-inv__paymentshead"><strong>Payments</strong><span>Recorded only. Nothing is processed here.</span></div>
              {payments.length === 0 ? (
                <p className="fb-inv__note">No payments recorded yet.</p>
              ) : (
                <ul className="fb-inv__plist">
                  {payments.map((p) => (
                    <li key={p.id} data-reversed={p.reversed ? "true" : undefined}>
                      <div>
                        <div className="fb-inv__pamt">{kes(p.amount, inv.currency)}{p.methodLabel ? ` · ${p.methodLabel}` : ""}</div>
                        <div className="fb-inv__pmeta">
                          {day(p.paidOn, timeZone)}
                          {p.reference ? ` · ref ${p.reference}` : ""}
                          {p.reversed ? ` · Reversed${p.reversalReason ? `: ${p.reversalReason}` : ""}` : ""}
                        </div>
                      </div>
                      {!p.reversed && status !== "VOID" ? (
                        <Button
                          size="sm"
                          aria-label={`Reverse payment of ${kes(p.amount, inv.currency)}`}
                          disabledReason={can("payments.record") ? undefined : NEEDS.record}
                          onClick={() => { setAsking({ kind: "reverse", paymentId: p.id, label: kes(p.amount, inv.currency) }); setReason(""); }}
                        >
                          Reverse
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {open ? (
                can("payments.record") ? (
                  <form className="fb-inv__form" onSubmit={(e) => { e.preventDefault(); void record(); }}>
                    <Input label="Amount received" inputMode="decimal" placeholder={balance} value={amount} onChange={(e) => setAmount(e.target.value)} help={`Leave empty to record the full balance, ${kes(balance, inv.currency)}.`} />
                    <Select label="How it was paid (a label only)" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => ({ value: m, label: m }))} help="Never enter account or M-Pesa details." />
                    <Input label="Date received" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                    <Input label="Reference from your accounts" value={reference} onChange={(e) => setReference(e.target.value)} />
                    {over ? <p className="fb-inv__warn" role="status">That is more than the balance ({kes(balance, inv.currency)}). Record the balance or less.</p> : null}
                    {part ? <p className="fb-inv__warn" role="status">Part payment: {kes(fromCents(cents(balance) - cents(typed)), inv.currency)} will remain.</p> : null}
                    <Button type="submit" variant="primary" loading={busy} disabledReason={over ? "More than the balance" : undefined}>
                      {part ? "Record part payment" : "Record payment"}
                    </Button>
                  </form>
                ) : (
                  <p className="fb-inv__note">{NEEDS.record}</p>
                )
              ) : null}
            </section>

            {asking ? (
              <section className="fb-inv__reason" aria-label={asking.kind === "void" ? "Void invoice" : "Reverse payment"}>
                <strong>{asking.kind === "void" ? `Void ${inv.number}?` : `Reverse the payment of ${asking.label}?`}</strong>
                <p className="fb-inv__help">
                  {asking.kind === "void"
                    ? "The invoice stays on record marked Void and cannot be sent or paid. Create a new invoice if it needs reissuing."
                    : "The payment stays in the history, struck through. The balance goes back up."}
                </p>
                <Textarea label="Reason (required, kept in the audit log)" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="fb-inv__reasonbtns">
                  <Button variant="secondary" onClick={() => setAsking(null)}>Cancel</Button>
                  <Button variant="danger" loading={busy} disabledReason={reason.trim() ? undefined : "Say why first"} onClick={() => void submitReason()}>
                    {asking.kind === "void" ? "Void invoice" : "Reverse payment"}
                  </Button>
                </div>
              </section>
            ) : null}

            {can("audit.view") ? <InvoiceHistory invoiceId={invoiceId} /> : <p className="fb-inv__note">The audit history of an invoice is read by Management.</p>}
            {error ? <div role="alert" className="fb-inv__error">{error}</div> : null}
          </>
        )}
      </div>
    </Drawer>
  );
}
