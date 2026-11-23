import { describe, expect, it } from "vitest";
import { CHIPS, NO_FILTERS, activityLines, fromViewState, isFiltered, queryOf, shareBlockedReason, toViewState, whatsappUrl } from "../src/ui/screens/commercial/quoteListModel";

const label = (iso: string) => iso.slice(0, 10);

describe("the Quotes page's filter rules (UC-R3)", () => {
  it("has the seven statuses of the design plus All", () => {
    expect(CHIPS.map((c) => c.key)).toEqual(["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"]);
  });

  it("no filters asks only for paging, counts and activity", () => {
    expect(queryOf(NO_FILTERS, 1, 20)).toEqual({ page: "1", pageSize: "20", counts: "true", activity: "true" });
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it("each chip maps to the right parameters; Approved and Sent exclude the derived Expired", () => {
    expect(queryOf({ ...NO_FILTERS, chip: "DRAFT" }, 1, 20)).toMatchObject({ status: "DRAFT" });
    expect(queryOf({ ...NO_FILTERS, chip: "DRAFT" }, 1, 20)).not.toHaveProperty("expired");
    expect(queryOf({ ...NO_FILTERS, chip: "SENT" }, 1, 20)).toMatchObject({ status: "SENT", expired: "exclude" });
    expect(queryOf({ ...NO_FILTERS, chip: "APPROVED" }, 1, 20)).toMatchObject({ status: "APPROVED", expired: "exclude" });
    const expired = queryOf({ ...NO_FILTERS, chip: "EXPIRED" }, 1, 20);
    expect(expired).toMatchObject({ expired: "only" });
    expect(expired).not.toHaveProperty("status");
  });

  it("text, owner and dates are sent trimmed and only when set", () => {
    expect(queryOf({ q: "  Kij ", chip: "ALL", owner: "m1", validFrom: "2026-12-01", validTo: "" }, 2, 20)).toEqual({ page: "2", pageSize: "20", counts: "true", activity: "true", q: "Kij", owner: "m1", validFrom: "2026-12-01" });
  });

  it("never asks for or filters by a money value (rule 7)", () => {
    const keys = Object.keys(queryOf({ q: "x", chip: "SENT", owner: "m", validFrom: "2026-01-01", validTo: "2026-02-01" }, 1, 20)).join(" ");
    expect(keys).not.toMatch(/value|total|amount|margin|cost/i);
  });

  it("a saved view keeps the chip as its tab and gives it back; an unknown tab falls back to All", () => {
    const f = { q: "Kij", chip: "SENT" as const, owner: "m1", validFrom: "", validTo: "2026-12-31" };
    expect(fromViewState(toViewState(f))).toEqual(f);
    expect(fromViewState({ tab: "nonsense", filters: {} })).toEqual(NO_FILTERS);
  });
});

describe("the activity line and sharing rules (UC-R3, UC-R4)", () => {
  it("says only what was recorded", () => {
    expect(activityLines({ sentAt: null }, label)).toEqual([]);
    expect(activityLines({ sentAt: "2026-11-02T08:00:00Z" }, label)).toEqual(["Sent 2026-11-02"]);
    const a = { links: 2, activeLinks: 0, revokedLinks: 1, expiredLinks: 1, views: 1, lastViewedAt: "2026-11-05T09:00:00Z" };
    expect(activityLines({ sentAt: "2026-11-02T08:00:00Z", activity: a }, label)).toEqual(["Sent 2026-11-02", "Viewed 1 time, last 2026-11-05", "Link revoked"]);
    expect(activityLines({ sentAt: null, activity: { ...a, revokedLinks: 0, expiredLinks: 2, views: 0, lastViewedAt: null } }, label)).toEqual(["Link expired"]);
    expect(activityLines({ sentAt: null, activity: { ...a, activeLinks: 1 } }, label)).toEqual(["Viewed 1 time, last 2026-11-05"]);
  });

  it("allows sharing only for an approved or sent quote that is valid, visible and the role may send", () => {
    const ok = { status: "SENT", expired: false, amountMasked: false, mayShare: true };
    expect(shareBlockedReason(ok)).toBeNull();
    expect(shareBlockedReason({ ...ok, status: "APPROVED" })).toBeNull();
    expect(shareBlockedReason({ ...ok, status: "DRAFT" })).toMatch(/builder/);
    expect(shareBlockedReason({ ...ok, status: "PENDING_APPROVAL" })).toMatch(/approve/);
    expect(shareBlockedReason({ ...ok, status: "REJECTED" })).toMatch(/not approved/);
    expect(shareBlockedReason({ ...ok, status: "ACCEPTED" })).toMatch(/accepted/);
    expect(shareBlockedReason({ ...ok, expired: true })).toMatch(/validity/);
    expect(shareBlockedReason({ ...ok, amountMasked: true })).toMatch(/amounts/);
    expect(shareBlockedReason({ ...ok, mayShare: false })).toMatch(/not send/);
  });

  it("builds the WhatsApp click-to-chat address with the encoded link", () => {
    const url = whatsappUrl("Q-2026-0001", "https://crm.example/q/a b?x=1&y=2");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).not.toContain(" ");
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe("Here is quote Q-2026-0001: https://crm.example/q/a b?x=1&y=2");
  });
});
