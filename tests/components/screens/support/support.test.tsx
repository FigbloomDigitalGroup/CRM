import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomerView } from "../../../../src/ui/screens/support/CustomerView";
import { SupportWorkspace } from "../../../../src/ui/screens/support/SupportWorkspace";
import { TicketDetail } from "../../../../src/ui/screens/support/TicketDetail";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/support", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const SUPPORT = { permissionKeys: ["tickets.manage", "companies.view"], roleName: "Customer Support" };
const SALES = { permissionKeys: ["leads.view.own"], roleName: "Sales" };

const T1 = {
  id: "t1",
  number: 1,
  title: "Payroll export misses the overtime column",
  description: null,
  status: "OPEN",
  priority: "HIGH",
  company: { id: "c1", name: "Davis & Shirtliff" },
  contact: null,
  owner: { membershipId: "m-9", name: "Dev Delivery" },
  createdAt: "2026-11-04T09:12:00.000Z",
  updatedAt: "2026-11-04T09:12:00.000Z",
  resolvedAt: null,
};
const T2 = { ...T1, id: "t2", number: 2, title: "Parent portal reset emails arrive late", status: "RESOLVED", priority: "LOW", company: { id: "c9", name: "Hillcrest Preparatory School" } };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100, pageCount: 1, nextCursor: null });
const SURVEYS = {
  ...page([
    { id: "s1", companyId: "c9", ticketId: "t2", sentAt: "2026-10-20T09:00:00.000Z", expiresAt: "2026-11-19T09:00:00.000Z", status: "ANSWERED", score: 5, comment: "Smooth launch and quick support." },
    { id: "s2", companyId: "c1", ticketId: null, sentAt: "2026-10-14T09:00:00.000Z", expiresAt: "2026-11-13T09:00:00.000Z", status: "WAITING", score: null, comment: null },
  ]),
  summary: { sent: 2, answered: 1, averageScore: 5 },
};
const CUSTOMER = {
  company: { id: "c9", name: "Hillcrest Preparatory School", industry: "Education", location: "Lang’ata", phone: "+254 722 203 000", email: "bursar@hillcrest.ac.ke", lifecycle: "Active Customer" },
  contacts: [{ id: "p1", name: "Grace Achieng", jobTitle: "Bursar", email: "grace@hillcrest.ac.ke", phone: null }],
  services: [{ id: "sv1", name: "School website", status: "Live", since: "2026-08-01" }],
  tickets: [],
  satisfaction: [],
};

