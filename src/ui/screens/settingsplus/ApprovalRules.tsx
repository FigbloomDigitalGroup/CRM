"use client";

import { useState } from "react";
import { useMember } from "@/ui";
import { MAX_DISCOUNT } from "../commercial/quoteMath";
import { setDiscountLimit } from "../commercial/demo/store";
import { Switch } from "../settings/kit";
import { approvalRules as seed } from "./demo/data";
import { EditorFrame, recordAudit } from "./kit";
import { ruleImpact, validateRules, type ApprovalRule } from "./model";

/**
 * Approval rules (S6#2, FIG-1174): when something needs a Management decision before it happens. The discount threshold here is the one the quote
 * builder uses. Rules only make a request wait for a person; they never approve anything themselves (hard rule 9).
 */
export function ApprovalRulesEditor() {
  const { userName, can } = useMember();
  const [saved, setSaved] = useState<ApprovalRule[]>(seed);
  const [rules, setRules] = useState<ApprovalRule[]>(seed);
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  const mayEdit = can("configuration.manage");
  const patch = (key: ApprovalRule["key"], p: Partial<ApprovalRule>) => setRules(rules.map((r) => (r.key === key ? { ...r, ...p } : r)));

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
      onDiscard={() => setRules(saved)}
      onSave={() => {
        const d = rules.find((r) => r.key === "discount")!;
        setDiscountLimit(d.on ? d.threshold : MAX_DISCOUNT);
        recordAudit("ApprovalRules", "Approval rules changed", ruleImpact(saved, rules).join(" "), userName);
        setSaved(rules);
      }}
    >
      {rules.map((r) => (
        <div key={r.key} className="fb-sp-rule">
          <Switch checked={r.on} label={r.label} disabled={!mayEdit || r.key === "deletion"} disabledReason={r.key === "deletion" ? "Deleting a person’s data always needs a decision" : undefined} onChange={(on) => patch(r.key, { on })} />
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
