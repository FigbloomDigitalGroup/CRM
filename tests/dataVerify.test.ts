import { describe, expect, it } from "vitest";
import {
  compareCheck,
  diffFingerprints,
  evaluateCustomFields,
  evaluateDuplicates,
  evaluateFiles,
  evaluateFinancials,
  evaluateRelations,
  flattenCustomFields,
  flattenFinancials,
  formatChecks,
  type FileCounts,
  type FinancialSnapshot,
  type ForeignKeyState,
} from "../scripts/lib/dataVerify";

// UC-F7: the pure evaluators behind the verify-* commands (architecture doc 18.5). Each one must be able to FAIL, and an empty or partial
// database must never pass for a complete one.

const fk = (over: Partial<ForeignKeyState> = {}): ForeignKeyState => ({
  name: "deals_company_fk",
  child: "deals",
  parent: "companies",
  childColumns: ["organization_id", "company_id"],
  parentColumns: ["organization_id", "id"],
  validated: true,
  orphans: 0,
  ...over,
});

describe("verify-relations (UC-F7)", () => {
  it("passes when every key is validated and nothing is orphaned", () => {
    const r = evaluateRelations([fk(), fk({ name: "other", childColumns: ["a"], parentColumns: ["id"] })], true);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "Foreign keys found")?.detail).toContain("1 of them composite");
  });

  it("fails on an orphan row and names the key and the count", () => {
    const r = evaluateRelations([fk({ orphans: 3 })], true);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "Zero orphan rows")?.detail).toContain("deals.deals_company_fk (3)");
  });

  it("fails on a key that was never validated (NOT VALID may hold orphans)", () => {
    expect(evaluateRelations([fk({ validated: false })], true).ok).toBe(false);
  });

  it("fails when no foreign key is found at all: an empty database must not pass", () => {
    expect(evaluateRelations([], true).ok).toBe(false);
  });

  it("fails when the owner connection does not bypass row-level security (every count would be partial)", () => {
    expect(evaluateRelations([fk()], false).ok).toBe(false);
  });
});

describe("fingerprints (UC-F7)", () => {
  it("diffs changed, missing and new values and prints keys, not values", () => {
    const d = diffFingerprints({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" });
    expect(d).toEqual({ changed: ["b"], missing: ["c"], added: ["d"] });
  });

  it("is skipped, not passed, when there is nothing to compare with", () => {
    const c = compareCheck("x", undefined, { a: "1" }, "financial");
    expect(c.skipped).toBe(true);
    expect(c.ok).toBe(true);
  });

  it("fails on one changed value and passes when identical", () => {
    expect(compareCheck("x", { a: "1" }, { a: "2" }, "t").ok).toBe(false);
    expect(compareCheck("x", { a: "1" }, { a: "1" }, "t").ok).toBe(true);
  });
});

const group = {
  invoices: 2,
  invoicesVoid: 1,
  invoiceAmount: "1000.00",
  invoiceAmountVoid: "500.00",
  payments: 2,
  paymentAmount: "400.00",
  paymentsReversed: 1,
  paymentAmountReversed: "100.00",
  outstanding: "600.00",
  quoteVersions: 1,
  quoteTotal: "250.00",
  dealsOpen: 1,
  dealValueOpen: "540000.00",
  dealsWon: 0,
  dealValueWon: "0.00",
  dealsLost: 0,
  dealValueLost: "0.00",
};
const clean = { negativeInvoices: 0, negativePayments: 0, negativeQuoteTotals: 0, paymentsWithoutInvoice: 0, paidButOutstanding: 0, overpaid: 0, quoteSubtotalMismatch: 0 };
const snap = (over: Partial<FinancialSnapshot> = {}): FinancialSnapshot => ({
  groups: { "org-1|KES": { ...group } },
  tableHashes: { invoices: { "org-1": { rows: 2, hash: "aaa" } }, deals: { "org-1": { rows: 1, hash: "bbb" } } },
  inconsistencies: { ...clean },
  ...over,
});

describe("verify-financials (UC-F7)", () => {
  it("passes a consistent snapshot and says every row is hashed", () => {
    const r = evaluateFinancials(snap(), true);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "Money tables hashed in full")?.detail).toContain("every row in the hash (not a sample)");
  });

  it.each([
    ["negativeInvoices", "negative amount"],
    ["negativePayments", "negative amount"],
    ["paymentsWithoutInvoice", "no invoice"],
    ["paidButOutstanding", "still outstanding"],
    ["overpaid", "overpayment"],
    ["quoteSubtotalMismatch", "subtotal"],
    ["negativeQuoteTotals", "negative total"],
  ] as const)("fails on %s", (field, words) => {
    const r = evaluateFinancials(snap({ inconsistencies: { ...clean, [field]: 2 } }), true);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "Money is internally consistent")?.detail).toContain(words);
  });

  it("proves equality with the other side, and fails on a single cent", () => {
    const before = flattenFinancials(snap());
    expect(evaluateFinancials(snap(), true, before).ok).toBe(true);
    const moved = snap({ groups: { "org-1|KES": { ...group, invoiceAmount: "1000.01" } } });
    const r = evaluateFinancials(moved, true, before);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.startsWith("Totals"))?.detail).toContain("invoiceAmount");
  });

  it("fails when one row of a money table changed even if every total is the same (the hash)", () => {
    const before = flattenFinancials(snap());
    const r = evaluateFinancials(snap({ tableHashes: { invoices: { "org-1": { rows: 2, hash: "zzz" } }, deals: { "org-1": { rows: 1, hash: "bbb" } } } }), true, before);
    expect(r.ok).toBe(false);
  });

  it("fails when a whole organisation or table is missing on one side", () => {
    const before = flattenFinancials(snap());
    expect(evaluateFinancials(snap({ groups: {} }), true, before).ok).toBe(false);
    expect(evaluateFinancials(snap({ tableHashes: {} }), true, before).ok).toBe(false);
  });
});