describe("Customer Support workspace (FIG-1178, wired to FIG-1155)", () => {
  it("reads the tickets and survey routes and shows the satisfaction answers", async () => {
    const { client, calls } = stubClient({ getTickets: () => page([T1, T2]), getSurveys: () => SURVEYS });
    const { container } = renderScreen(<SupportWorkspace />, client, SUPPORT);
    expect(await screen.findByText("Payroll export misses the overtime column")).toBeInTheDocument();
    expect(calls.map((c) => c.id)).toEqual(expect.arrayContaining(["getTickets", "getSurveys"]));
    await userEvent.click(screen.getByRole("tab", { name: "Satisfaction" }));
    expect(await screen.findByText(/Smooth launch and quick support/)).toBeInTheDocument();
    expect(screen.getByLabelText("Score 5 out of 5")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("changes a ticket's status through the API", async () => {
    const { client, calls } = stubClient({ getTickets: () => page([T1]), getSurveys: () => SURVEYS, patchTicketsByTicketId: () => ({ ...T1, status: "RESOLVED" }) });
    renderScreen(<SupportWorkspace />, client, SUPPORT);
    const select = await screen.findByLabelText("Ticket status for Payroll export misses the overtime column");
    await userEvent.selectOptions(select, "RESOLVED");
    const patch = calls.find((c) => c.id === "patchTicketsByTicketId");
    expect(patch?.args).toMatchObject({ params: { orgSlug: "figbloom", ticketId: "t1" }, body: { status: "RESOLVED" } });
  });

  it("explains no-access to a role without the ticket permission and does not call the API", () => {
    const { client, calls } = stubClient({});
    renderScreen(<SupportWorkspace />, client, SALES);
    expect(screen.getAllByText(/Customer Support/).length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });

  it("explains that the role is switched off when the API answers FEATURE_UNAVAILABLE", async () => {
    const off = () => apiError(403, "Customer Support is switched off.", { code: "FEATURE_UNAVAILABLE", feature: { key: "customer_support.role", reason: "toggle", availableIn: null } });
    const { client } = stubClient({ getTickets: off, getSurveys: off });
    renderScreen(<SupportWorkspace />, client, SUPPORT);
    expect((await screen.findAllByText(/not available yet/)).length).toBeGreaterThan(0);
  });

  it("shows an empty state and an error with retry", async () => {
    const { client } = stubClient({ getTickets: () => page([]), getSurveys: () => apiError(500) });
    renderScreen(<SupportWorkspace />, client, SUPPORT);
    expect(await screen.findByText("No tickets yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Satisfaction" }));
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

describe("Support ticket and customer view", () => {
  const detail = { ...T1, id: "t2", status: "RESOLVED", company: T2.company, messages: [{ id: "mm1", kind: "CUSTOMER", author: "Grace Achieng", body: "Reset emails take an hour.", at: "2026-11-03T15:30:00.000Z" }] };

  it("keeps internal notes apart (sent as INTERNAL) and shows the customer without money", async () => {
    const { client, calls } = stubClient({
      getTicketsByTicketId: () => detail,
      getSupportCustomersByCompanyId: () => CUSTOMER,
      postTicketsByTicketIdMessages: () => ({ id: "mm2", kind: "INTERNAL", author: "You", body: "x", at: "2026-11-05T09:00:00.000Z" }),
    });
    renderScreen(<TicketDetail ticketId="t2" />, client, SUPPORT);
    expect(await screen.findByText("Reset emails take an hour.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reply"), "Traced it to the mail queue.");
    await userEvent.click(screen.getByRole("checkbox", { name: /Internal note/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    const post = calls.find((c) => c.id === "postTicketsByTicketIdMessages");
    expect(post?.args).toMatchObject({ params: { ticketId: "t2" }, body: { kind: "INTERNAL", body: "Traced it to the mail queue." } });
    const customer = await screen.findByRole("complementary", { name: /Customer Hillcrest/ });
    expect(within(customer).getByText(/shown to Customer Support/)).toBeInTheDocument();
    expect(customer.textContent).not.toMatch(/KES|180,?000/);
  });

  it("sends the satisfaction survey for a resolved ticket", async () => {
    const { client, calls } = stubClient({ getTicketsByTicketId: () => detail, getSupportCustomersByCompanyId: () => CUSTOMER, postSurveys: () => SURVEYS.items[0] });
    renderScreen(<TicketDetail ticketId="t2" />, client, SUPPORT);
    await userEvent.click(await screen.findByRole("button", { name: "Send survey" }));
    expect(calls.find((c) => c.id === "postSurveys")?.args).toMatchObject({ body: { ticketId: "t2" } });
  });

  it("validates an empty reply without calling the API", async () => {
    const { client, calls } = stubClient({ getTicketsByTicketId: () => detail, getSupportCustomersByCompanyId: () => CUSTOMER });
    renderScreen(<TicketDetail ticketId="t2" />, client, SUPPORT);
    await userEvent.click(await screen.findByRole("button", { name: "Send reply" }));
    expect(screen.getByText("Write a message first")).toBeInTheDocument();
    expect(calls.some((c) => c.id === "postTicketsByTicketIdMessages")).toBe(false);
  });

  it("says when there is no such ticket or customer", async () => {
    const { client } = stubClient({ getTicketsByTicketId: () => apiError(404), getSupportCustomersByCompanyId: () => apiError(404) });
    renderScreen(<TicketDetail ticketId="nope" />, client, SUPPORT);
    expect(await screen.findByText("Ticket not found")).toBeInTheDocument();
    renderScreen(<CustomerView customerId="nope" />, client, SUPPORT);
    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
  });
});
