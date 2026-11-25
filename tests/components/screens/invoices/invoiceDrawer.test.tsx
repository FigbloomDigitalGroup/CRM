import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InvoiceDrawer } from "../../../../src/ui/screens/invoices/InvoiceDrawer";
import { apiError, renderScreen, stubClient } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/invoices",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const FINANCE = ["finance.view.payments", "finance.manage.payments", "invoices.view", "invoices.edit", "invoices.send", "payments.record"];
const VIEW_ONLY = ["finance.view.payments", "invoices.view"];

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    number: "INV-1001",
    status: "SENT",
    storedStatus: "SENT",
    dealId: "d1",
    companyId: "c1",
    companyName: "Brookside Dairy",
    amount: "300000.00",
    currency: "KES",
    paidAmount: "0.00",
    balance: "300000.00",
    overpaid: "0.00",
    overdue: false,
    daysOverdue: 0,
    issuedOn: "2026-10-20T00:00:00.000Z",
    dueOn: "2026-12-16T00:00:00.000Z",
    allowOverpayment: false,
    notes: null,
    voidReason: null,
    payments: [],
    ...over,
  };
}
const PAYMENT = { id: "p1", invoiceId: "i1", amount: "100000.00", paidOn: "2026-11-02T00:00:00.000Z", methodLabel: "M-Pesa", reference: "QJK4", reversed: false, reversedAt: null, reversalReason: null };

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return { getInvoice: () => invoice(), ...over };
}
const open = (client: ReturnType<typeof stubClient>["client"], keys: string[]) => renderScreen(<InvoiceDrawer invoiceId="i1" onClose={() => undefined} />, client, { permissionKeys: keys, roleName: "Finance" });

describe("Invoice drawer (UC-R9)", () => {
  it("records a full payment (the balance) with a method label, then refreshes", async () => {
    const recorded: unknown[] = [];
    const { client, calls } = stubClient(handlers({ recordPayment: ({ body }) => (recorded.push(body), invoice({ status: "PAID" })) }));
    open(client, FINANCE);
    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(recorded).toEqual([{ amount: "300000.00", methodLabel: "M-Pesa" }]));
    await waitFor(() => expect(calls.filter((c) => c.id === "getInvoice").length).toBeGreaterThan(1));
  });

  it("records a part payment and says what will remain", async () => {
    const recorded: unknown[] = [];
    const { client } = stubClient(handlers({ recordPayment: ({ body }) => (recorded.push(body), invoice()) }));
    open(client, FINANCE);
    await userEvent.type(await screen.findByLabelText("Amount received"), "100000");
    expect(screen.getByText(/Part payment: KES 200,000 will remain/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record part payment" }));
    await waitFor(() => expect(recorded).toEqual([{ amount: "100000", methodLabel: "M-Pesa" }]));
  });

  it("refuses an amount above the balance without calling the API", async () => {
    const { client, calls } = stubClient(handlers({ recordPayment: () => invoice() }));
    open(client, FINANCE);
    await userEvent.type(await screen.findByLabelText("Amount received"), "400000");
    expect(screen.getByText(/more than the balance/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(calls.some((c) => c.id === "recordPayment")).toBe(false);
  });

  it("reverses a payment only with a reason", async () => {
    const reversed: unknown[] = [];
    const { client } = stubClient(handlers({ getInvoice: () => invoice({ status: "PART_PAID", paidAmount: "100000.00", balance: "200000.00", payments: [PAYMENT] }), reversePayment: ({ params, body }) => (reversed.push({ params, body }), invoice()) }));
    open(client, FINANCE);
    await userEvent.click(await screen.findByRole("button", { name: /Reverse payment of KES 100,000/ }));
    const go = screen.getByRole("button", { name: "Reverse payment" });
    expect(go).toHaveAttribute("aria-disabled", "true");
    await userEvent.type(screen.getByLabelText(/Reason/), "Entered twice");
    await userEvent.click(screen.getByRole("button", { name: "Reverse payment" }));
    await waitFor(() => expect(reversed).toEqual([{ params: { orgSlug: "figbloom", paymentId: "p1" }, body: { reason: "Entered twice" } }]));
  });

  it("voids with a reason, and refuses while payments exist", async () => {
    const voided: unknown[] = [];
    const first = stubClient(handlers({ voidInvoice: ({ body }) => (voided.push(body), invoice({ status: "VOID" })) }));
    const { unmount } = open(first.client, FINANCE);
    await userEvent.click(await screen.findByRole("button", { name: "Void invoice" }));
    await userEvent.type(screen.getByLabelText(/Reason/), "Wrong customer");
    await userEvent.click(screen.getAllByRole("button", { name: "Void invoice" }).at(-1)!);
    await waitFor(() => expect(voided).toEqual([{ reason: "Wrong customer" }]));
    unmount();

    const second = stubClient(handlers({ getInvoice: () => invoice({ status: "PART_PAID", paidAmount: "100000.00", balance: "200000.00", payments: [PAYMENT] }) }));
    open(second.client, FINANCE);
    const btn = await screen.findByRole("button", { name: "Void invoice" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  it("marks a draft as sent, behind invoices.send", async () => {
    const sent: string[] = [];
    const { client } = stubClient(handlers({ getInvoice: () => invoice({ status: "DRAFT", storedStatus: "DRAFT" }), markInvoiceSent: ({ params }) => (sent.push(params!.invoiceId!), invoice()) }));
    open(client, FINANCE);
    await userEvent.click(await screen.findByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(sent).toEqual(["i1"]));
  });

  it("keeps the actions visible but unavailable, with a reason, for a role without the keys", async () => {
    const { client, calls } = stubClient(handlers({ getInvoice: () => invoice({ status: "DRAFT", storedStatus: "DRAFT" }) }));
    open(client, VIEW_ONLY);
    const send = await screen.findByRole("button", { name: "Mark as sent" });
    expect(send).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(send);
    expect(screen.getByRole("button", { name: "Void invoice" })).toHaveAttribute("aria-disabled", "true");
    expect(calls.some((c) => c.id === "markInvoiceSent")).toBe(false);
  });

  it("shows no record form without payments.record, and no reverse button works", async () => {
    const { client } = stubClient(handlers({ getInvoice: () => invoice({ status: "PART_PAID", paidAmount: "100000.00", balance: "200000.00", payments: [PAYMENT] }) }));
    open(client, VIEW_ONLY);
    expect(await screen.findByText(/needs the permission to record payments/, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount received")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reverse payment of/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the API's refusal in the drawer", async () => {
    const { client } = stubClient(handlers({ recordPayment: () => apiError(400, "Over", { message: "That is more than the invoice." }) }));
    open(client, FINANCE);
    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("never asks the API for an invoice, and says why, for a role without finance.view.payments", async () => {
    const { client, call } = stubClient(handlers());
    open(client, ["invoices.view"]);
    expect(await screen.findByTestId("drawer-masked")).toHaveTextContent(/hidden for your role/);
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument();
  });

  it("shows a void invoice with its reason and no actions to pay it", async () => {
    const { client } = stubClient(handlers({ getInvoice: () => invoice({ status: "VOID", storedStatus: "VOID", voidReason: "Wrong customer" }) }));
    open(client, FINANCE);
    expect(await screen.findByText("Wrong customer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void invoice" })).not.toBeInTheDocument();
  });
});
