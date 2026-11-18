import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompaniesScreen } from "../../../../src/ui/screens/customers/CompaniesScreen";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";
import { KEYS, REFERENCE, company, directory } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/companies",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ROWS = [
  company({ id: "c-1", name: "Brookside Dairy", stateKey: "ACTIVE_CUSTOMER" }),
  company({ id: "c-2", name: "Sarova Hotels", stateKey: "DORMANT_CUSTOMER", location: "Mombasa", industry: "Hospitality", ownerMembershipId: null, owner: null }),
];

function setup(handlers: Record<string, Handler> = {}, keys = KEYS.management) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    listCompanyDirectory: () => directory(ROWS),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<CompaniesScreen />, stub.client, { permissionKeys: keys, membershipId: "m-mg" }) };
}

describe("Companies list (F3.01, C1)", () => {
  it("lists companies with lifecycle, contacts and owner, and the four stat tiles", async () => {
    setup();
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Brookside Dairy")).toBeInTheDocument();
    expect(within(table).getByText("Nakuru")).toBeInTheDocument();
    expect(within(table).getByText("Active Customer")).toBeInTheDocument();
    expect(within(table).getByText("Dormant Customer")).toBeInTheDocument();
    for (const l of ["Companies", "Customers", "Prospects", "Dormant"]) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByText("2 archived")).toBeInTheDocument();
  });

  it("lets Management reassign the owner and offers merge and archive", async () => {
    const patch = vi.fn(() => ({}));
    setup({ patchCompaniesByCompanyId: patch });
    await screen.findByText("Brookside Dairy");
    expect(screen.getByRole("button", { name: "Merge Brookside Dairy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive Brookside Dairy" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Owner of Sarova Hotels"), "m-mg");
    await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.objectContaining({ body: { ownerMembershipId: "m-mg" } })));
  });

  it("shows a view-only role the owner as text, with no reassign, merge, archive or New company", async () => {
    setup({}, KEYS.delivery);
    await screen.findByText("Brookside Dairy");
    expect(screen.queryByLabelText(/Owner of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Merge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New company" })).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /My companies/ })).not.toBeInTheDocument();
  });

  it("asks the server for the Dormant and Archived tabs and keeps the filter in the request", async () => {
    const { calls } = setup();
    await screen.findByText("Brookside Dairy");
    await userEvent.click(screen.getByRole("tab", { name: /Dormant/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listCompanyDirectory" && c.args.query?.tab === "DORMANT")).toBe(true));
    await userEvent.click(screen.getByRole("tab", { name: /Archived/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "listCompanyDirectory" && c.args.query?.tab === "ARCHIVED")).toBe(true));
  });

  it("offers Restore on an archived row to roles that may archive", async () => {
    const restore = vi.fn(() => ({}));
    const archived = company({ id: "c-9", name: "Old Co", archivedAt: "2026-10-01T00:00:00.000Z" });
    setup({ listCompanyDirectory: () => directory([archived], { tab: "ARCHIVED" }), postCompaniesByCompanyIdRestore: restore });
    await userEvent.click(await screen.findByRole("tab", { name: /Archived/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Merge Old Co/ })).not.toBeInTheDocument();
  });

  it("says so when search finds nothing, and when there are no companies at all", async () => {
    setup({ listCompanyDirectory: () => directory([], { tabCounts: { ALL: 0, DORMANT: 0, ARCHIVED: 0 } }) });
    expect(await screen.findByText("No companies yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search companies"), "zzz");
    expect(await screen.findByText("No companies match.")).toBeInTheDocument();
  });

  it("explains a refusal instead of an empty page, and offers Retry on a server error", async () => {
    const { unmount } = setup({ listCompanyDirectory: () => apiError(403, "Forbidden") }, KEYS.delivery);
    expect(await screen.findByText(/Companies/, { selector: "h3" })).toBeInTheDocument();
    unmount();
    setup({ listCompanyDirectory: () => apiError(500, "Boom") });
    expect(await screen.findByText("Companies didn’t load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("opens the New company drawer and saves with only a name", async () => {
    const create = vi.fn(() => ({ company: { id: "c-new" }, possibleDuplicates: [] }));
    setup({ postCompanies: create, postCompaniesCheckDuplicates: () => ({ possibleDuplicates: [], duplicates: [], hiddenDuplicates: 0 }) });
    await userEvent.click(await screen.findByRole("button", { name: "New company" }));
    const dialog = await screen.findByRole("dialog", { name: "New company" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add company" }));
    expect(await within(dialog).findByText("Enter the company name.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Company name/), "Kisumu Fresh");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add company" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ name: "Kisumu Fresh" }) })));
  });

  it("has no accessibility violations", async () => {
    const { container } = setup();
    await screen.findByText("Brookside Dairy");
    expect(await violations(container)).toEqual([]);
  });
});
