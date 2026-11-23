"use client";

import { useState } from "react";
import { LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useQuoteSettings, useSaveQuoteSettings } from "../commercial/api";
import { Switch } from "../settings/kit";
import { EditorFrame, recordAudit } from "./kit";

/**
 * Sales draft invoices (UC-R10) on `GET/PATCH /quote-settings` (`salesDraftInvoices`). Off by default. When on, Sales can create a DRAFT invoice
 * from a won deal they own and see its number, amount, due date and status. Finance still sends it and records the payments; Sales never sees
 * payments, balances or overdue state. Management only (`configuration.manage`). Same editor frame as Invoice numbering.
 */
export function SalesDraftInvoicesEditor() {
  const { userName, can, orgSlug } = useMember();
  const toast = useToast();
  const q = useQuoteSettings(orgSlug);
  const save = useSaveQuoteSettings();
  const [draft, setDraft] = useState<boolean | null>(null);
  if (q.isLoading) return <LoadingState label="Loading Sales draft invoices" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Sales draft invoices" onRetry={() => void q.refetch()} />;

  const saved = q.data.salesDraftInvoices === true;
  const on = draft ?? saved;
  const dirty = on !== saved;
  const mayEdit = can("configuration.manage");
  const impact = dirty
    ? [on ? "Sales can create draft invoices from their own won deals, and see the number, amount, due date and status of those drafts." : "Sales can no longer create or see invoices. Drafts they already made stay with Finance.", "Sales never sees payments, balances or overdue state, and cannot send an invoice."]
    : [];

  async function onSave() {
    try {
      await save.mutateAsync({ params: { orgSlug }, body: { salesDraftInvoices: on } as never });
      recordAudit("SalesDraftInvoices", "Sales draft invoices changed", impact[0] ?? "No change", userName);
      setDraft(null);
    } catch (err) {
      toast.show({ message: describeError(err).body, tone: "danger" });
      return false;
    }
  }

  return (
    <EditorFrame
      area="SalesDraftInvoices"
      title="Sales draft invoices"
      description="Whether Sales can start a draft invoice for a deal they won. Finance sends it and chases the payment."
      release="v1.1"
      dirty={dirty}
      errors={[]}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management changes this setting"}
      onDiscard={() => setDraft(null)}
      onSave={() => onSave()}
    >
      <div className="fb-sp-rule">
        <Switch checked={on} label="Let Sales create draft invoices" disabled={!mayEdit} onChange={(v) => setDraft(v)} />
        <div className="fb-sp-rule__main">
          <div className="fb-set-muted">Off by default. Sales sees only the drafts of their own won deals: number, amount, due date and status. Payments stay with Finance and Management.</div>
        </div>
      </div>
    </EditorFrame>
  );
}
