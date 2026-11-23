import { describe, expect, it } from "vitest";
import { renderInvoiceHtml, type InvoiceDocumentInput } from "../src/lib/invoiceDocument";
import { renderQuoteHtml, type QuoteDocumentInput } from "../src/lib/quoteDocument";

/** UC-R6: the print rules, the shared page for quotes and invoices, and what an invoice document can never carry. */

const ORG = { name: "Figbloom Digital", phone: "+254 700 000 000", website: "https://figbloom.example", address: "Nairobi", accent: "#1f6f4a", showLogo: false };
const LONG_TERMS = Array.from({ length: 40 }, (_, i) => `Term ${i + 1}: payment is due within fourteen days of the invoice date.`).join("\n");

const QUOTE: QuoteDocumentInput = {
  organization: ORG,
  quote: {
    number: "Q-2026-0001",
    version: 1,
    currency: "KES",
    issuedOn: "2026-11-04",
    validUntil: "2026-12-04",
    terms: LONG_TERMS,
    discountPercent: 10,
    subtotal: 1000,
    discountAmount: 100,
    total: 1044,
    tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT", amount: 144 },
    lines: [{ description: "Site survey", unit: "visit", quantity: 1, unitPrice: 1000, lineTotal: 1000, taxable: true }],
  },
  preparedFor: { company: "Acme Ltd", contact: "Jo Wanjiru" },
  preparedBy: "Ruth Kibet",
};

const INVOICE: InvoiceDocumentInput = {
  organization: ORG,
  invoice: { number: "INV-0001", currency: "KES", issuedOn: "2026-11-10", dueOn: "2026-11-24", amount: 1160, notes: LONG_TERMS, description: "Site survey" },
  billedTo: { company: "Acme Ltd", contact: "Jo Wanjiru" },
};

describe("print rules (UC-R6)", () => {
  for (const [name, html] of [["quote", renderQuoteHtml(QUOTE)], ["invoice", renderInvoiceHtml(INVOICE)]] as const) {
    it(`the ${name} prints on A4 with repeating headers and no split rows`, () => {
      expect(html).toContain("@page{size:A4;");
      expect(html).toContain("thead{display:table-header-group}");
      expect(html).toContain("break-inside:avoid");
      expect(html).toContain("print-color-adjust:exact");
    });

    it(`the ${name} carries no script and no print button of its own`, () => {
      expect(html).not.toContain("<script");
      expect(html).not.toContain("printbar");
    });
  }

  it("keeps a long terms block in the document, escaped", () => {
    expect(renderQuoteHtml({ ...QUOTE, quote: { ...QUOTE.quote, terms: "<script>x</script>" } })).not.toContain("<script>x</script>");
    expect(renderQuoteHtml(QUOTE)).toContain("Term 40:");
  });

  it("the quote still shows discount and tax rows", () => {
    const html = renderQuoteHtml(QUOTE);
    expect(html).toContain("Discount (10%)");
    expect(html).toContain("VAT (16%)");
  });

  it("is available in Swahili", () => {
    const sw = renderInvoiceHtml({ ...INVOICE, language: "sw" });
    expect(sw).toContain("Ankara INV-0001");
    expect(sw).toContain("Imetozwa kwa");
    expect(sw).toContain('lang="sw"');
  });
});

describe("the invoice document", () => {
  const html = renderInvoiceHtml(INVOICE);

  it("shows the number, customer, dates and amount", () => {
    expect(html).toContain("Invoice INV-0001");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("1,160.00");
  });

  it("has no place for payments, balance, overdue state, cost or margin", () => {
    const visible = html.slice(html.indexOf("</style>")).toLowerCase();
    for (const word of ["balance", "paid", "payment received", "overdue", "margin", "cost"]) expect(visible).not.toContain(word);
    // Not even by accident: the input type has no such fields.
    expect(Object.keys(INVOICE.invoice).sort()).toEqual(["amount", "currency", "description", "dueOn", "issuedOn", "notes", "number"]);
  });

  it("escapes everything it prints", () => {
    const evil = renderInvoiceHtml({ ...INVOICE, billedTo: { company: "<img src=x onerror=alert(1)>", contact: null }, invoice: { ...INVOICE.invoice, notes: "<b>hi</b>" } });
    expect(evil).not.toContain("<img src=x");
    expect(evil).not.toContain("<b>hi</b>");
  });
});
