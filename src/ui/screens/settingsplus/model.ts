/**
 * The settings editors' rules, pure so each one can be tested without a screen (FIG-1174, FIG-1194). Every editor validates before it saves and
 * says what the change will do (`impact`), so Management never saves blind. Nothing here decides anything for a person (hard rule 9): rules stop a
 * move and explain why; sequences prepare tasks and drafts; approvals wait for a human.
 */

export type Access = "Edit" | "Own" | "View" | "Hidden";
export const ACCESS_CYCLE: Access[] = ["Edit", "Own", "View", "Hidden"];
export const nextAccess = (a: Access): Access => ACCESS_CYCLE[(ACCESS_CYCLE.indexOf(a) + 1) % ACCESS_CYCLE.length]!;

export const ROLE_KEYS = ["management", "sales", "delivery", "finance", "technical", "support"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const ROLE_LABELS: Record<RoleKey, string> = { management: "Management", sales: "Sales", delivery: "Delivery", finance: "Finance", technical: "Restricted Technical", support: "Customer Support (proposed)" };

export interface FieldRow {
  key: string;
  label: string;
  access: Record<RoleKey, Access>;
}

export interface FieldChange {
  field: string;
  role: RoleKey;
  from: Access;
  to: Access;
}

export function diffFields(before: readonly FieldRow[], after: readonly FieldRow[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const a of after) {
    const b = before.find((x) => x.key === a.key);
    if (!b) continue;
    for (const r of ROLE_KEYS) if (a.access[r] !== b.access[r]) out.push({ field: a.label, role: r, from: b.access[r], to: a.access[r] });
  }
  return out;
}

/** Management must never lose sight of a field (not Hidden, not Own-only), so that someone can always see and correct a record. Anything else is the organisation's choice. */
export function validateFields(rows: readonly FieldRow[]): string[] {
  const errors: string[] = [];
  for (const r of rows) if (r.access.management === "Hidden" || r.access.management === "Own") errors.push(`${r.label}: Management must keep at least View access, or nobody could oversee this field.`);
  return errors;
}

export function describeChange(c: FieldChange): string {
  const verb = c.to === "Hidden" ? "will no longer see" : c.from === "Hidden" ? "will start to see" : "will now have";
  return c.to === "Hidden" || c.from === "Hidden"
    ? `${ROLE_LABELS[c.role]} ${verb} “${c.field}”.`
    : `${ROLE_LABELS[c.role]} ${verb} ${c.to} access to “${c.field}” (was ${c.from}).`;
}

/** What a role sees of one sample field after the draft: the value, a masked marker, or nothing. */
export function previewValue(access: Access, sample: string, owner: boolean): { text: string; note: string } {
  if (access === "Hidden") return { text: "", note: "Not shown at all" };
  if (access === "Own" && !owner) return { text: "Masked", note: "Only on records they own" };
  if (access === "View") return { text: sample, note: "Read only" };
  return { text: sample, note: "Can change it" };
}

/* Approval rules ------------------------------------------------------------------------------------------------------------------- */

export interface ApprovalRule {
  key: "discount" | "export" | "deal" | "deletion";
  label: string;
  unit: string;
  on: boolean;
  threshold: number;
}

export function validateRules(rules: readonly ApprovalRule[], maxDiscount: number): string[] {
  const errors: string[] = [];
  for (const r of rules) {
    if (r.key === "deletion") continue;
    if (!Number.isFinite(r.threshold) || r.threshold <= 0) errors.push(`${r.label}: the threshold must be more than 0.`);
    if (r.key === "discount" && r.threshold > maxDiscount) errors.push(`${r.label}: ${r.threshold}% is above the ${maxDiscount}% a quote may ever carry, so the rule could never trigger.`);
  }
  return errors;
}

/** Plain-language effect of each rule change (what will wait for Management from now on). */
export function ruleImpact(before: readonly ApprovalRule[], after: readonly ApprovalRule[]): string[] {
  const out: string[] = [];
  for (const a of after) {
    const b = before.find((x) => x.key === a.key)!;
    if (a.on !== b.on) out.push(a.on ? `“${a.label}” will start to wait for Management.` : `“${a.label}” will no longer wait for a decision. It goes straight through.`);
    else if (a.on && a.threshold !== b.threshold) out.push(`“${a.label}” now applies above ${a.threshold} ${a.unit} (was ${b.threshold}).`);
  }
  return out;
}

/* Pipelines ------------------------------------------------------------------------------------------------------------------------ */

export interface StageRule {
  key: "proposal" | "won" | "lostReason";
  label: string;
  detail: string;
  on: boolean;
  /** Cannot be switched off. */
  locked?: boolean;
}

export function stageRuleImpact(before: readonly StageRule[], after: readonly StageRule[], dealsInStage: Record<StageRule["key"], number>): string[] {
  const out: string[] = [];
  for (const a of after) {
    const b = before.find((x) => x.key === a.key)!;
    if (a.on === b.on) continue;
    const n = dealsInStage[a.key];
    out.push(
      a.on
        ? `${a.label}: from now a move is refused until the condition is met${n ? `. ${n} open deal${n === 1 ? " is" : "s are"} already past it and stay where ${n === 1 ? "it is" : "they are"}` : ""}.`
        : `${a.label}: deals will move without that check.`,
    );
  }
  return out;
}

export function validatePipelineName(name: string, existing: readonly string[]): string | null {
  const n = name.trim();
  if (!n) return "Give the pipeline a name.";
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return "A pipeline with that name already exists.";
  return null;
}

/* Sequences ------------------------------------------------------------------------------------------------------------------------ */

export function validateSequence(name: string, steps: readonly string[]): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("Give the sequence a name.");
  if (steps.length === 0) errors.push("A sequence needs at least one step.");
  steps.forEach((s, i) => {
    if (!s.trim()) errors.push(`Step ${i + 1} is empty.`);
  });
  return errors;
}

