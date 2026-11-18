/**
 * Stage rules (FIG-1147, B6.15), pure. A rule sits on a stage and can block a move INTO it, saying why. It never moves a deal,
 * sets a value or approves anything (hard rule 9): it only describes what is missing.
 */

export const STAGE_RULE_TYPES = ["QUOTE_REQUIRED", "REQUIRED_FIELDS", "APPROVAL_REQUIRED"] as const;
export type StageRuleType = (typeof STAGE_RULE_TYPES)[number];

export const RULE_LABEL: Record<StageRuleType, string> = {
  QUOTE_REQUIRED: "Needs a valid quote",
  REQUIRED_FIELDS: "Needs these fields filled in",
  APPROVAL_REQUIRED: "Needs approval",
};

/** Deal fields a stage can require, with the words the block reason uses. Custom fields are `custom:<key>`. */
export const DEAL_FIELD_LABELS: Record<string, string> = {
  value: "Deal value",
  expectedCloseDate: "Expected close date",
  primaryContactId: "Primary contact",
  serviceId: "Service",
  notes: "Notes",
};

export interface DealFacts {
  value: unknown;
  expectedCloseDate: unknown;
  primaryContactId: string | null;
  serviceId: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
}

export function isFieldFilled(field: string, deal: DealFacts): boolean {
  if (field.startsWith("custom:")) {
    const v = deal.customFields[field.slice(7)];
    return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  }
  const v = (deal as unknown as Record<string, unknown>)[field];
  if (typeof v === "string") return v.trim() !== "";
  return v !== null && v !== undefined;
}

export function missingFields(fields: readonly string[], deal: DealFacts): string[] {
  return fields.filter((f) => !isFieldFilled(f, deal));
}

export function readFields(config: unknown): string[] {
  const f = (config as { fields?: unknown } | null)?.fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
