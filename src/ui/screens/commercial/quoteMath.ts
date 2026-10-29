/**
 * Quote arithmetic and rules, pure so they can be tested without a screen (FIG-1168). Prices include VAT (the quote's terms say so), so the
 * total is the subtotal less the discount. A discount above the approval limit stops a send until Management decides; the limit comes from the
 * approval rules (Settings), never from a role name.
 */
export interface CatalogueItem {
  id: string;
  name: string;
  unit: string;
  price: number;
  cost: number;
}

export interface QuoteLine {
  cat: string;
  qty: number;
  /** Unit price and cost frozen when the version was sent, so a later catalogue change never alters a quote the client already has. */
  price?: number;
  cost?: number;
}

export type QuoteStatus = "Draft" | "Pending approval" | "Approved" | "Sent" | "Signed";

export const DEFAULT_DISCOUNT_LIMIT = 5;
export const MAX_DISCOUNT = 30;

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  total: number;
  cost: number;
  /** Margin on the discounted total, as a whole percentage. Only ever shown to a role with `deals.margin`. */
  marginPct: number;
}

export function clampDiscount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_DISCOUNT, n));
}

export function quoteTotals(lines: readonly QuoteLine[], catalogue: readonly CatalogueItem[], discountPct: number): QuoteTotals {
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  let subtotal = 0;
  let cost = 0;
  for (const l of lines) {
    const item = byId.get(l.cat);
    if (!item) continue;
    subtotal += (l.price ?? item.price) * l.qty;
    cost += (l.cost ?? item.cost) * l.qty;
  }
  const discount = Math.round((subtotal * clampDiscount(discountPct)) / 100);
  const total = subtotal - discount;
  return { subtotal, discount, total, cost, marginPct: total ? Math.round(((total - cost) / total) * 100) : 0 };
}

export function needsApproval(discountPct: number, status: QuoteStatus, limit = DEFAULT_DISCOUNT_LIMIT): boolean {
  return discountPct > limit && status !== "Approved";
}

/** A sent, signed or waiting version is immutable: the way to change it is a new version (the earlier ones stay in history). */
export function isLocked(status: QuoteStatus): boolean {
  return status === "Sent" || status === "Signed" || status === "Pending approval";
}

export interface HistoryEntry {
  v: number;
  by: string;
  at: string;
  note: string;
}

export interface QuoteDoc {
  id: string;
  dealId: string;
  no: string;
  version: number;
  status: QuoteStatus;
  lines: QuoteLine[];
  discount: number;
  validUntil: string;
  terms: string;
  history: HistoryEntry[];
  signer?: string;
  signedAt?: string;
}

/** The lines with today's catalogue prices frozen onto them (done when a version is sent). */
export function freezePrices(lines: readonly QuoteLine[], catalogue: readonly CatalogueItem[]): QuoteLine[] {
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  return lines.map((l) => ({ ...l, price: byId.get(l.cat)?.price ?? l.price, cost: byId.get(l.cat)?.cost ?? l.cost }));
}

/** The new draft made from a locked version. Earlier versions are never edited; the history keeps every step. */
export function newVersion(q: QuoteDoc, by: string, at: string): QuoteDoc {
  const version = q.version + 1;
  return {
    ...q,
    version,
    status: "Draft",
    lines: q.lines.map(({ cat, qty }) => ({ cat, qty })),
    signer: undefined,
    signedAt: undefined,
    history: [...q.history, { v: version, by, at, note: `New version from v${q.version}` }],
  };
}

export function formatKes(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

export function formatKesShort(n: number): string {
  if (n >= 1_000_000) return `KES ${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `KES ${Math.round(n / 1_000)}K`;
  return `KES ${Math.round(n)}`;
}
