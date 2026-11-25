import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InvoicesScreen } from "../../../../src/ui/screens/invoices/InvoicesScreen";
import { AGEING_KEYS, barShare, listQuery, NO_FILTERS, statusForBucket } from "../../../../src/ui/screens/invoices/model";
import { apiError, page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/invoices",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// What UC-R1 gives each role (docs/QUOTE_INVOICE_PERMISSIONS.md): Finance and Management hold all of these.
const FINANCE = ["finance.view.payments", "finance.manage.payments", "invoices.view", "invoices.create", "invoices.edit", "invoices.send", "payments.record", "finance.export", "companies.view"];
const VIEW_ONLY = ["finance.view.payments", "invoices.view"];
const NO_FIGURES = ["invoices.view"];
const SALES = ["deals.view.own", "companies.view"];

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    number: "INV-1001",
    status: "OVERDUE",
    storedStatus: "SENT",
    dealId: "d1",
    companyId: "c1",
    companyName: "Brookside Dairy",
    amount: "300000.00",
    currency: "KES",
    paidAmount: "0.00",
    balance: "300000.00",
    overpaid: "0.00",
    overdue: true,
    daysOverdue: 12,
    issuedOn: "2026-09-20T00:00:00.000Z",
    dueOn: "2026-10-16T00:00:00.000Z",
    allowOverpayment: false,
    notes: "Deposit",
    payments: [],
    ...over,
  };
}

const ZERO = { count: 0, amount: "0.00", outstanding: "0.00" };
const TOTALS = {
  byStatus: { DRAFT: { ...ZERO, count: 2 }, SENT: { count: 1, amount: "100000.00", outstanding: "100000.00" }, PART_PAID: ZERO, PAID: { count: 3, amount: "90000.00", outstanding: "0.00" }, OVERDUE: { count: 1, amount: "300000.00", outstanding: "300000.00" }, VOID: ZERO },
  outstanding: "400000.00",
  nothingToCollect: false,
  ageing: {
    current: { count: 1, outstanding: "100000.00" },
    d1_30: { count: 1, outstanding: "300000.00" },
    d31_60: { count: 0, outstanding: "0.00" },
    d61_90: { count: 0, outstanding: "0.00" },
    d90_plus: { count: 0, outstanding: "0.00" },
  },
};

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    listInvoices: () => ({ ...page([invoice(), invoice({ id: "i2", number: "INV-1002", companyName: "Karibu Hotel", status: "PAID", overdue: false, daysOverdue: 0, balance: "0.00", paidAmount: "90000.00", amount: "90000.00" })]), totals: TOTALS }),
    ...over,
  };
}

