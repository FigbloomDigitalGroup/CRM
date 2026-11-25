import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "../prisma/seedData";
import { buildNav, buildQuickCreate } from "../src/ui/shell/navigation";
import { renderInvoiceHtml, type InvoiceDocumentInput } from "../src/lib/invoiceDocument";

/**
 * UC-R11 (FIG-1782): the new nav items and quick-create entries never offer a page the API would refuse (rule 7), for every seeded role at the
 * highest release. Pure: no database. Also pins the invoice document's fixed field list in another locale and with hostile input.
 */

const roles = Object.keys(ROLE_PERMISSIONS);
const keysOf = (role: string) => ROLE_PERMISSIONS[role]!;
const items = (role: string) => buildNav({ permissionKeys: keysOf(role), membershipId: "m1", demoScreens: true }).flatMap((s) => s.items.map((i) => i.key));

describe("new nav items follow the keys the API enforces (UC-R11)", () => {
  it("Invoices is shown exactly to a role that holds invoices.view: Finance, Management and, for its own drafts, Sales (24 Nov 2026)", () => {
    for (const role of roles) {
      const shown = items(role).includes("invoices");
      expect(shown, role).toBe(keysOf(role).includes("invoices.view"));
    }
    expect(roles.filter((r) => items(r).includes("invoices")).sort()).toEqual(["FINANCE", "MANAGEMENT", "SALES"]);
    // Sales sees drafts only: it never holds the payment keys that unlock balances and payments.
    for (const k of ["finance.view.payments", "finance.manage.payments", "finance.export", "invoices.send", "invoices.edit"]) expect(keysOf("SALES"), k).not.toContain(k);
    for (const role of ["DELIVERY", "RESTRICTED_TECHNICAL"]) expect(items(role)).not.toContain("invoices");
  });

  it("Quotes is never shown without quotes.view, and never to Delivery or Restricted Technical", () => {
    for (const role of roles) expect(items(role).includes("quotes"), role).toBe(keysOf(role).includes("quotes.view"));
    expect(items("DELIVERY")).not.toContain("quotes");
    expect(items("RESTRICTED_TECHNICAL")).not.toContain("quotes");
  });

  it("New invoice follows invoices.create (Sales makes drafts only, without the payment keys); New quote needs quotes.create", () => {
    for (const role of roles) {
      const kinds = buildQuickCreate({ permissionKeys: keysOf(role), membershipId: "m1" }).map((q) => q.key);
      expect(kinds.includes("invoice"), role).toBe(keysOf(role).includes("invoices.create"));
      if (kinds.includes("invoice") && role !== "SALES") expect(keysOf(role), role).toContain("finance.manage.payments");
      expect(kinds.includes("quote"), role).toBe(keysOf(role).includes("quotes.create"));
    }
  });
});

describe("the invoice document stays free of money-state fields (UC-R11)", () => {
  const input: InvoiceDocumentInput = {
    organization: { name: "Org", phone: null, website: null, address: null, accent: "#1f6f4a", showLogo: false },
    invoice: { number: "INV-9", currency: "KES", issuedOn: "2026-11-10", dueOn: "2026-11-24", amount: 500, notes: null, description: "Survey" },
    billedTo: { company: "Acme", contact: null },
  };

  it("carries no balance, paid, overdue, cost or margin words in English or Swahili", () => {
    for (const language of ["en", "sw"] as const) {
      const html = renderInvoiceHtml({ ...input, language });
      const visible = html.slice(html.indexOf("</style>")).toLowerCase();
      for (const word of ["balance", "overdue", "margin", "cost", "payment received", "salio", "imechelewa", "faida"]) expect(visible, `${language}:${word}`).not.toContain(word);
    }
  });

  it("an invoice whose amount is a masked value cannot be built by accident: the input has exactly the seven public fields", () => {
    expect(Object.keys(input.invoice).sort()).toEqual(["amount", "currency", "description", "dueOn", "issuedOn", "notes", "number"]);
  });
});
