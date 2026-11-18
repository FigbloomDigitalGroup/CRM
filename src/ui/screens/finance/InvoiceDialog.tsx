"use client";

import { useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { Dialog } from "../../components/overlays";
import { Input, Textarea } from "../../components/forms";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { useRefreshPayments, type InvoiceDetail, type PaymentRecord } from "./data";
import { INVOICE_LABEL, INVOICE_TONE, cents, day, kes, type InvoiceStatus } from "./format";

/**
 * One invoice, with its payments (F3.06). Finance and Management record money received, reverse a mistake with a reason, mark a draft sent or
 * void an invoice. Nothing is processed and no bank detail is stored: this is the status of what the accounting system already did.
 */
export function InvoiceDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { orgSlug, can, timeZone } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshPayments();
  const q = useApiQuery("getInvoice", { params: { orgSlug, invoiceId } });
  const canManage = can("finance.manage.payments");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const inv = q.data as InvoiceDetail | undefined;
  const status = (inv?.status ?? "DRAFT") as InvoiceStatus;
  const payments = ((inv?.payments ?? []) as unknown as PaymentRecord[]).slice();
  const live = payments.filter((p) => !p.reversed);
  const balance = inv?.balance ?? "0.00";
  const canReceive = canManage && inv && (status === "SENT" || status === "PART_PAID" || status === "OVERDUE");

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.show({ tone: "success", message: done });
      refresh();
      return true;
    } catch (e) {
      const d = describeError(e);
      setError(d.body);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const record = async () => {
    const value = amount.trim() || balance;
    if (!(Number(value) > 0)) {
      setError("Enter the amount received, more than zero.");
      return;
    }
    const ok = await run(
      () =>
        api.call("recordPayment", {
          params: { orgSlug, invoiceId },
          body: { amount: value, ...(paidOn ? { paidOn } : {}), ...(method.trim() ? { methodLabel: method.trim() } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) },
          idempotencyKey: newIdempotencyKey(),
        }),
      `Payment of ${kes(value, inv?.currency)} recorded on ${inv?.number}.`,
    );
    if (ok) {
      setAmount("");
      setPaidOn("");
      setMethod("");
      setReference("");
    }
  };

  const title = inv ? `Invoice ${inv.number}` : "Invoice";
  return (
    <Dialog open onClose={onClose} title={title} actions={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.isPending ? (
        <div role="status" className="fb-pay__dlgnote">Loading the invoice…</div>
      ) : q.isError || !inv ? (
        <div role="alert" className="fb-pay__dlgnote">{describeError(q.error).body}</div>
      ) : (
        <div className="fb-pay__dlg">
          <div className="fb-pay__dlgsum">
            <span className="fb-pay__pill" style={{ background: INVOICE_TONE[status].bg, color: INVOICE_TONE[status].fg }}>{INVOICE_LABEL[status]}</span>
            <span>
              {inv.companyName} · due {day(inv.dueOn, timeZone)}
              {inv.overdue ? ` · ${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue` : ""}
            </span>
          </div>
          <dl className="fb-pay__facts">
            <div><dt>Amount</dt><dd>{kes(inv.amount, inv.currency)}</dd></div>
            <div><dt>Received</dt><dd>{kes(inv.paidAmount, inv.currency)}</dd></div>
            <div><dt>Balance</dt><dd data-alert={inv.overdue ? "true" : undefined}>{kes(inv.balance, inv.currency)}</dd></div>
          </dl>
          {Number(inv.overpaid) > 0 ? <p className="fb-pay__dlgnote">Paid {kes(inv.overpaid, inv.currency)} more than the invoice (overpayment was allowed).</p> : null}

          <h3 className="fb-pay__dlgh">Payments received</h3>
          {payments.length === 0 ? (
            <p className="fb-pay__dlgnote">No payment recorded yet.</p>
          ) : (
            <ul className="fb-pay__plist">
              {payments.map((p) => (
                <li key={p.id} data-reversed={p.reversed ? "true" : undefined}>
                  <div>
                    <strong>{kes(p.amount, inv.currency)}</strong> · {day(p.paidOn, timeZone)}
                    {p.methodLabel ? ` · ${p.methodLabel}` : ""}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.reversed ? <span className="fb-pay__rev"> Reversed{p.reversalReason ? `: ${p.reversalReason}` : ""}</span> : null}
                  </div>
                  {canManage && !p.reversed ? (
                    reversing === p.id ? (
                      <div className="fb-pay__inline">
                        <Input label="Why is it reversed?" required value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          disabledReason={reason.trim() ? undefined : "Say why first"}
                          onClick={async () => {
                            if (await run(() => api.call("reversePayment", { params: { orgSlug, paymentId: p.id }, body: { reason: reason.trim() } }), "Payment reversed. The record stays in the history.")) {
                              setReversing(null);
                              setReason("");
                            }
                          }}
                        >
                          Reverse payment
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setReversing(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setReversing(p.id)}>Reverse</Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canReceive ? (
            <form
              className="fb-pay__form"
              onSubmit={(e) => {
                e.preventDefault();
                void record();
              }}
            >
              <h3 className="fb-pay__dlgh">Record a payment</h3>
              <div className="fb-pay__grid2">
                <Input label="Amount received" inputMode="decimal" placeholder={balance} value={amount} onChange={(e) => setAmount(e.target.value)} help={`Leave empty to record the full balance, ${kes(balance, inv.currency)}.`} />
                <Input label="Date received" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                <Input label="How it was paid (a label only)" value={method} onChange={(e) => setMethod(e.target.value)} help="For example Bank transfer. Never enter account or M-Pesa details." />
                <Input label="Reference from your accounts" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <Button type="submit" variant="primary" loading={busy}>
                {amount.trim() && cents(amount) < cents(balance) ? "Record payment" : "Record full payment"}
              </Button>
            </form>
          ) : null}

          {canManage && status === "DRAFT" ? (
            <Button variant="primary" loading={busy} onClick={() => void run(() => api.call("markInvoiceSent", { params: { orgSlug, invoiceId } }), `${inv.number} marked sent.`)}>
              Mark as sent
            </Button>
          ) : null}

          {canManage && status !== "VOID" && status !== "PAID" && live.length === 0 ? (
            voiding ? (
              <div className="fb-pay__inline">
                <Textarea label="Why is this invoice void?" required rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  disabledReason={voidReason.trim() ? undefined : "Say why first"}
                  onClick={async () => {
                    if (await run(() => api.call("voidInvoice", { params: { orgSlug, invoiceId }, body: { reason: voidReason.trim() } }), `${inv.number} voided.`)) setVoiding(false);
                  }}
                >
                  Void invoice
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setVoiding(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setVoiding(true)}>Void this invoice…</Button>
            )
          ) : null}

          {can("audit.view") ? <InvoiceHistory invoiceId={invoiceId} /> : <p className="fb-pay__dlgnote">The audit history of an invoice is read by Management.</p>}
          {error ? <div role="alert" className="fb-pay__error">{error}</div> : null}
        </div>
      )}
    </Dialog>
  );
}

/** The invoice's audit trail: who did what and when. Management only (`audit.view`); the API hides payment entities from everyone else. */
function InvoiceHistory({ invoiceId }: { invoiceId: string }) {
  const { orgSlug, timeZone } = useMember();
  const q = useApiQuery("listAuditLog", { params: { orgSlug }, query: { entityType: "Invoice", entityId: invoiceId, pageSize: "20" } });
  const items = (q.data?.items ?? []) as { id?: string; action?: string; createdAt?: string; actorName?: string | null }[];
  return (
    <section aria-label="Audit trail">
      <h3 className="fb-pay__dlgh">Audit trail</h3>
      {q.isPending ? (
        <p className="fb-pay__dlgnote" role="status">Loading the history…</p>
      ) : q.isError ? (
        <p className="fb-pay__dlgnote">{describeError(q.error).body}</p>
      ) : items.length === 0 ? (
        <p className="fb-pay__dlgnote">No changes recorded.</p>
      ) : (
        <ol className="fb-pay__audit">
          {items.map((e, i) => (
            <li key={e.id ?? i}>
              <span className="fb-pay__auditwhat">{(e.action ?? "").replace(/[._]/g, " ")}</span>
              <span className="fb-pay__auditwho">
                {e.actorName ?? "A team member"} · {e.createdAt ? new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timeZone ?? "UTC" }) : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
