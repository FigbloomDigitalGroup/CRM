"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_DISCOUNT_LIMIT, clampDiscount, freezePrices, newVersion, type CatalogueItem, type QuoteDoc, type QuoteLine, type QuoteStatus } from "../quoteMath";
import { catalogue as seedCatalogue, DEMO_NOW, seedApprovals, seedQuotes, targets as seedTargets, type DemoApproval } from "./data";

/**
 * The demo screens' one place for changeable sample state, so a presenter can click through a quote, an approval or a target and see the other
 * screens follow. It lives in memory only (a reload starts again), is read through `useDemoStore`, and is the single module wiring to the real
 * API replaces (docs/RESTRUCTURE_LOG.md).
 */
interface State {
  catalogue: CatalogueItem[];
  quotes: QuoteDoc[];
  approvals: DemoApproval[];
  targets: Record<string, number>;
  /** Deal values the quote was copied to ("Use the quote total"). */
  dealValues: Record<string, number>;
  deposit: Record<string, boolean>;
  /** The discount above which a quote waits for Management (Settings › Approval rules). */
  discountLimit: number;
}

const initial = (): State => ({
  catalogue: seedCatalogue.map((c) => ({ ...c })),
  quotes: seedQuotes.map((q) => ({ ...q, lines: q.lines.map((l) => ({ ...l })), history: [...q.history] })),
  approvals: seedApprovals.map((a) => ({ ...a })),
  targets: { ...seedTargets },
  dealValues: {},
  deposit: {},
  discountLimit: DEFAULT_DISCOUNT_LIMIT,
});

let state: State = initial();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: State) => {
  state = next;
  emit();
};

export function resetDemoStore() {
  set(initial());
}

export function useDemoStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

const now = () => DEMO_NOW;

export function getQuote(dealId: string): QuoteDoc | undefined {
  return state.quotes.find((q) => q.dealId === dealId);
}

/** The quote for a deal, made as an empty draft the first time (the prototype does the same). */
export function ensureQuote(dealId: string, title: string, by: string): QuoteDoc {
  const existing = getQuote(dealId);
  if (existing) return existing;
  const q: QuoteDoc = {
    id: `q${state.quotes.length + 1}`,
    dealId,
    no: `Q-2026-0${32 + state.quotes.length + 1}`,
    version: 1,
    status: "Draft",
    lines: [],
    discount: 0,
    validUntil: "2026-11-28",
    terms: "50% deposit, balance on delivery. Prices include 16% VAT.",
    history: [{ v: 1, by, at: now(), note: `Draft created for ${title}` }],
  };
  set({ ...state, quotes: [...state.quotes, q] });
  return q;
}

function patchQuote(dealId: string, fn: (q: QuoteDoc) => QuoteDoc) {
  set({ ...state, quotes: state.quotes.map((q) => (q.dealId === dealId ? fn(q) : q)) });
}

/** Edits apply to a Draft or Approved version only; a locked version cannot be changed (the screen offers "New version" instead). */
const editable = (q: QuoteDoc) => q.status === "Draft" || q.status === "Approved";

export const quoteActions = {
  setQty(dealId: string, cat: string, qty: number) {
    patchQuote(dealId, (q) => (editable(q) ? { ...q, lines: q.lines.map((l) => (l.cat === cat ? { ...l, qty: Math.max(0, Math.floor(qty) || 0) } : l)) } : q));
  },
  removeLine(dealId: string, cat: string) {
    patchQuote(dealId, (q) => (editable(q) ? { ...q, lines: q.lines.filter((l) => l.cat !== cat) } : q));
  },
  addLine(dealId: string, cat: string) {
    patchQuote(dealId, (q) => {
      if (!editable(q)) return q;
      const has = q.lines.some((l) => l.cat === cat);
      const lines: QuoteLine[] = has ? q.lines.map((l) => (l.cat === cat ? { ...l, qty: l.qty + 1 } : l)) : [...q.lines, { cat, qty: 1 }];
      return { ...q, lines };
    });
  },
  setDiscount(dealId: string, pct: number) {
    patchQuote(dealId, (q) => (editable(q) ? { ...q, discount: clampDiscount(pct), status: "Draft" } : q));
  },
  setTerms(dealId: string, terms: string) {
    patchQuote(dealId, (q) => (editable(q) ? { ...q, terms } : q));
  },
  newVersion(dealId: string, by: string) {
    patchQuote(dealId, (q) => newVersion(q, by, now()));
  },
  setStatus(dealId: string, status: QuoteStatus, by: string, note: string) {
    patchQuote(dealId, (q) => ({ ...q, lines: status === "Sent" ? freezePrices(q.lines, state.catalogue) : q.lines, status, history: [...q.history, { v: q.version, by, at: now(), note }] }));
  },
  sign(dealId: string, signer: string) {
    patchQuote(dealId, (q) => ({
      ...q,
      status: "Signed",
      signer,
      signedAt: now(),
      history: [...q.history, { v: q.version, by: signer, at: now(), note: `Signed by ${signer} · IP and timestamp recorded` }],
    }));
  },
};

export function requestApproval(a: Omit<DemoApproval, "id" | "at" | "status">) {
  set({ ...state, approvals: [{ ...a, id: `ap${Date.now()}`, at: now(), status: "Pending" }, ...state.approvals] });
}

/** A decision. A declined quote goes back to Draft with the reason on its history; an approved one can be sent. */
export function decideApproval(id: string, status: "Approved" | "Declined", reason: string, by: string) {
  const a = state.approvals.find((x) => x.id === id);
  if (!a || a.status !== "Pending") return;
  const approvals = state.approvals.map((x) => (x.id === id ? { ...x, status, reason: reason.trim() || undefined } : x));
  let quotes = state.quotes;
  if (a.quoteDealId) {
    quotes = quotes.map((q) =>
      q.dealId === a.quoteDealId
        ? {
            ...q,
            status: status === "Approved" ? ("Approved" as const) : ("Draft" as const),
            history: [...q.history, { v: q.version, by, at: now(), note: `Discount ${status.toLowerCase()}${reason.trim() ? `: ${reason.trim()}` : ""}` }],
          }
        : q,
    );
  }
  set({ ...state, approvals, quotes });
}

export function setTarget(owner: string, value: number) {
  set({ ...state, targets: { ...state.targets, [owner]: Math.max(0, Math.floor(value) || 0) } });
}

export function setCataloguePrice(id: string, price: number) {
  set({ ...state, catalogue: state.catalogue.map((c) => (c.id === id ? { ...c, price: Math.max(0, Math.floor(price) || 0) } : c)) });
}

export function setDealValue(dealId: string, value: number) {
  set({ ...state, dealValues: { ...state.dealValues, [dealId]: value } });
}

export function requestDeposit(quoteId: string) {
  set({ ...state, deposit: { ...state.deposit, [quoteId]: true } });
}

export function setDiscountLimit(pct: number) {
  set({ ...state, discountLimit: pct });
}

export function addCatalogueItem(item: Omit<CatalogueItem, "id">) {
  set({ ...state, catalogue: [...state.catalogue, { ...item, id: `cat${state.catalogue.length + 1}` }] });
}

/** Saves a whole catalogue draft at once (the editor validates first). Quotes already sent keep the prices frozen on their lines. */
export function saveCatalogue(items: CatalogueItem[]) {
  set({ ...state, catalogue: items });
}
