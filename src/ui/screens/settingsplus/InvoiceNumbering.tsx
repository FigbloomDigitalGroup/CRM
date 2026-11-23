"use client";

import { useState } from "react";
import { LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useQuoteSettings, useSaveQuoteSettings } from "../commercial/api";
import { Switch } from "../settings/kit";
import { EditorFrame, recordAudit } from "./kit";
import { DEFAULT_INVOICE_NUMBERING, INVOICE_PREFIX_MAX, cleanInvoicePrefix, formatInvoiceNumber, type InvoiceNumbering } from "@/lib/invoiceNumbering";

/**
 * Invoice numbering (UC-R8) on `GET/PATCH /quote-settings` (`invoiceNumbering`): whether a new invoice with no typed number gets the next number
 * automatically, and the prefix it starts with. Management only (`configuration.manage`). A number typed by hand is always used as typed, and
 * numbers already given never change. Same editor frame as Quote tax.
 */
export function InvoiceNumberingEditor() {
  const { userName, can, orgSlug } = useMember();
  const toast = useToast();
  const q = useQuoteSettings(orgSlug);
  const save = useSaveQuoteSettings();
  const [draft, setDraft] = useState<InvoiceNumbering | null>(null);
  if (q.isLoading) return <LoadingState label="Loading invoice numbering" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Invoice numbering" onRetry={() => void q.refetch()} />;

  const saved = q.data.invoiceNumbering ?? DEFAULT_INVOICE_NUMBERING;
  const d = draft ?? saved;
  const dirty = d.auto !== saved.auto || d.prefix.trim() !== saved.prefix;
  const mayEdit = can("configuration.manage");
  const errors = cleanInvoicePrefix(d.prefix) === null ? [`The prefix is 1 to ${INVOICE_PREFIX_MAX} characters: letters, digits and - _ . / only.`] : [];
  const example = formatInvoiceNumber(cleanInvoicePrefix(d.prefix) ?? "INV-", 1);
  const impact = dirty ? [d.auto ? `New invoices with no typed number will be numbered ${example}, then the next number after the highest one already used.` : "New invoices will need a number typed by hand.", "Invoices that already exist keep their numbers."] : [];

  async function onSave() {
    try {
      await save.mutateAsync({ params: { orgSlug }, body: { invoiceNumbering: { auto: d.auto, prefix: d.prefix.trim() } } as never });
      recordAudit("InvoiceNumbering", "Invoice numbering changed", impact[0] ?? "No change", userName);
      setDraft(null);
    } catch (err) {
      toast.show({ message: describeError(err).body, tone: "danger" });
      return false;
    }
  }

  return (
    <EditorFrame
      area="InvoiceNumbering"
      title="Invoice numbering"
      description="Whether new invoices are numbered for you, and how the number starts."
      release="v1.1"
      dirty={dirty}
      errors={errors}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management changes invoice numbering"}
      onDiscard={() => setDraft(null)}
      onSave={() => onSave()}
    >
      <div className="fb-sp-rule">
        <Switch checked={d.auto} label="Number new invoices automatically" disabled={!mayEdit} onChange={(auto) => setDraft({ ...d, auto })} />
        <div className="fb-sp-rule__main">
          <div className="fb-set-muted">Off means every invoice needs a number typed by hand, as today. A number typed on an invoice is always used as typed.</div>
        </div>
      </div>
      <div className="fb-sp-rule">
        <label className="fb-sp-rule__n">
          <span className="fb-set-muted">Prefix</span>
          <input className="fb-input" type="text" maxLength={INVOICE_PREFIX_MAX} value={d.prefix} readOnly={!mayEdit} aria-label="Invoice number prefix" onChange={(e) => setDraft({ ...d, prefix: e.target.value })} />
          <span className="fb-set-muted">Next: {example}</span>
        </label>
      </div>
    </EditorFrame>
  );
}
