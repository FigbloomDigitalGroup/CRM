import { dueDateFrom } from "@/lib/invoiceNumbering";

/** The create-invoice form (UC-R8), pure so it can be tested without a screen. Money is typed as text and sent as text (two decimals at most). */
export interface InvoiceDraft {
  number: string;
  amount: string;
  issuedOn: string;
  /** Days from the issue date, or "" for a due date picked by hand. */
  termsDays: string;
  dueOn: string;
  terms: string;
}

export const TERMS_CHOICES: { value: string; label: string }[] = [
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7 days" },
  { value: "14", label: "Net 14 days" },
  { value: "30", label: "Net 30 days" },
  { value: "45", label: "Net 45 days" },
  { value: "60", label: "Net 60 days" },
  { value: "", label: "Pick the due date myself" },
];

export const DEFAULT_TERMS_DAYS = "30";

export function newDraft(today: string, amount = ""): InvoiceDraft {
  return { number: "", amount, issuedOn: today, termsDays: DEFAULT_TERMS_DAYS, dueOn: dueDateFrom(today, Number(DEFAULT_TERMS_DAYS)), terms: "" };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Changing the issue date or the terms recomputes the due date; typing a due date by hand switches the terms to "pick myself". */
export function applyChange(d: InvoiceDraft, patch: Partial<InvoiceDraft>): InvoiceDraft {
  const next = { ...d, ...patch };
  if (patch.dueOn !== undefined && patch.termsDays === undefined) return { ...next, termsDays: "" };
  if ((patch.issuedOn !== undefined || patch.termsDays !== undefined) && next.termsDays !== "" && DATE.test(next.issuedOn)) {
    return { ...next, dueOn: dueDateFrom(next.issuedOn, Number(next.termsDays)) };
  }
  return next;
}

export function validateDraft(d: InvoiceDraft, mustHaveCustomer: boolean, hasCustomer: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mustHaveCustomer && !hasCustomer) errors.customer = "Choose the customer this invoice is for.";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(d.amount.trim()) || Number(d.amount) <= 0) errors.amount = "Enter an amount above zero, with at most two decimals.";
  if (!DATE.test(d.issuedOn)) errors.issuedOn = "Pick the issue date.";
  if (!DATE.test(d.dueOn)) errors.dueOn = "Pick the due date.";
  else if (DATE.test(d.issuedOn) && d.dueOn < d.issuedOn) errors.dueOn = "The due date is on or after the issue date.";
  if (d.number.trim().length > 60) errors.number = "At most 60 characters.";
  if (d.terms.length > 2000) errors.terms = "At most 2000 characters.";
  return errors;
}

/** The POST body. A blank number is left out, which asks for the next automatic number. */
export function toBody(d: InvoiceDraft, target: { companyId?: string; dealId?: string }) {
  return {
    ...(d.number.trim() ? { number: d.number.trim() } : {}),
    amount: d.amount.trim(),
    issuedOn: d.issuedOn,
    dueOn: d.dueOn,
    ...(d.termsDays !== "" ? { paymentTermsDays: Number(d.termsDays) } : {}),
    ...(d.terms.trim() ? { terms: d.terms.trim() } : {}),
    ...(target.dealId ? { dealId: target.dealId } : {}),
    ...(target.companyId ? { companyId: target.companyId } : {}),
  };
}
