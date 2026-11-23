/**
 * The Quotes page's pure rules (UC-R3, UC-R4; FIG-1784, FIG-1777): the status chips and what each asks the server, the filters a saved view keeps,
 * the activity line on a row, and what may be shared. No money is computed here (rule 7): totals arrive masked or not from the API.
 */

export type ChipKey = "ALL" | "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";

/** The design's seven chips plus "All". Expired is derived on the server (sent or approved, past its validity date). */
export const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "PENDING_APPROVAL", label: "Awaiting approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "SENT", label: "Sent" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "DECLINED", label: "Declined" },
  { key: "EXPIRED", label: "Expired" },
];

export interface QuoteFilters {
  q: string;
  chip: ChipKey;
  /** A membership id, or "" for any owner. */
  owner: string;
  /** YYYY-MM-DD, or "". */
  validFrom: string;
  validTo: string;
}

export const NO_FILTERS: QuoteFilters = { q: "", chip: "ALL", owner: "", validFrom: "", validTo: "" };

export const isFiltered = (f: QuoteFilters): boolean => f.q.trim() !== "" || f.chip !== "ALL" || f.owner !== "" || f.validFrom !== "" || f.validTo !== "";

/** The list's query string (additive parameters only). `counts` and `activity` ask for the chip counts and the per-row links. */
export function queryOf(f: QuoteFilters, page: number, pageSize: number): Record<string, string> {
  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize), counts: "true", activity: "true" };
  if (f.q.trim()) query.q = f.q.trim();
  if (f.owner) query.owner = f.owner;
  if (f.validFrom) query.validFrom = f.validFrom;
  if (f.validTo) query.validTo = f.validTo;
  if (f.chip === "EXPIRED") query.expired = "only";
  else if (f.chip !== "ALL") {
    query.status = f.chip;
    // "Approved" and "Sent" mean not yet expired: an expired one is counted under Expired, so the chips add up.
    if (f.chip === "APPROVED" || f.chip === "SENT") query.expired = "exclude";
  }
  return query;
}

/** What a saved view keeps: the chip is its tab, the rest are its filters (empty ones are left out by the store). */
export function toViewState(f: QuoteFilters): { tab: string; filters: Record<string, string> } {
  return { tab: f.chip, filters: { q: f.q, owner: f.owner, validFrom: f.validFrom, validTo: f.validTo } };
}

export function fromViewState(state: { tab: string; filters: Record<string, string> }): QuoteFilters {
  const chip = CHIPS.some((c) => c.key === state.tab) ? (state.tab as ChipKey) : "ALL";
  const f = state.filters;
  return { q: f.q ?? "", chip, owner: f.owner ?? "", validFrom: f.validFrom ?? "", validTo: f.validTo ?? "" };
}

export interface RowActivity {
  links: number;
  activeLinks: number;
  revokedLinks: number;
  expiredLinks: number;
  views: number;
  lastViewedAt: string | null;
}

/** The sent, viewed, revoked and expired lines a row shows, from what the API already recorded. Nothing is invented: no events, no lines. */
export function activityLines(row: { sentAt: string | null; activity?: RowActivity }, dateLabel: (iso: string) => string): string[] {
  const out: string[] = [];
  if (row.sentAt) out.push(`Sent ${dateLabel(row.sentAt)}`);
  const a = row.activity;
  if (!a) return out;
  if (a.views > 0) out.push(`Viewed ${a.views} ${a.views === 1 ? "time" : "times"}${a.lastViewedAt ? `, last ${dateLabel(a.lastViewedAt)}` : ""}`);
  if (a.links > 0 && a.activeLinks === 0) {
    if (a.revokedLinks > 0) out.push("Link revoked");
    else if (a.expiredLinks > 0) out.push("Link expired");
  }
  return out;
}

/** Why a quote cannot be shared now, or null when it can. Drafts are sent from the builder; sharing is for approved and sent quotes. */
export function shareBlockedReason(input: { status: string; expired: boolean; amountMasked: boolean; mayShare: boolean }): string | null {
  if (!input.mayShare) return "Your role can read quotes but not send them.";
  if (input.amountMasked) return "Sharing a quote needs the right to see its amounts.";
  if (input.status === "PENDING_APPROVAL") return "Waiting for Management to approve the discount before it can be shared.";
  if (input.status === "DRAFT") return "Send it from the builder first; drafts cannot be shared here.";
  if (input.status === "REJECTED") return "This version was not approved. Make a new version in the builder.";
  if (input.status === "ACCEPTED" || input.status === "DECLINED") return `The client has already ${input.status === "ACCEPTED" ? "accepted" : "declined"} this quote; sharing is closed.`;
  if (input.expired) return "This quote has passed its validity date; sharing is closed. Make a new version with a new date.";
  return null;
}

/** WhatsApp click-to-chat with the share link. No number is given, so the person chooses who to send it to inside WhatsApp. */
export function whatsappUrl(quoteNumber: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`Here is quote ${quoteNumber}: ${link}`)}`;
}
