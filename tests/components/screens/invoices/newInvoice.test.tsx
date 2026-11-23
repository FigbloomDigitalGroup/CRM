import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewInvoiceDialog } from "../../../../src/ui/screens/invoices/NewInvoiceDialog";
import { NewInvoiceButton } from "../../../../src/ui/screens/invoices/NewInvoiceButton";
import { applyChange, newDraft, toBody, validateDraft } from "../../../../src/ui/screens/invoices/newInvoiceModel";
import { apiError, page, renderScreen, stubClient } from "../deals/harness";
import type { Handler } from "../deals/harness";

let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/invoices",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const FINANCE = ["finance.view.payments", "finance.manage.payments", "invoices.view", "invoices.create", "companies.view"];
const FROM = { companyId: "c1", companyName: "Brookside Dairy", dealId: "d1", amount: "300000" };

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    getCompanies: () => page([{ id: "c1", name: "Brookside Dairy" }]),
    getDeals: () => page([{ id: "d1", notes: "Dairy cooling", service: { name: "Cooling" } }]),
    createInvoice: () => ({ id: "i1", number: "INV-0001" }),
    ...over,
  };
}

describe("new invoice model (UC-R8)", () => {
  it("suggests the due date from the issue date and the terms, and a hand-typed due date frees the terms", () => {
    const d = newDraft("2026-11-23");
    expect(d.dueOn).toBe("2026-12-23");
    expect(applyChange(d, { termsDays: "7" }).dueOn).toBe("2026-11-30");
    expect(applyChange(d, { issuedOn: "2026-12-01" }).dueOn).toBe("2026-12-31");
    const manual = applyChange(d, { dueOn: "2027-01-15" });
    expect(manual).toMatchObject({ dueOn: "2027-01-15", termsDays: "" });
    expect(applyChange(manual, { issuedOn: "2026-12-01" }).dueOn).toBe("2027-01-15");
  });

  it("validates amount, dates and the customer", () => {
    const d = newDraft("2026-11-23");
    expect(Object.keys(validateDraft(d, true, false)).sort()).toEqual(["amount", "customer"]);
    expect(validateDraft({ ...d, amount: "1250.50" }, true, true)).toEqual({});
    expect(validateDraft({ ...d, amount: "12.345" }, true, true).amount).toBeDefined();
    expect(validateDraft({ ...d, amount: "10", dueOn: "2026-11-01" }, true, true).dueOn).toBeDefined();
  });

  it("leaves the number out when blank and sends the terms days only when chosen", () => {
    const d = { ...newDraft("2026-11-23"), amount: "100" };
    expect(toBody(d, { companyId: "c1" })).toEqual({ amount: "100", issuedOn: "2026-11-23", dueOn: "2026-12-23", paymentTermsDays: 30, companyId: "c1" });
    expect(toBody({ ...d, number: " X-1 ", termsDays: "", terms: " Net " }, { companyId: "c1", dealId: "d1" })).toEqual({
      number: "X-1", amount: "100", issuedOn: "2026-11-23", dueOn: "2026-12-23", terms: "Net", dealId: "d1", companyId: "c1",
    });
  });
});

describe("New invoice dialog (UC-R8)", () => {
  it("creates from a won deal with the deal's own company and amount, one idempotency key, no number typed", async () => {
    const calls: { body: unknown; key: unknown }[] = [];
    const onCreated = vi.fn();
    const { client } = stubClient(handlers({ createInvoice: (args) => (calls.push({ body: args.body, key: (args as { idempotencyKey?: string }).idempotencyKey }), { id: "i1", number: "INV-0001" }) }));
    renderScreen(<NewInvoiceDialog from={FROM} onClose={() => undefined} onCreated={onCreated} />, client, { permissionKeys: FINANCE });
    expect(screen.getByText("Brookside Dairy")).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toHaveValue("300000");
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ amount: "300000", dealId: "d1", companyId: "c1", paymentTermsDays: 30 });
    expect(body).not.toHaveProperty("number");
    expect(typeof calls[0]!.key).toBe("string");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("i1"));
  });

  it("creates for a customer picked from the search, optionally linked to a won deal", async () => {
    const bodies: unknown[] = [];
    const { client } = stubClient(handlers({ createInvoice: ({ body }) => (bodies.push(body), { id: "i2", number: "X" }) }));
    renderScreen(<NewInvoiceDialog onClose={() => undefined} />, client, { permissionKeys: FINANCE });
    await userEvent.click(await screen.findByRole("button", { name: "Brookside Dairy" }));
    await userEvent.selectOptions(await screen.findByLabelText("Won deal (optional)"), "d1");
    await userEvent.type(screen.getByLabelText("Invoice number"), "MAN-1");
    await userEvent.type(screen.getByLabelText(/Amount/), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ number: "MAN-1", amount: "5000", companyId: "c1", dealId: "d1" });
  });

  it("does not call the API without a customer or an amount, and says what is missing", async () => {
    const { client, calls } = stubClient(handlers());
    renderScreen(<NewInvoiceDialog onClose={() => undefined} />, client, { permissionKeys: FINANCE });
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(await screen.findByText("Choose the customer this invoice is for.")).toBeInTheDocument();
    expect(calls.some((c) => c.id === "createInvoice")).toBe(false);
  });

  it("shows the API's reason (DEAL_NOT_WON, NUMBER_REQUIRED) and keeps the form", async () => {
    const { client } = stubClient(handlers({ createInvoice: () => apiError(422, "This deal is not won yet.", { code: "DEAL_NOT_WON" }) }));
    renderScreen(<NewInvoiceDialog from={FROM} onClose={() => undefined} />, client, { permissionKeys: FINANCE });
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not won|could not/i);
    expect(screen.getByLabelText(/Amount/)).toHaveValue("300000");
  });

  it("explains a refusal for a role without the permission", async () => {
    const { client } = stubClient(handlers({ createInvoice: () => apiError(403, "Forbidden") }));
    renderScreen(<NewInvoiceDialog from={FROM} onClose={() => undefined} />, client, { permissionKeys: FINANCE });
    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot create invoices");
  });
});

describe("New invoice button (UC-R8)", () => {
  it("is not shown without invoices.create", () => {
    search = "";
    const { client } = stubClient(handlers());
    renderScreen(<NewInvoiceButton />, client, { permissionKeys: ["invoices.view", "finance.view.payments"] });
    expect(screen.queryByRole("button", { name: "New invoice" })).toBeNull();
  });

  it("opens the dialog on click, and straight away from the quick create link (?new=1)", async () => {
    search = "";
    const { client } = stubClient(handlers());
    const first = renderScreen(<NewInvoiceButton />, client, { permissionKeys: FINANCE });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "New invoice" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    first.unmount();
    search = "new=1";
    renderScreen(<NewInvoiceButton />, client, { permissionKeys: FINANCE });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    search = "";
  });
});
