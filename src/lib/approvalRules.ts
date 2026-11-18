/**
 * The approval rules an organisation can switch on (FIG-1145, B6.13): pure types, defaults and checks. A rule only decides
 * that an action must WAIT for a person; it never approves anything (hard rule 9). Stored by `approvalRuleService.ts`.
 */

export const APPROVAL_KINDS = ["DISCOUNT", "EXPORT", "DELETION", "LARGE_DEAL"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const KIND_LABEL: Record<ApprovalKind, string> = {
  DISCOUNT: "Discount",
  EXPORT: "Export",
  DELETION: "Deletion",
  LARGE_DEAL: "Large deal",
};

export interface ApprovalRuleSettings {
  /** A quote with a discount above this percentage needs approval to be sent. */
  discount: { enabled: boolean; thresholdPercent: number };
  /** An export of more rows than this needs approval (managed with the export rights, B4.05; mirrored here for the inbox). */
  export: { enabled: boolean; thresholdRows: number };
  /** Marking a deal worth more than this as won needs approval. */
  largeDeal: { enabled: boolean; thresholdAmount: number; currency: string };
  /** Permanent deletion of a contact needs approval. */
  deletion: { enabled: boolean };
}

export const DEFAULT_APPROVAL_RULES: ApprovalRuleSettings = {
  discount: { enabled: true, thresholdPercent: 5 },
  export: { enabled: true, thresholdRows: 500 },
  largeDeal: { enabled: false, thresholdAmount: 1_000_000, currency: "KES" },
  deletion: { enabled: true },
};

export const APPROVAL_RULES_KEY = "approvals.rules";

/** Whether a quote discount is above the limit, so sending it must wait for an approver. */
export function discountNeedsApproval(discountPercent: number, rules: ApprovalRuleSettings): boolean {
  return rules.discount.enabled && discountPercent > rules.discount.thresholdPercent;
}

/**
 * Whether marking a deal won must wait for an approver. A deal whose size cannot be compared with the limit (no value, a zero
 * value, or another currency) also waits: otherwise the owner could clear the value or change the currency to skip the rule.
 */
export function largeDealNeedsApproval(amount: number | null, currency: string, rules: ApprovalRuleSettings): boolean {
  const r = rules.largeDeal;
  if (!r.enabled) return false;
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || currency !== r.currency) return true;
  return amount > r.thresholdAmount;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Reads the stored JSON back into a complete settings object; anything missing or out of range falls back to the default. */
export function parseApprovalRules(raw: unknown): ApprovalRuleSettings {
  const d = DEFAULT_APPROVAL_RULES;
  const v = obj(raw);
  const discount = obj(v.discount);
  const exp = obj(v.export);
  const deal = obj(v.largeDeal);
  const del = obj(v.deletion);
  return {
    discount: { enabled: bool(discount.enabled, d.discount.enabled), thresholdPercent: num(discount.thresholdPercent, d.discount.thresholdPercent, 0, 30) },
    export: { enabled: bool(exp.enabled, d.export.enabled), thresholdRows: Math.floor(num(exp.thresholdRows, d.export.thresholdRows, 1, 100_000)) },
    largeDeal: {
      enabled: bool(deal.enabled, d.largeDeal.enabled),
      thresholdAmount: num(deal.thresholdAmount, d.largeDeal.thresholdAmount, 1, 999_999_999_999),
      currency: typeof deal.currency === "string" && /^[A-Z]{3}$/.test(deal.currency) ? deal.currency : d.largeDeal.currency,
    },
    deletion: { enabled: bool(del.enabled, d.deletion.enabled) },
  };
}
