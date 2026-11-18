import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "../../../../src/ui/screens/finance/PaymentsScreen";
import { apiError, page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/payments",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const FINANCE = ["finance.view.payments", "finance.manage.payments", "finance.followup.note", "companies.view"];
const READ_ONLY = ["finance.view.payments"];

function dealRow(over: Record<string, unknown> = {}) {
  return {
    dealId: "d1",
    companyId: "c1",
    companyName: "Brookside Dairy",
    serviceName: "Inventory",
    dealValue: "450000.00",
    currency: "KES",
    wonAt: "2026-10-01T10:00:00.000Z",
    invoiced: "450000.00",
    received: "150000.00",
    outstanding: "300000.00",
    invoiceCount: 2,
    overdueInvoices: 1,
    state: "OVERDUE",
    nextNote: { note: "Call accounts about invoice 2", ownerMembershipId: "m-1", nextOn: "2026-11-05T00:00:00.000Z" },
    ...over,
  };
}

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
    ...over,
  };
}

const TOTALS = { byStatus: { DRAFT: { count: 0, amount: "0.00", outstanding: "0.00" }, SENT: { count: 1, amount: "300000.00", outstanding: "300000.00" }, PART_PAID: { count: 0, amount: "0.00", outstanding: "0.00" }, PAID: { count: 1, amount: "150000.00", outstanding: "0.00" }, OVERDUE: { count: 0, amount: "0.00", outstanding: "0.00" }, VOID: { count: 0, amount: "0.00", outstanding: "0.00" } }, outstanding: "300000.00", nothingToCollect: false };

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    listWonDealPayments: () => page([dealRow(), dealRow({ dealId: "d2", companyName: "Karibu Hotel", state: "PAID_IN_FULL", outstanding: "0.00", received: "200000.00", invoiced: "200000.00", dealValue: "200000.00", overdueInvoices: 0, nextNote: null })]),
    getPaymentSummary: () => ({ dueThisWeek: { count: 2, outstanding: "50000.00" }, overdue: { count: 1, outstanding: "300000.00" }, collectedThisMonth: { count: 1, amount: "150000.00" }, outstanding: "350000.00", nothingToCollect: false }),
    listInvoices: ({ query }) => ({ ...page(query?.dealId ? [invoice()] : []), totals: TOTALS }),
    ...over,
  };
}

describe("Payments tracker (F3.06)", () => {
  it("shows the headline figures and one row per won deal for Finance", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE, roleName: "Finance" });
    expect(await screen.findByText("Brookside Dairy")).toBeInTheDocument();
    expect(screen.getByText("Karibu Hotel")).toBeInTheDocument();
    expect(within(screen.getByTestId("pay-kpi-overdue")).getByText("KES 300k")).toBeInTheDocument();
    expect(within(screen.getByTestId("pay-kpi-collected")).getByText("KES 150k")).toBeInTheDocument();
    expect(within(screen.getByTestId("pay-kpi-contracted")).getByText("KES 650k")).toBeInTheDocument();
    expect(within(screen.getByTestId("pay-deal-d1")).getByText("Overdue")).toBeInTheDocument();
    expect(within(screen.getByTestId("pay-deal-d2")).getByText("Paid in full")).toBeInTheDocument();
  });

  it("explains the absence to a role without payment permission and never asks the API for a figure", async () => {
    const { client, call } = stubClient(handlers());
    renderScreen(<PaymentsScreen />, client, { permissionKeys: ["deals.view.own", "companies.view"], roleName: "Sales" });
    expect(await screen.findByText(/Payments isn.t part of your workspace/)).toBeInTheDocument();
    expect(screen.getByText("Finance, Management")).toBeInTheDocument();
    expect(screen.queryByText("Brookside Dairy")).not.toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
  });

  it("shows the explained no-access state when the API refuses", async () => {
    const { client } = stubClient(handlers({ listWonDealPayments: () => apiError(403, "No", { denial: { yourRole: "Finance", ownerRoles: ["Management"], whoToAsk: ["Management"] } }) }));
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    expect(await screen.findByRole("region", { name: /payments/i })).toBeInTheDocument();
  });

  it("filters by status and by search", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    await screen.findByText("Brookside Dairy");
    await userEvent.click(screen.getByRole("tab", { name: /Paid in full/ }));
    expect(screen.queryByText("Brookside Dairy")).not.toBeInTheDocument();
    expect(screen.getByText("Karibu Hotel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^All/ }));
    await userEvent.type(screen.getByLabelText(/Search customer/), "brook");
    expect(screen.queryByText("Karibu Hotel")).not.toBeInTheDocument();
    expect(screen.getByText("Brookside Dairy")).toBeInTheDocument();
  });

  it("marks an invoice paid in full by recording the balance, then refreshes", async () => {
    const recorded: unknown[] = [];
    const { client, calls } = stubClient(handlers({ recordPayment: ({ body }) => (recorded.push(body), invoice({ status: "PAID", balance: "0.00" })) }));
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    await userEvent.click(await screen.findByRole("button", { name: /Brookside Dairy/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark INV-1001 paid in full" }));
    await waitFor(() => expect(recorded).toEqual([{ amount: "300000.00" }]));
    // The tracker and Customer 360 are stale after a payment: the lists are read again.
    await waitFor(() => expect(calls.filter((c) => c.id === "listWonDealPayments").length).toBeGreaterThan(1));
  });

  it("gives a read-only role the invoices without any way to change them", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<PaymentsScreen />, client, { permissionKeys: READ_ONLY });
    await userEvent.click(await screen.findByRole("button", { name: /Brookside Dairy/ }));
    expect(await screen.findByText("INV-1001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark .* paid in full/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /follow-up/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open INV-1001" })).toBeInTheDocument();
  });

  it("saves the next follow-up note on a won deal", async () => {
    const saved: unknown[] = [];
    const { client } = stubClient(handlers({ setDealPaymentNote: ({ body }) => (saved.push(body), { note: "x" }) }));
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    await userEvent.click(await screen.findByRole("button", { name: /Karibu Hotel/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Add payment follow-up/ }));
    await userEvent.type(screen.getByLabelText(/What happens next/), "Send statement");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([{ note: "Send statement", nextOn: null }]));
  });

  it("says plainly when no deal has been won", async () => {
    const { client } = stubClient(handlers({ listWonDealPayments: () => page([]) }));
    renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    expect(await screen.findByText(/No won deals yet/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { client } = stubClient(handlers());
    const { container } = renderScreen(<PaymentsScreen />, client, { permissionKeys: FINANCE });
    await userEvent.click(await screen.findByRole("button", { name: /Brookside Dairy/ }));
    await screen.findByText("INV-1001");
    expect(await violations(container)).toEqual([]);
  });
});
