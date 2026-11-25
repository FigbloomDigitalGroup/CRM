"use client";

import { Building2 } from "lucide-react";
import { useRef, useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { Input, Select, Textarea } from "../../components/forms";
import { Dialog } from "../../components/overlays";
import { LoadingState } from "../../components/states";
import { useToast } from "../../components/toast";
import { newIdempotencyKey } from "../../data/client";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useRefreshPayments } from "../finance/data";
import { TERMS_CHOICES, applyChange, newDraft, toBody, validateDraft } from "./newInvoiceModel";

export interface InvoiceTarget {
  companyId: string;
  companyName: string;
  /** Set when the invoice starts from a won deal. */
  dealId?: string;
  /** The deal's value, only when the API did not mask it; a starting amount the person can change. */
  amount?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Create invoice (UC-R8, FIG-1779): for a customer, optionally linked to one of its won deals, or straight from a won deal (`from`). One amount for
 * now; line items arrive in UC-B1. The number may be left empty: with auto-numbering on in Settings the API gives the next one, otherwise it asks for one.
 * The due date is suggested from the issue date and the payment terms and can be changed; the API still receives `dueOn`.
 *
 * The create carries one idempotency key for the life of this dialog, so a second click or a retry after a lost answer never makes a second invoice.
 * The API refuses a deal that is not won (`DEAL_NOT_WON`) and any role without `invoices.create`. Nothing is processed: this only records an invoice.
 */
export function NewInvoiceDialog({ from, onClose, onCreated }: { from?: InvoiceTarget; onClose: () => void; onCreated?: (id: string) => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshPayments();
  const key = useRef(newIdempotencyKey());
  const [company, setCompany] = useState<{ id: string; name: string } | null>(from ? { id: from.companyId, name: from.companyName } : null);
  const [dealId, setDealId] = useState<string>(from?.dealId ?? "");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(() => newDraft(today(), from?.amount ?? ""));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => applyChange(d, patch));

  const customers = useApiQuery("getCompanies", { params: { orgSlug }, query: { pageSize: "8", sort: "name", ...(text.trim() ? { q: text.trim() } : {}) } }, { enabled: !company, placeholderData: (prev) => prev });
  const wonDeals = useApiQuery("getDeals", { params: { orgSlug }, query: { companyId: company?.id ?? "", outcome: "WON", pageSize: "50" } }, { enabled: !!company && !from?.dealId, retry: false });
  const customerList = (customers.data?.items ?? []) as unknown as { id: string; name: string }[];
  const dealList = (wonDeals.data?.items ?? []) as unknown as { id: string; notes?: string | null; service?: { name?: string } | null }[];

  async function submit() {
    const found = validateDraft(draft, true, Boolean(company));
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0 || !company) return;
    setBusy(true);
    try {
      const created = (await api.call("createInvoice", {
        params: { orgSlug },
        body: toBody(draft, { companyId: company.id, dealId: dealId || undefined }) as never,
        idempotencyKey: key.current,
      })) as unknown as { id: string; number: string };
      refresh();
      toast.show({ message: `Invoice ${created.number} created as a draft.`, tone: "success" });
      onCreated?.(created.id);
      onClose();
    } catch (err) {
      const d = describeError(err);
      setFailure(d.kind === "noAccess" ? "Your role cannot create invoices. Ask Finance or Management." : d.body);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New invoice"
      dismissible={!busy}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? "Creating…" : "Create invoice"}</Button>
        </>
      }
    >
      <div className="fb-newinv">
        {failure ? <p role="alert" className="fb-newinv__fail">{failure}</p> : null}
        {!company ? (
          <div className="fb-newinv__pick">
            <Input label="Customer" required type="search" placeholder="Search customers" value={text} onChange={(e) => setText(e.target.value)} error={errors.customer} autoFocus />
            {customers.isLoading ? <LoadingState label="Loading customers" /> : null}
            {customers.isError ? <p role="alert" className="fb-newinv__fail">Customers could not be loaded. Try again in a moment.</p> : null}
            {!customers.isLoading && !customers.isError && customerList.length === 0 ? <p className="fb-newinv__muted">{text ? "No customer matches." : "No customers yet. Add one under Customers first."}</p> : null}
            <ul className="fb-newinv__list">
              {customerList.map((c) => (
                <li key={c.id}>
                  <button type="button" className="fb-newinv__row" onClick={() => setCompany(c)}>
                    <Building2 size={16} aria-hidden="true" />
                    <span>{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="fb-newinv__who">
            <span className="fb-newinv__muted">For</span> <strong>{company.name}</strong>
            {!from ? <button type="button" className="fb-newinv__change" onClick={() => (setCompany(null), setDealId(""))}>Change</button> : null}
          </div>
        )}

        {company && !from?.dealId ? (
          wonDeals.isError ? (
            <p className="fb-newinv__muted">Won deals could not be loaded, so this invoice will not be linked to a deal.</p>
          ) : dealList.length > 0 ? (
            <Select
              label="Won deal (optional)"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              placeholder="Not linked to a deal"
              options={dealList.map((d) => ({ value: d.id, label: (d.notes ?? "").split(/\r?\n/)[0]!.trim() || d.service?.name || "Won deal" }))}
              help="Only a won deal can be invoiced."
            />
          ) : null
        ) : null}

        <Input label="Invoice number" value={draft.number} onChange={(e) => set({ number: e.target.value })} error={errors.number} help="Leave empty for the next automatic number, if automatic numbering is on in Settings. A number you type is used as it is." maxLength={60} />
        <Input label="Amount (KES)" required inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} error={errors.amount} />
        <div className="fb-newinv__two">
          <Input label="Issue date" required type="date" value={draft.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} error={errors.issuedOn} />
          <Select label="Payment terms" value={draft.termsDays} onChange={(e) => set({ termsDays: e.target.value })} options={TERMS_CHOICES} />
        </div>
        <Input label="Due date" required type="date" value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} error={errors.dueOn} />
        <Textarea label="Terms shown on the invoice (optional)" rows={3} value={draft.terms} onChange={(e) => set({ terms: e.target.value })} error={errors.terms} maxLength={2000} />
      </div>
    </Dialog>
  );
}
