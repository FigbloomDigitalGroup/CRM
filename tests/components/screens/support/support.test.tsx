import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomerView } from "../../../../src/ui/screens/support/CustomerView";
import { SupportWorkspace } from "../../../../src/ui/screens/support/SupportWorkspace";
import { TicketDetail } from "../../../../src/ui/screens/support/TicketDetail";
import { renderScreen, stubClient, violations } from "../deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/support", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const SUPPORT = { permissionKeys: ["tickets.manage", "companies.view"], roleName: "Customer Support" };
const SALES = { permissionKeys: ["leads.view.own"], roleName: "Sales" };

describe("Customer Support workspace (FIG-1178)", () => {
  it("shows the tickets, the satisfaction tab and says it is demo data and a proposed role", async () => {
    const { client } = stubClient({});
    const { container } = renderScreen(<SupportWorkspace />, client, SUPPORT);
    expect(screen.getByText("Payroll export misses the overtime column")).toBeInTheDocument();
    expect(screen.getByText(/Demo data/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed role/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Satisfaction" }));
    expect(screen.getByText(/Smooth launch and quick support/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("changes a ticket's status in place", async () => {
    const { client } = stubClient({});
    renderScreen(<SupportWorkspace />, client, SUPPORT);
    const select = screen.getByLabelText("Ticket status for Payroll export misses the overtime column");
    await userEvent.selectOptions(select, "Resolved");
    expect(select).toHaveValue("Resolved");
  });

  it("explains no-access to a role without the ticket permission", () => {
    const { client } = stubClient({});
    renderScreen(<SupportWorkspace />, client, SALES);
    expect(screen.queryByText("Payroll export misses the overtime column")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Customer Support/).length).toBeGreaterThan(0);
  });

  it("keeps internal notes apart and shows the customer without money", async () => {
    const { client } = stubClient({});
    renderScreen(<TicketDetail ticketId="tk2" />, client, SUPPORT);
    await userEvent.type(screen.getByLabelText("Reply"), "Traced it to the mail queue.");
    await userEvent.click(screen.getByRole("checkbox", { name: /Internal note/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("Traced it to the mail queue.")).toBeInTheDocument();
    expect(screen.getAllByText("Internal note").length).toBeGreaterThan(0);
    const customer = screen.getByRole("complementary", { name: /Customer Hillcrest/ });
    expect(within(customer).getByText(/shown to Customer Support/)).toBeInTheDocument();
    expect(customer.textContent).not.toMatch(/KES|180,?000/);
  });

  it("validates an empty reply", async () => {
    const { client } = stubClient({});
    renderScreen(<TicketDetail ticketId="tk1" />, client, SUPPORT);
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(screen.getByText("Write a message first")).toBeInTheDocument();
  });

  it("customer view says when there is no such customer", () => {
    const { client } = stubClient({});
    renderScreen(<CustomerView customerId="nope" />, client, SUPPORT);
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
  });
});
