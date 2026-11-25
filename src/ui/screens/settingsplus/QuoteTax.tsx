"use client";

import { useState } from "react";
import { LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useQuoteSettings, useSaveQuoteSettings } from "../commercial/api";
import { Switch } from "../settings/kit";
import { EditorFrame, recordAudit } from "./kit";
import { MAX_TAX_LABEL, taxImpact, toDraft, toTaxBody, validateTax, type TaxDraft } from "./quoteTaxModel";

/**
 * Quote tax (UC-R5) on `GET/PATCH /quote-settings` (`tax`): whether NEW quotes show a tax line, whether prices already contain the tax or the tax is
 * added on top, the rate and the name. Management only (`configuration.manage`, the key that already guards the quote settings). Quotes that exist
 * never change when this does. Built from the same pieces as the Approval rules editor; a designer should review the layout (CrmBilling frames).
 */
export function QuoteTaxEditor() {
  const { userName, can, orgSlug } = useMember();
  const toast = useToast();
  const q = useQuoteSettings(orgSlug);
  const save = useSaveQuoteSettings();
  const [draft, setDraft] = useState<TaxDraft | null>(null);
  if (q.isLoading) return <LoadingState label="Loading quote tax" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Quote tax" onRetry={() => void q.refetch()} />;

  const saved = toDraft(q.data.tax);
  const d = draft ?? saved;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const mayEdit = can("configuration.manage");
  const patch = (p: Partial<TaxDraft>) => setDraft({ ...d, ...p });

  async function onSave() {
    try {
      await save.mutateAsync({ params: { orgSlug }, body: { tax: toTaxBody(d) } });
      recordAudit("QuoteTax", "Quote tax changed", taxImpact(saved, d)[0] ?? "No change", userName);
      setDraft(null);
    } catch (err) {
      toast.show({ message: describeError(err).body, tone: "danger" });
      return false;
    }
  }

  return (
    <EditorFrame
      area="QuoteTax"
      title="Quote tax"
      description="Whether new quotes show a tax line, and how it is worked out."
      release="v1.1"
      dirty={dirty}
      errors={validateTax(d)}
      impact={taxImpact(saved, d)}
      disabledReason={mayEdit ? undefined : "Only Management changes quote tax"}
      onDiscard={() => setDraft(null)}
      onSave={() => onSave()}
    >
      <div className="fb-sp-rule">
        <Switch checked={d.on} label="Show tax on new quotes" disabled={!mayEdit} onChange={(on) => patch({ on })} />
        <div className="fb-sp-rule__main">
          <div className="fb-set-muted">Off keeps every new quote as it is today: prices include VAT, with no tax line.</div>
        </div>
      </div>
      {d.on ? (
        <>
          <div className="fb-sp-rule">
            <label className="fb-sp-rule__n">
              <span className="fb-set-muted">Prices</span>
              <select className="fb-input" value={d.mode} disabled={!mayEdit} aria-label="How prices relate to tax" onChange={(e) => patch({ mode: e.target.value === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE" })}>
                <option value="INCLUSIVE">Include the tax</option>
                <option value="EXCLUSIVE">Do not include the tax (it is added to the total)</option>
              </select>
            </label>
          </div>
          <div className="fb-sp-rule">
            <label className="fb-sp-rule__n">
              <span className="fb-set-muted">Rate</span>
              <input className="fb-input fb-com-targetinput" type="number" min={0.01} max={100} step={0.01} value={Number.isFinite(d.ratePct) ? d.ratePct : ""} readOnly={!mayEdit} aria-label="Tax rate in percent" onChange={(e) => patch({ ratePct: e.target.value === "" ? Number.NaN : Number(e.target.value) })} />
              <span className="fb-set-muted">%</span>
            </label>
            <label className="fb-sp-rule__n">
              <span className="fb-set-muted">Name</span>
              <input className="fb-input" type="text" maxLength={MAX_TAX_LABEL} value={d.label} readOnly={!mayEdit} aria-label="Tax name" onChange={(e) => patch({ label: e.target.value })} />
            </label>
          </div>
        </>
      ) : null}
    </EditorFrame>
  );
}