const files = (over: Partial<FileCounts> = {}): FileCounts => ({
  expected: 10, present: 10, missing: 0, sizeMismatch: 0, checksumChecked: 10, checksumMismatch: 0, noChecksum: 0,
  skippedUploading: 1, skippedPurged: 2, orphanObjects: 0, objectsScanned: 10, ...over,
});

describe("verify-files (UC-F7)", () => {
  it("passes when every object is present, the right size, with a matching checksum", () => {
    expect(evaluateFiles(files(), { driver: "local" }).ok).toBe(true);
  });

  it("fails on a missing object, a wrong size, a wrong checksum", () => {
    expect(evaluateFiles(files({ missing: 1, present: 9 }), { driver: "local" }).ok).toBe(false);
    expect(evaluateFiles(files({ sizeMismatch: 1 }), { driver: "local" }).ok).toBe(false);
    expect(evaluateFiles(files({ checksumMismatch: 1 }), { driver: "local" }).ok).toBe(false);
  });

  it("reports orphan objects without failing, and fails on them with --fail-on-orphans", () => {
    const withOrphans = files({ orphanObjects: 4, objectsScanned: 14 });
    expect(evaluateFiles(withOrphans, { driver: "local" }).ok).toBe(true);
    expect(evaluateFiles(withOrphans, { driver: "local", failOnOrphans: true }).ok).toBe(false);
  });

  it("does not pass for a driver it cannot inspect", () => {
    expect(evaluateFiles(files(), { driver: "s3" }).ok).toBe(false);
  });
});

describe("verify-duplicates (UC-F7)", () => {
  const none = [{ check: "user emails", duplicateKeys: 0 }];

  it("passes when nothing repeats and every index is valid", () => {
    expect(evaluateDuplicates(none, [], [], true).ok).toBe(true);
  });

  it("fails on a repeated natural key and on an invalid index", () => {
    expect(evaluateDuplicates([{ check: "user emails", duplicateKeys: 2 }], [], [], true).ok).toBe(false);
    expect(evaluateDuplicates(none, ["leads_email_key"], [], true).ok).toBe(false);
  });

  it("FAILS when a table is missing (a restore that lost it), and skips only an optional later-release table", () => {
    expect(evaluateDuplicates([{ check: "invoice numbers", duplicateKeys: 0, tableMissing: true }], [], [], true).ok).toBe(false);
    const later = evaluateDuplicates([{ check: "later", duplicateKeys: 0, tableMissing: true, optional: true }], [], [], true);
    expect(later.ok).toBe(true);
    expect(later.checks.find((c) => c.name === "No duplicate later")?.skipped).toBe(true);
  });

  it("does not pass silently once attribution tables exist but their keys are not known", () => {
    expect(evaluateDuplicates(none, [], ["attribution_entries"], true).ok).toBe(false);
  });
});

describe("verify-custom-fields (UC-F7)", () => {
  const state = { definitions: 2, orphanKeys: 0, values: { d1: { entity: "DEAL", key: "site", rows: 3, hash: "h1" }, d2: { entity: "LEAD", key: "size", rows: 0, hash: "" } } };

  it("passes and counts definitions with values", () => {
    const r = evaluateCustomFields(state, true);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name.startsWith("Custom-field values"))?.detail).toContain("2 definitions, 1 with at least one value");
  });

  it("fails on a value whose key has no definition", () => {
    expect(evaluateCustomFields({ ...state, orphanKeys: 1 }, true).ok).toBe(false);
  });

  it("proves equality per definition and fails on one changed hash or count", () => {
    const before = flattenCustomFields(state);
    expect(evaluateCustomFields(state, true, before).ok).toBe(true);
    expect(evaluateCustomFields({ ...state, values: { ...state.values, d1: { ...state.values.d1, hash: "other" } } }, true, before).ok).toBe(false);
    expect(evaluateCustomFields({ ...state, values: { ...state.values, d1: { ...state.values.d1, rows: 2 } } }, true, before).ok).toBe(false);
  });
});

describe("report text (UC-F7)", () => {
  it("never carries a connection string and shows SKIP for a skipped check", () => {
    const r = evaluateDuplicates([{ check: "x", duplicateKeys: 0 }], [], [], true);
    const text = formatChecks("Title", r, "9 things");
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).toContain("SKIP  No duplicate attribution rows");
    expect(text).toContain("9 things");
  });
});
