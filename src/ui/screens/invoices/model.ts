/**
 * The Invoices page's pure rules (UC-R7, FIG-1785): the ageing buckets, the status chips and the query the list sends. No money is added up
 * here: every figure arrives from the API as a two-decimal string, already summed on the server.
 */
import type { InvoiceStatus } from "../finance/format";

export type StatusFilter = "" | InvoiceStatus;

export const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: "", label: "All" },
  { id: "DRAFT", label: "Draft" },
  { id: "SENT", label: "Sent" },
  { id: "PART_PAID", label: "Part paid" },
  { id: "PAID", label: "Paid" },
  { id: "OVERDUE", label: "Overdue" },
  { id: "VOID", label: "Void" },
];

export const AGEING_KEYS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingKey = (typeof AGEING_KEYS)[number];

export const AGEING_LABEL: Record<AgeingKey, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export const AGEING_COLOUR: Record<AgeingKey, string> = {
  current: "var(--primary)",
  d1_30: "var(--orange)",
  d31_60: "var(--orange-text)",
  d61_90: "var(--red)",
  d90_plus: "var(--red)",
};

export interface AgeingBucket {
  count: number;
  outstanding: string;
}
export type Ageing = Partial<Record<AgeingKey, AgeingBucket>>;

/** A bucket's share of the bar, 0 to 100, with a sliver for a bucket that has money so it never disappears. */
export function barShare(ageing: Ageing, key: AgeingKey): number {
  const cents = (k: AgeingKey) => Math.round(Number(ageing[k]?.outstanding ?? 0) * 100);
  const total = AGEING_KEYS.reduce((n, k) => n + cents(k), 0);
  if (total === 0 || cents(key) === 0) return 0;
  return Math.max(4, (cents(key) / total) * 100);
}

/** What clicking a bucket shows: the not-yet-due ones are Sent, every late one is Overdue (the status the API filters on). */
export function statusForBucket(key: AgeingKey): StatusFilter {
  return key === "current" ? "SENT" : "OVERDUE";
}

export interface InvoiceFilters {
  status: StatusFilter;
  q: string;
  dueFrom: string;
  dueTo: string;
  amountMin: string;
  amountMax: string;
  hasBalance: boolean;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: number;
}

export const NO_FILTERS: InvoiceFilters = { status: "", q: "", dueFrom: "", dueTo: "", amountMin: "", amountMax: "", hasBalance: false, sort: null, page: 1 };

export const PAGE_SIZE = 25;

/** The filter keys the list and the CSV export share (everything but paging and sort). */
export function filterParams(f: InvoiceFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status) out.status = f.status;
  if (f.q.trim()) out.q = f.q.trim();
  if (f.dueFrom) out.dueFrom = f.dueFrom;
  if (f.dueTo) out.dueTo = f.dueTo;
  if (f.amountMin.trim()) out.amountMin = f.amountMin.trim();
  if (f.amountMax.trim()) out.amountMax = f.amountMax.trim();
  if (f.hasBalance) out.hasBalance = "true";
  return out;
}

export function listQuery(f: InvoiceFilters): Record<string, string> {
  const out = { ...filterParams(f), page: String(f.page), pageSize: String(PAGE_SIZE) };
  // Default order is due date ascending, the oldest debt first (the API's own default).
  return f.sort ? { ...out, sort: `${f.sort.dir === "desc" ? "-" : ""}${f.sort.key}` } : out;
}

export function isFiltered(f: InvoiceFilters): boolean {
  return Object.keys(filterParams(f)).length > 0;
}
