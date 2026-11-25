/**
 * Sales draft-only invoice access (UC-R10, FIG-1781; decision DECISIONS 11.9.2, D-10). Pure parts, so they can be tested without a database.
 *
 * An organisation setting row (`invoices.sales_draft`, `{ enabled: boolean }`) switches it. It is ON by default (UC-C7): an organisation that never touched it allows drafts, and Management switches it off in Settings. When on, the Sales role may
 * create a DRAFT invoice for a won deal it owns, and read the drafts of its own deals: number, amount, due date and status, nothing else.
 * Payments, balances and the overdue state never reach Sales (CLAUDE.md rule 7).
 */
export const SALES_DRAFT_KEY = "invoices.sales_draft";

export function parseStoredSalesDraft(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true;
}

/** The fields a Sales person may see of an invoice. A whitelist: a field added to the full invoice view later does not leak by accident. */
export const SALES_DRAFT_FIELDS = ["id", "number", "status", "dealId", "companyId", "companyName", "amount", "currency", "issuedOn", "dueOn", "notes", "paymentTermsDays", "terms", "createdAt"] as const;

export function toSalesDraftView<T extends Record<string, unknown>>(full: T): Pick<T, Extract<(typeof SALES_DRAFT_FIELDS)[number], keyof T>> & { status: "DRAFT"; salesDraftOnly: true } {
  const out: Record<string, unknown> = {};
  for (const k of SALES_DRAFT_FIELDS) if (k in full) out[k] = full[k];
  out.status = "DRAFT";
  out.salesDraftOnly = true;
  return out as never;
}
