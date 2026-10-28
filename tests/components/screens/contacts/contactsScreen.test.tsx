import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactsScreen } from "../../../../src/ui/screens/contacts/ContactsScreen";
import { COUNTS, MANAGEMENT, REFERENCE, ROWS, SALES, VIEWER, apiError, contact, directory, renderScreen, stubClient, violations } from "./fixtures";
import type { Handler } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/contacts",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function setup(handlers: Record<string, Handler> = {}, keys = SALES) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    listContactDirectory: ({ query }) => {
      if (query?.pageSize === "1") return directory([ROWS[0]], { total: query?.ownerMembershipId ? 2 : 3 });
      if (query?.standalone) return directory([ROWS[1]]);
      if (query?.missingEmail) return directory([ROWS[1]]);
      if (query?.archived) return directory([contact({ id: "p9", firstName: "Old", lastName: "Contact", archivedAt: "2026-09-01T00:00:00.000Z" })]);
      return directory(ROWS);
    },
    ...handlers,
  });
  return { ...stub, ...renderScreen(<ContactsScreen />, stub.client, { permissionKeys: keys }) };
}

describe("Contacts list (F3.02, C3)", () => {
  it("shows the tiles, tabs with counts, and a row per contact with company, email, phone, owner and reach", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Contacts", level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Contacts" });
    expect(within(table).getByRole("link", { name: "Chebet Kiprono" })).toHaveAttribute("href", "/o/figbloom/contacts/p1");
    expect(within(table).getAllByRole("link", { name: "Brookside Dairy" })[0]).toHaveAttribute("href", "/o/figbloom/companies/c1");
    expect(within(table).getByText("chebet@brookside.example")).toBeInTheDocument();
    expect(within(table).getAllByText("No company").length).toBeGreaterThan(0);
    expect(within(table).getByRole("link", { name: "Call Chebet Kiprono" })).toHaveAttribute("href", "tel:+254712345605");
    expect(within(table).getByRole("link", { name: "WhatsApp Chebet Kiprono" })).toHaveAttribute("href", "https://wa.me/254712345605");
    // A contact without a phone offers no dead buttons.
    const noPhone = within(table).getByRole("link", { name: "Wanjiru Kamau" }).closest("tr")!;
    expect(within(noPhone).queryByRole("link", { name: /^Call/ })).toBeNull();
    const tabs = screen.getByRole("tablist", { name: "Contact views" });
    await waitFor(() => expect(within(tabs).getByRole("tab", { name: /Missing email/ })).toHaveTextContent(String(COUNTS.missingEmail)));
    expect(within(tabs).getByRole("tab", { name: /My contacts/ })).toBeInTheDocument();
    expect(screen.getByText("Tap call or WhatsApp; you’ll be asked to log the conversation after.")).toBeInTheDocument();
  });

  it("filters: No company, Missing email and My contacts ask the server for exactly that", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByRole("table", { name: "Contacts" });
    await user.click(screen.getByRole("tab", { name: /No company/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listContactDirectory" && c.args.query?.standalone === "true")).toBe(true));
    await user.click(screen.getByRole("tab", { name: /Missing email/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listContactDirectory" && c.args.query?.missingEmail === "true")).toBe(true));
    await user.click(screen.getByRole("tab", { name: /My contacts/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listContactDirectory" && c.args.query?.ownerMembershipId === "m-1" && c.args.query?.pageSize === "25")).toBe(true));
  });

  it("searches on the server after a pause, and pages", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ listContactDirectory: ({ query }) => (query?.pageSize === "1" ? directory([ROWS[0]]) : directory(ROWS, { total: 60, pageCount: 3 })) });
    expect(await screen.findByText("Showing 1–25 of 60 contacts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(calls.some((c) => c.id === "listContactDirectory" && c.args.query?.page === "2")).toBe(true));
    await user.type(screen.getByRole("searchbox", { name: "Search contacts" }), "osei");
    await waitFor(() => expect(calls.some((c) => c.id === "listContactDirectory" && c.args.query?.q === "osei" && c.args.query?.page === "1")).toBe(true));
  });

  it("the archived tab offers Restore and no reach buttons", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postContactsByContactIdRestore: () => ({}) });
    await screen.findByRole("table", { name: "Contacts" });
    await user.click(screen.getByRole("tab", { name: /Archived/ }));
    const row = (await screen.findByRole("link", { name: "Old Contact" })).closest("tr")!;
    expect(within(row).queryByRole("link", { name: /^Call/ })).toBeNull();
    await user.click(within(row).getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "postContactsByContactIdRestore" && c.args.params?.contactId === "p9")).toBe(true));
  });

  it("a read-only role (Delivery or Finance) can view but not create, import or reach; the scope says so", async () => {
    setup({}, VIEWER);
    await screen.findByRole("table", { name: "Contacts" });
    expect(screen.getByText(/Read-only · /)).toBeInTheDocument();
    expect(screen.getByText("You can view contacts and reach them by phone or WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import CSV" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /My contacts/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Call / })).toBeNull();
  });

  it("Management sees import, export and the organisation scope", async () => {
    setup({}, MANAGEMENT);
    await screen.findByRole("table", { name: "Contacts" });
    expect(screen.getByText(/All organisation contacts · /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("explains a refusal instead of showing an empty list", async () => {
    setup({ listContactDirectory: () => apiError(403, "Nope", { denial: { yourRole: "Restricted Technical", ownerRoles: ["Management"], whoToAsk: ["Management"] } }) }, VIEWER);
    expect(await screen.findByText("Restricted Technical")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Contacts" })).toBeNull();
  });

  it("shows the empty state for a new organisation, with the actions the role has", async () => {
    setup({ listContactDirectory: () => directory([], { counts: { all: 0, standalone: 0, missingEmail: 0, missingPhone: 0, archived: 0 } }) }, MANAGEMENT);
    expect(await screen.findByText("No contacts yet. Add your first one.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New contact" }).length).toBeGreaterThan(0);
  });

  it("shows 'No contacts match.' with a way back when a search finds nothing", async () => {
    const user = userEvent.setup();
    setup({ listContactDirectory: ({ query }) => (query?.q ? directory([]) : directory(ROWS)) });
    await screen.findByRole("table", { name: "Contacts" });
    await user.type(screen.getByRole("searchbox", { name: "Search contacts" }), "zzz");
    expect(await screen.findByText("No contacts match.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all contacts" }));
    expect(await screen.findByRole("link", { name: "Chebet Kiprono" })).toBeInTheDocument();
  });

  it("offers a retry when the list cannot load", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { calls } = setup({ listContactDirectory: ({ query }) => (query?.pageSize === "1" ? directory([]) : fail ? apiError(500, "boom") : directory(ROWS)) });
    expect(await screen.findByText("Contacts didn’t load")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Chebet Kiprono" })).toBeInTheDocument();
    expect(calls.filter((c) => c.id === "listContactDirectory").length).toBeGreaterThan(1);
  });

  it("creates a contact from the drawer with only a first name, then opens it", async () => {
    const user = userEvent.setup();
    push.mockClear();
    const { calls } = setup({ postContacts: () => ({ contact: contact({ id: "p-new" }), possibleDuplicates: [], duplicates: [], hiddenDuplicates: 0 }) });
    await screen.findByRole("table", { name: "Contacts" });
    await user.click(screen.getByRole("button", { name: "New contact" }));
    const drawer = await screen.findByRole("dialog", { name: "New contact" });
    const create = within(drawer).getByRole("button", { name: "Create contact" });
    expect(create).toBeDisabled();
    await user.type(within(drawer).getByLabelText(/First name/), "Njeri");
    await user.type(within(drawer).getByLabelText("Phone"), "0700111222");
    await user.click(create);
    await waitFor(() => expect(calls.some((c) => c.id === "postContacts")).toBe(true));
    const body = calls.find((c) => c.id === "postContacts")!.args.body as Record<string, unknown>;
    expect(body).toMatchObject({ firstName: "Njeri", phone: "0700111222" });
    expect(body).not.toHaveProperty("companyId");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/figbloom/contacts/p-new"));
  });

  it("has no accessibility violations", async () => {
    const { container } = setup({}, MANAGEMENT);
    await screen.findByRole("table", { name: "Contacts" });
    expect(await violations(container)).toEqual([]);
  });
});