describe("Invoices page (UC-R7)", () => {
  it("lists invoices with status, due date, amount and balance, and the ageing strip, for Finance", async () => {
    const { client } = stubClient(handlers());
    const { container } = renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE, roleName: "Finance" });
    expect(await screen.findByText("Brookside Dairy")).toBeInTheDocument();
    expect(screen.getByText("Karibu Hotel")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Invoices/ });
    expect(within(table).getByText("12d late", { exact: false })).toBeInTheDocument();
    expect(within(table).getAllByText("KES 300,000").length).toBeGreaterThan(0);
    const strip = screen.getByTestId("inv-ageing");
    expect(within(strip).getByText("KES 400,000 outstanding")).toBeInTheDocument();
    expect(within(strip).getByText("KES 300k")).toBeInTheDocument();
    expect(within(strip).getByText("KES 100k")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("shows the status chips with counts and asks the API for the chosen status", async () => {
    const { client, calls } = stubClient(handlers());
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    expect(screen.getByRole("tab", { name: /Draft\s*2/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Overdue/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listInvoices" && c.args.query?.status === "OVERDUE")).toBe(true));
  });

  it("clicking an ageing bucket filters to its invoices", async () => {
    const { client, calls } = stubClient(handlers());
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    await userEvent.click(screen.getByRole("button", { name: "Show 1–30 days invoices" }));
    await waitFor(() => expect(calls.some((c) => c.args.query?.status === "OVERDUE")).toBe(true));
  });

  it("sends search, due-date, amount and still-owed filters as query params", async () => {
    const { client, calls } = stubClient(handlers());
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    await userEvent.type(screen.getByLabelText(/Search invoice number/), "brook");
    await userEvent.type(screen.getByLabelText("Amount from"), "1000");
    await userEvent.click(screen.getByLabelText("Still owed only"));
    await waitFor(() => {
      const last = calls.filter((c) => c.id === "listInvoices").at(-1)!.args.query!;
      expect(last).toMatchObject({ q: "brook", amountMin: "1000", hasBalance: "true" });
    });
  });

  it("offers the CSV export only with finance.export, carrying the filters", async () => {
    const { client } = stubClient(handlers());
    const { unmount } = renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/orgs/figbloom/invoices/export");
    unmount();
    const second = stubClient(handlers());
    renderScreen(<InvoicesScreen />, second.client, { permissionKeys: VIEW_ONLY });
    await screen.findByText("Brookside Dairy");
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("shows the loading state, then the empty state with a place for New invoice", async () => {
    const { client } = stubClient(handlers({ listInvoices: () => ({ ...page([]), totals: { ...TOTALS, byStatus: {}, ageing: {} } }) }));
    renderScreen(<InvoicesScreen newInvoiceSlot={<button type="button">New invoice</button>} />, client, { permissionKeys: FINANCE });
    expect(await screen.findByText("No invoices yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New invoice" }).length).toBeGreaterThan(0);
  });

  it("says nothing matches when filters leave no rows, and clears them", async () => {
    let empty = false;
    const { client } = stubClient(handlers({ listInvoices: () => (empty ? { ...page([]), totals: TOTALS } : { ...page([invoice()]), totals: TOTALS }) }));
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    empty = true;
    await userEvent.click(screen.getByLabelText("Still owed only"));
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("shows the explained no-access state to a role without invoices.view and never asks the API", async () => {
    const { client, call } = stubClient(handlers());
    renderScreen(<InvoicesScreen />, client, { permissionKeys: SALES, roleName: "Sales" });
    expect(await screen.findByText(/Invoices isn.t part of your workspace/)).toBeInTheDocument();
    expect(screen.getByText("Finance, Management")).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByTestId("inv-ageing")).not.toBeInTheDocument();
  });

  it("masks balances, ageing and payments for a role with invoices.view but not finance.view.payments", async () => {
    const { client, call } = stubClient(handlers());
    renderScreen(<InvoicesScreen />, client, { permissionKeys: NO_FIGURES, roleName: "Custom" });
    expect(await screen.findByTestId("inv-masked")).toHaveTextContent(/visible to Finance and Management/);
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("inv-ageing")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("shows the explained no-access state when the API refuses", async () => {
    const { client } = stubClient(handlers({ listInvoices: () => apiError(403, "No", { denial: { yourRole: "Finance", ownerRoles: ["Management"], whoToAsk: ["Management"] } }) }));
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    expect(await screen.findByRole("region", { name: /invoices/i })).toBeInTheDocument();
  });

  it("shows an error with retry when the list fails", async () => {
    const { client } = stubClient(handlers({ listInvoices: () => apiError(500, "Boom") }));
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("opens the invoice drawer from a row", async () => {
    const { client } = stubClient(handlers({ getInvoice: () => invoice() }));
    renderScreen(<InvoicesScreen />, client, { permissionKeys: FINANCE });
    await userEvent.click(await screen.findByRole("button", { name: "Open INV-1001" }));
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Invoice INV-1001" })).toBeInTheDocument();
  });
});

describe("Invoices page rules", () => {
  it("sizes the ageing bar from money and keeps a sliver for a small bucket", () => {
    expect(barShare({}, "current")).toBe(0);
    const a = { current: { count: 1, outstanding: "1.00" }, d1_30: { count: 1, outstanding: "9999.00" } };
    expect(barShare(a, "current")).toBe(4);
    expect(barShare(a, "d1_30")).toBeGreaterThan(90);
    expect(AGEING_KEYS).toHaveLength(5);
  });

  it("maps buckets to the status the API filters on", () => {
    expect(statusForBucket("current")).toBe("SENT");
    expect(statusForBucket("d90_plus")).toBe("OVERDUE");
  });

  it("builds only the params that are set", () => {
    expect(listQuery(NO_FILTERS)).toEqual({ page: "1", pageSize: "25" });
    expect(listQuery({ ...NO_FILTERS, status: "PAID", amountMax: " 5000 ", hasBalance: true, sort: { key: "dueOn", dir: "desc" } })).toEqual({ status: "PAID", amountMax: "5000", hasBalance: "true", page: "1", pageSize: "25", sort: "-dueOn" });
  });
});
