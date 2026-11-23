import { describe, expect, it } from "vitest";
import { cleanInvoicePrefix, dueDateFrom, formatInvoiceNumber, nextInvoiceSequence, parseStoredInvoiceNumbering } from "../src/lib/invoiceNumbering";

/** UC-R8 (FIG-1779): the pure numbering rules. No database. */
describe("invoice numbering rules (UC-R8)", () => {
  it("formats prefix plus a four-digit number", () => {
    expect(formatInvoiceNumber("INV-", 1)).toBe("INV-0001");
    expect(formatInvoiceNumber("FB/26/", 12345)).toBe("FB/26/12345");
  });

  it("starts at 1 and goes one past the highest number with the prefix, any case", () => {
    expect(nextInvoiceSequence("INV-", [])).toBe(1);
    expect(nextInvoiceSequence("INV-", ["INV-0001", "inv-0007", "INV-0003"])).toBe(8);
  });

  it("ignores numbers that do not fit the shape: other prefixes, non-digits, the bare prefix", () => {
    expect(nextInvoiceSequence("INV-", ["OLD-9000", "INV-ABC", "INV-12-A", "INV-", "INV-0004"])).toBe(5);
  });

  it("accepts only safe prefixes", () => {
    expect(cleanInvoicePrefix(" INV- ")).toBe("INV-");
    expect(cleanInvoicePrefix("FB/2026.")).toBe("FB/2026.");
    expect(cleanInvoicePrefix("")).toBeNull();
    expect(cleanInvoicePrefix("-X")).toBeNull();
    expect(cleanInvoicePrefix("A".repeat(21))).toBeNull();
    expect(cleanInvoicePrefix("IN V")).toBeNull();
    expect(cleanInvoicePrefix("INV%")).toBeNull();
    expect(cleanInvoicePrefix(5)).toBeNull();
  });

  it("reads a stored setting, and treats a damaged one as off with the default prefix", () => {
    expect(parseStoredInvoiceNumbering({ auto: true, prefix: "BILL-" })).toEqual({ auto: true, prefix: "BILL-" });
    expect(parseStoredInvoiceNumbering({ auto: "yes", prefix: "%%" })).toEqual({ auto: false, prefix: "INV-" });
    expect(parseStoredInvoiceNumbering(null)).toBeNull();
  });

  it("works out a due date from the issue date and the terms", () => {
    expect(dueDateFrom("2026-11-23", 0)).toBe("2026-11-23");
    expect(dueDateFrom("2026-11-23", 30)).toBe("2026-12-23");
    expect(dueDateFrom("2026-12-20", 30)).toBe("2027-01-19");
  });
});
