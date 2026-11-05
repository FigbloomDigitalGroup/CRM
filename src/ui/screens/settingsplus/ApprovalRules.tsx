"use client";

import { useState } from "react";
import { LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useApprovalRules, useSaveApprovalRules, type ApprovalRulesView } from "../commercial/api";
import { Switch } from "../settings/kit";
import { EditorFrame, recordAudit } from "./kit";
import { ruleImpact, validateRules, type ApprovalRule } from "./model";

/** The most a quote discount may ever be (the API refuses more), so a threshold above it could never trigger. */
const MAX_DISCOUNT = 30;

/**
 * Approval rules (S6#2, FIG-1174) on `GET/PATCH /approval-rules`: when something needs a Management decision before it happens. The discount
 * threshold is the one the quote API checks. Rules only make a request wait for a person; they never approve anything (hard rule 9).
 */
function toRules(r: ApprovalRulesView): ApprovalRule[] {
  return [
    { key: "discount", label: "Discount on a quote above", unit: "%", on: r.discount.enabled, threshold: r.discount.thresholdPercent },
    { key: "export", label: "CSV export larger than", unit: "rows", on: r.export.enabled, threshold: r.export.thresholdRows },
    { key: "deal", label: "Marking won a deal worth more than", unit: r.largeDeal.currency, on: r.largeDeal.enabled, threshold: r.largeDeal.thresholdAmount },
    { key: "deletion", label: "Permanent deletion of a contact (data-protection request)", unit: "any", on: true, threshold: 0 },
  ];
}

export function ApprovalRulesEditor() {
  const { userName, can, orgSlug } = useMember();
  const toast = useToast();
  const q = useApprovalRules(orgSlug);
  const save = useSaveApprovalRules();
  const [draft, setDraft] = useState<ApprovalRule[] | null>(null);
  if (q.isLoading) return <LoadingState label="Loading approval rules" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Approval rules" onRetry={() => void q.refetch()} />;

  const saved = toRules(q.data);
  const rules = draft ?? saved;
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  const mayEdit = can("configuration.manage");
  const patch = (key: ApprovalRule["key"], p: Partial<ApprovalRule>) => setDraft(rules.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function onSave() {
    const d = rules.find((r) => r.key === "discount")!;
    const e = rules.find((r) => r.key === "export")!;
    const l = rules.find((r) => r.key === "deal")!;
    try {
      await save.mutateAsync({
        params: { orgSlug },
        body: { discount: { enabled: d.on, thresholdPercent: d.threshold }, export: { thresholdRows: e.threshold }, largeDeal: { enabled: l.on, thresholdAmount: l.threshold } },
      });
      recordAudit("ApprovalRules", "Approval rules changed", ruleImpact(saved, rules).join(" "), userName);
      setDraft(null);
    } catch (err) {
      toast.show({ message: describeError(err).body, tone: "danger" });
    }
  }

  return (
    <EditorFrame
      area="ApprovalRules"
      title="Approval rules"
      description="When something needs a Management decision before it happens."
      release="v1.1"
      dirty={dirty}
      errors={validateRules(rules, MAX_DISCOUNT)}
      impact={ruleImpact(saved, rules)}
      disabledReason={mayEdit ? undefined : "Only Management changes approval rules"}
      onDiscard={() => setDraft(null)}
      onSave={() => void onSave()}
    >
      {rules.map((r) => (
        <div key={r.key} className="fb-sp-rule">
          <Switch
            checked={r.on}
            label={r.label}
            disabled={!mayEdit || r.key === "deletion" || r.key === "export"}
            disabledReason={r.key === "deletion" ? "Deleting a person’s data always needs a decision" : r.key === "export" ? "Large exports always need a decision; change the size below" : undefined}
            onChange={(on) => patch(r.key, { on })}
          />
          <div className="fb-sp-rule__main">
            <div className="fb-com-strong">{r.label}</div>
            <div className="fb-set-muted">Approver: Management</div>
          </div>
          <label className="fb-sp-rule__n">
            <span className="fb-set-muted">Threshold</span>
            {r.key === "deletion" ? <span>any</span> : <input className="fb-input fb-com-targetinput" type="number" min={1} value={r.threshold} readOnly={!mayEdit} aria-label={`Threshold for ${r.label}`} onChange={(e) => patch(r.key, { threshold: Number(e.target.value) })} />}
            <span className="fb-set-muted">{r.key === "deletion" ? "" : r.unit}</span>
          </label>
        </div>
      ))}
    </EditorFrame>
  );
}
