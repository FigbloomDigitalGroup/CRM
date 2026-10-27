import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LeadsScreen } from "../../../../src/ui/screens/leads/LeadsScreen";
import { MGMT_KEYS, SALES_KEYS, apiError, axeViolations, leadRow, page, renderScreen } from "./harness";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/o/figbloom/leads" }));

/** F2.01 (FIG-1083, design L1): the Leads list for each role, its states, and what each control does about permissions. */

const rows = [
  leadRow({ id: "l1" }),
  leadRow({ id: "l2", company: { id: "co-2", name: "Twiga Foods" }, temperature: "HOT", leadSource: { id: "src-WEBSITE", name: "Website", key: "WEBSITE" }, contact: { id: "ct-2", firstName: "Joy", lastName: "Kamau", email: "", phone: "+254700000002" } }),
];

describe("the Leads list, as Sales", () => {
  it("shows my leads with the design's columns, a lock where I cannot reassign, and the shared pool as provisional", async () => {
    renderScreen(<LeadsScreen />, { keys: SALES_KEYS, handlers: { listLeads: page(rows), getLeadsPool: page([leadRow({ id: "p1", ownerMembershipId: null })]) } });
    expect(await screen.findByRole("link", { name: "Wafula Ltd" })).toHaveAttribute("href", "/o/figbloom/leads/l1");
    expect(screen.getByText(/My leads · 2/)).toBeInTheDocument();
    expect(screen.getByText("You can edit, convert and archive leads you own. Reassigning is Management only.")).toBeInTheDocument();
    for (const h of ["COMPANY / CONTACT", "STATUS", "TEMPERATURE", "SOURCE", "SERVICE", "NEXT FOLLOW-UP", "OWNER", "ACTIONS"]) expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
    // Sales cannot reassign: the owner is text with the lock and the reason, not a select.
    expect(screen.queryByRole("combobox", { name: /Owner of/ })).toBeNull();
    expect(screen.getAllByText("Only Management can reassign leads").length).toBeGreaterThan(0);
    const tab = screen.getByRole("tab", { name: /Shared pool/ });
    expect(tab).toHaveTextContent("PROVISIONAL");
    // Website and missing-email flags sit under the name.
    const row = screen.getByRole("link", { name: "Twiga Foods" }).closest("tr")!;
    expect(within(row).getAllByText("Website")).toHaveLength(2); // the chip under the name and the Source column
    expect(within(row).getByText("No email")).toBeInTheDocument();
  });

  it("the shared pool offers Ask to take, which asks and says so", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadsScreen />, {
      keys: SALES_KEYS,
      handlers: { listLeads: page(rows), getLeadsPool: page([leadRow({ id: "p1", ownerMembershipId: null, company: { id: "c9", name: "Pool Co" } })]), postLeadsByLeadIdAskToTake: { taken: false } },
    });
    await user.click(await screen.findByRole("tab", { name: /Shared pool/ }));
    await user.click(await screen.findByRole("button", { name: "Ask to take" }));
    expect(calls.find((c) => c.id === "postLeadsByLeadIdAskToTake")?.args).toMatchObject({ params: { leadId: "p1" } });
    expect(await screen.findByText("Asked Management to assign Pool Co to you")).toBeInTheDocument();
  });

  it("explains the empty state with the next action, not a blank table", async () => {
    renderScreen(<LeadsScreen />, { keys: SALES_KEYS });
    expect(await screen.findByText("Nothing here yet. Start with your first lead.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New lead" })).toHaveLength(2); // the header action and the empty state
    expect(screen.getAllByRole("button", { name: "Import CSV" })).toHaveLength(2);
  });

  it("answers a refusal with the explained no-access, and a failure with Retry", async () => {
    const forbidden = renderScreen(<LeadsScreen />, { keys: [], handlers: { listLeads: apiError(403, { denial: { yourRole: "Finance", ownerRoles: ["Sales"], whoToAsk: ["Dev Management"] } }) } });
    expect(await screen.findByText(/Finance/)).toBeInTheDocument();
    forbidden.unmount();
    const user = userEvent.setup();
    let fail = true;
    renderScreen(<LeadsScreen />, { keys: SALES_KEYS, handlers: { listLeads: () => (fail ? apiError(500, { message: "boom PrismaClientKnownRequestError" }) : page(rows)) } });
    expect(await screen.findByText("Leads didn’t load")).toBeInTheDocument();
    expect(screen.queryByText(/Prisma/)).toBeNull(); // a server message is never shown
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Wafula Ltd" })).toBeInTheDocument();
  });

  it("filtering narrows on the server and 'No results' offers to clear", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadsScreen />, { keys: SALES_KEYS, handlers: { listLeads: (a) => ((a.query as { temperature?: string })?.temperature === "COLD" ? page([]) : page(rows)) } });
    await screen.findByRole("link", { name: "Wafula Ltd" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Temperature" }), "COLD");
    expect(await screen.findByText("No leads match these filters")).toBeInTheDocument();
    expect(calls.some((c) => c.id === "listLeads" && (c.args.query as { temperature?: string })?.temperature === "COLD")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("link", { name: "Wafula Ltd" })).toBeInTheDocument();
  });

  it("has no accessibility violations in its main state", async () => {
    const { container } = renderScreen(<LeadsScreen />, { keys: SALES_KEYS, handlers: { listLeads: page(rows) } });
    await screen.findByRole("link", { name: "Wafula Ltd" });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the Leads list, as Management", () => {
  const mgmt = { keys: MGMT_KEYS, roleName: "Management", membershipId: "m-mgmt" };

  it("sees every lead, can reassign from the row, and gets bulk actions with Archive and Export selected", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadsScreen />, { ...mgmt, handlers: { listLeads: page(rows), getLeadsPool: page([]), postLeadsByLeadIdAssign: {} } });
    await screen.findByRole("link", { name: "Wafula Ltd" });
    expect(screen.getByText(/All organisation leads · 2/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Unassigned/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner of Wafula Ltd" }), "m-mgmt");
    await waitFor(() => expect(calls.find((c) => c.id === "postLeadsByLeadIdAssign")?.args).toMatchObject({ params: { leadId: "l1" }, body: { ownerMembershipId: "m-mgmt" } }));
    await user.click(screen.getByRole("checkbox", { name: "Select Wafula Ltd" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Twiga Foods" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    expect(within(bar).getByRole("combobox", { name: "Reassign selected to" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Archive" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Export selected" })).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("archives with an Undo that restores", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadsScreen />, { ...mgmt, handlers: { listLeads: page(rows), postLeadsByLeadIdArchive: {}, postLeadsByLeadIdRestore: {} } });
    await user.click(await screen.findByRole("button", { name: "Archive Wafula Ltd" }));
    expect(await screen.findByText("Wafula Ltd archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postLeadsByLeadIdRestore")).toBe(true));
  });

  it("pages on the server and says so on a large list", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadsScreen />, { ...mgmt, handlers: { listLeads: (a) => ({ ...page(rows, 50_000), page: Number((a.query as { page?: number })?.page ?? 1) }) } });
    await screen.findByRole("link", { name: "Wafula Ltd" });
    expect(screen.getByText("Showing 1–25 of 50000 leads")).toBeInTheDocument();
    expect(screen.getByText(/Filters and search run on the server, so they cover all 50000 leads/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(calls.some((c) => c.id === "listLeads" && (c.args.query as { page?: number })?.page === 2)).toBe(true));
    await user.selectOptions(screen.getByRole("combobox", { name: "Rows" }), "100");
    await waitFor(() => expect(calls.some((c) => c.id === "listLeads" && (c.args.query as { pageSize?: number })?.pageSize === 100)).toBe(true));
  });

  it("the archived tab is read-only except Restore", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadsScreen />, { ...mgmt, handlers: { listLeads: (a) => ((a.query as { archivedOnly?: string })?.archivedOnly === "true" ? page([leadRow({ id: "a1", archivedAt: "2026-10-02T00:00:00Z", archived: true, company: { id: "c5", name: "Old Co" } })]) : page(rows)) } });
    await user.click(await screen.findByRole("tab", { name: /Archived/ }));
    const row = (await screen.findByRole("link", { name: "Old Co" })).closest("tr")!;
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Edit|Convert|Archive/ })).toBeNull();
  });
});
