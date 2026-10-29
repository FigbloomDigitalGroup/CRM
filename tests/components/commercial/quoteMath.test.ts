import { describe, expect, it } from "vitest";
import { catalogue } from "../../../src/ui/screens/commercial/demo/data";
import { clampDiscount, formatKesShort, freezePrices, isLocked, needsApproval, newVersion, quoteTotals, type QuoteDoc } from "../../../src/ui/screens/commercial/quoteMath";

const lines = [
  { cat: "cat1", qty: 12 }, // 18,500 x 12 = 222,000 (cost 132,000)
  { cat: "cat2", qty: 1 }, // 65,000 (cost 42,000)
];

describe("quote totals (FIG-1168)", () => {
  it("adds the lines, takes the discount off, and works the margin on what the client pays", () => {
    const t = quoteTotals(lines, catalogue, 10);
    expect(t.subtotal).toBe(287_000);
    expect(t.discount).toBe(28_700);
    expect(t.total).toBe(258_300);
    expect(t.cost).toBe(174_000);
    expect(t.marginPct).toBe(33); // (258,300 - 174,000) / 258,300
  });

  it("ignores a line whose catalogue item is gone and never divides by zero", () => {
    const t = quoteTotals([{ cat: "gone", qty: 3 }], catalogue, 0);
    expect(t).toMatchObject({ subtotal: 0, total: 0, marginPct: 0 });
  });

  it("keeps the discount between 0 and 30 and treats nonsense as 0", () => {
    expect(clampDiscount(45)).toBe(30);
    expect(clampDiscount(-3)).toBe(0);
    expect(clampDiscount(Number.NaN)).toBe(0);
    expect(quoteTotals(lines, catalogue, 99).discount).toBe(Math.round(287_000 * 0.3));
  });

  it("uses a price frozen on the line, so a later catalogue change never alters a sent quote", () => {
    const frozen = freezePrices(lines, catalogue);
    const repriced = catalogue.map((c) => (c.id === "cat1" ? { ...c, price: 99_999 } : c));
    expect(quoteTotals(frozen, repriced, 0).subtotal).toBe(287_000);
    expect(quoteTotals(lines, repriced, 0).subtotal).toBe(99_999 * 12 + 65_000);
  });
});

describe("approval and locking", () => {
  it("a discount above the limit needs approval until it is approved; at the limit it does not", () => {
    expect(needsApproval(5, "Draft")).toBe(false);
    expect(needsApproval(5.5, "Draft")).toBe(true);
    expect(needsApproval(8, "Approved")).toBe(false);
    expect(needsApproval(8, "Draft", 10)).toBe(false);
  });

  it("sent, signed and waiting versions are locked; drafts and approved ones are not", () => {
    expect(["Sent", "Signed", "Pending approval"].every((s) => isLocked(s as never))).toBe(true);
    expect(isLocked("Draft")).toBe(false);
    expect(isLocked("Approved")).toBe(false);
  });
});

describe("versions are immutable", () => {
  const sent: QuoteDoc = {
    id: "q",
    dealId: "d",
    no: "Q-1",
    version: 1,
    status: "Sent",
    lines: freezePrices(lines, catalogue),
    discount: 0,
    validUntil: "2026-12-01",
    terms: "t",
    history: [{ v: 1, by: "a", at: "2026-10-01", note: "Sent" }],
    signer: "x",
    signedAt: "2026-10-02",
  };

  it("a new version is a fresh draft with the next number, and the sent one is left exactly as it was", () => {
    const before = JSON.stringify(sent);
    const next = newVersion(sent, "Dev Sales", "2026-10-03");
    expect(JSON.stringify(sent)).toBe(before);
    expect(next).toMatchObject({ version: 2, status: "Draft", signer: undefined, signedAt: undefined });
    expect(next.lines.every((l) => l.price === undefined)).toBe(true); // re-priced from the catalogue
    expect(next.history).toHaveLength(2);
    expect(next.history.at(-1)?.note).toBe("New version from v1");
    expect(next.lines).not.toBe(sent.lines);
  });
});

describe("money wording", () => {
  it("writes short amounts the way the forecast shows them", () => {
    expect(formatKesShort(1_500_000)).toBe("KES 1.5M");
    expect(formatKesShort(540_000)).toBe("KES 540K");
    expect(formatKesShort(950)).toBe("KES 950");
  });
});
