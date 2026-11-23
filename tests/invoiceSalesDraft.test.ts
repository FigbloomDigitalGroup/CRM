import { describe, expect, it } from "vitest";
import { SALES_DRAFT_FIELDS, parseStoredSalesDraft, toSalesDraftView } from "../src/lib/invoiceSalesDraft";

describe("Sales draft invoice view (UC-R10, pure)", () => {
  it("is off unless the stored value says enabled: true", () => {
    for (const v of [undefined, null, {}, { enabled: false }, { enabled: "true" }, true, "x"]) expect(parseStoredSalesDraft(v)).toBe(false);
    expect(parseStoredSalesDraft({ enabled: true })).toBe(true);
  });

  it("keeps only the whitelisted fields and never carries payment, balance or overdue data", () => {
    const full = { id: "i", number: "INV-1", status: "PAID", storedStatus: "PAID", dealId: "d", companyId: "c", companyName: "Acme", amount: "100.00", currency: "KES", issuedOn: "x", dueOn: "y", notes: null, paymentTermsDays: 30, terms: null, createdAt: "z", paidAmount: "100.00", balance: "0.00", overpaid: "0.00", overdue: true, daysOverdue: 3, allowOverpayment: true, payments: [{ amount: "1" }], voidReason: "r" };
    const view = toSalesDraftView(full) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([...SALES_DRAFT_FIELDS, "salesDraftOnly"].sort());
    for (const k of ["paidAmount", "balance", "overpaid", "overdue", "daysOverdue", "payments", "storedStatus", "allowOverpayment", "voidReason"]) expect(view).not.toHaveProperty(k);
    expect(view.status).toBe("DRAFT");
    expect(JSON.stringify(view)).not.toMatch(/balance|overdue|paidAmount|"payments"/i);
  });
});