/* Web forms ------------------------------------------------------------------------------------------------------------------------ */

export const FORM_KEY = "k3f9x2";
export const embedCode = (key = FORM_KEY) => `<script src="https://forms.figbloom.co.ke/f/${key}.js" async></script>`;

export interface FormField {
  key: string;
  label: string;
  note: string;
  locked?: boolean;
  on: boolean;
}

export function validateForm(fields: readonly FormField[]): string[] {
  const errors: string[] = [];
  for (const f of fields) if (f.locked && !f.on) errors.push(`${f.label} cannot be removed: every enquiry needs a way to reach the person.`);
  return errors;
}

/* Catalogue ------------------------------------------------------------------------------------------------------------------------ */

export function validateCatalogueItem(i: { name: string; unit: string; price: number; cost: number }, requireCost: boolean): string[] {
  const errors: string[] = [];
  if (!i.name.trim()) errors.push("Give the item a name.");
  if (!i.unit.trim()) errors.push(`${i.name || "The item"}: say what the price is per (unit, month, project…).`);
  if (!Number.isFinite(i.price) || i.price <= 0) errors.push(`${i.name || "The item"}: the price must be more than 0.`);
  if (requireCost && i.cost > i.price) errors.push(`${i.name || "The item"}: the cost is above the price, which would sell at a loss.`);
  return errors;
}

/* Developers ----------------------------------------------------------------------------------------------------------------------- */

export const TOKEN_SCOPES = ["leads:read", "leads:create", "deals:read", "deals:write", "companies:read", "payments:read", "payments:write"] as const;

/** A secret shown once. Only the last four characters are ever kept for display after that. */
export function generateSecret(prefix: string, random: (n: number) => Uint8Array): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = random(32);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}${out}`;
}

export const maskSecret = (secret: string): string => `${secret.slice(0, secret.indexOf("_", secret.indexOf("_") + 1) + 1)}••••${secret.slice(-3)}`;

export function validateToken(name: string, scopes: readonly string[]): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("Name the token so you can tell what uses it.");
  if (scopes.length === 0) errors.push("Choose at least one scope. A token with no scope can do nothing.");
  return errors;
}

export function validateWebhook(url: string, events: readonly string[]): string[] {
  const errors: string[] = [];
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") errors.push("The endpoint must use https.");
  } catch {
    errors.push("Enter the full endpoint address, starting with https://.");
  }
  if (events.length === 0) errors.push("Choose at least one event to send.");
  return errors;
}
