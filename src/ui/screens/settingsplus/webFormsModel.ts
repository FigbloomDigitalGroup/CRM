/**
 * Web forms editor model (FIG-1174, B6.19): the shapes the builder API returns (typed `unknown` in the contract; from `present` in
 * `src/services/webFormService.ts`), the standard fields the editor offers as switches, and the checks that mirror the server's form rules.
 */

export interface ApiFormField {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select";
  required: boolean;
  maps: "name" | "email" | "phone" | "company" | "service" | "message" | null;
  options?: string[];
}

export interface WebFormView {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publicKey: string;
  fields: ApiFormField[];
  successMessage: string;
  allowedOrigins: string[];
  captchaConfigured: boolean;
}

export interface SubmissionView {
  id: string;
  at: string;
  outcome: string;
  explanation: string | null;
  duplicateWarning: { contact: boolean; company: boolean } | null;
}

export interface FieldChoice {
  key: string;
  label: string;
  note: string;
  locked: boolean;
  on: boolean;
}

/** The standard fields offered as switches, in the order the form shows them. */
export const PALETTE: (ApiFormField & { note: string; locked?: boolean })[] = [
  { key: "name", label: "Full name", type: "text", required: true, maps: "name", note: "Always on", locked: true },
  { key: "email", label: "Email", type: "email", required: false, maps: "email", note: "Email or phone is needed" },
  { key: "phone", label: "Phone", type: "phone", required: false, maps: "phone", note: "" },
  { key: "company", label: "Company", type: "text", required: false, maps: "company", note: "" },
  { key: "service", label: "Service interest", type: "text", required: false, maps: "service", note: "Routes to the right owner" },
  { key: "budget", label: "Budget range", type: "text", required: false, maps: null, note: "Kept in the lead’s notes" },
  { key: "message", label: "Message", type: "textarea", required: false, maps: "message", note: "" },
];

/** One switch per standard field, plus any other field the form already has. */
export function choicesFor(fields: readonly ApiFormField[]): FieldChoice[] {
  const has = new Set(fields.map((f) => f.key));
  const standard = PALETTE.map((p) => ({ key: p.key, label: p.label, note: p.note, locked: p.locked === true, on: has.has(p.key) }));
  const extra = fields.filter((f) => !PALETTE.some((p) => p.key === f.key)).map((f) => ({ key: f.key, label: f.label, note: "", locked: false, on: true }));
  return [...standard, ...extra];
}

/** The fields to send once the switches are applied: kept fields stay as they are, switched-on standard ones are added in order. */
export function applyChoices(fields: readonly ApiFormField[], choices: readonly FieldChoice[]): ApiFormField[] {
  const on = new Set(choices.filter((c) => c.on).map((c) => c.key));
  const kept = fields.filter((f) => on.has(f.key));
  const added = PALETTE.filter((p) => on.has(p.key) && !fields.some((f) => f.key === p.key)).map(({ note: _n, locked: _l, ...f }) => f);
  const order = new Map(PALETTE.map((p, i) => [p.key, i]));
  return [...kept, ...added].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99) || 0);
}

export function validateFormChoices(choices: readonly FieldChoice[]): string[] {
  const errors: string[] = [];
  const on = (k: string) => choices.some((c) => c.key === k && c.on);
  if (!on("name")) errors.push("Full name cannot be removed: every enquiry needs a name.");
  if (!on("email") && !on("phone")) errors.push("Keep Email or Phone on: every enquiry needs a way to reach the person.");
  return errors;
}

export const SUBMISSION_LABEL: Record<string, string> = { ACCEPTED: "Lead created" };
