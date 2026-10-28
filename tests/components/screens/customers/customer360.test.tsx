import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompanyDetailScreen } from "../../../../src/ui/screens/customers/CompanyDetailScreen";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";
import { KEYS, REFERENCE, threeSixty, type Three60Options } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/companies/c-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// The record-extras panel (F3.08) has its own tests; here it is a marker so the mount is checked without its endpoints.
vi.mock("../../../../src/ui/screens/extras/RecordExtras", () => ({
  RecordExtras: ({ kind, id, archived }: { kind: string; id: string; archived?: boolean }) => <div data-testid="record-extras" data-kind={kind} data-id={id} data-archived={String(Boolean(archived))} />,
}));

function setup(opts: Three60Options, handlers: Record<string, Handler> = {}, keys?: string[]) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getCustomer360: () => threeSixty(opts),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<CompanyDetailScreen companyId="c-1" />, stub.client, { permissionKeys: keys ?? KEYS[opts.role], membershipId: "m-mg" }) };
}

describe("Customer 360 (F3.01, C2)", () => {
  it("shows Management everything, including the Payments panel and the outstanding amount", async () => {
    setup({ role: "management" });
    expect(await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 })).toBeInTheDocument();
    const pay = screen.getByRole("region", { name: "Payments" });
    expect(within(pay).getByText("INV-1042")).toBeInTheDocument();
    expect(within(pay).getByText(/Chase after the 30th/)).toBeInTheDocument();
    expect(screen.getByText("OUTSTANDING").parentElement).toHaveTextContent("580,000");
    expect(screen.getByRole("region", { name: "Services and projects" })).toHaveTextContent("Inventory");
    expect(screen.getByRole("region", { name: "Services and projects" })).toHaveTextContent("Renewal due");
    expect(screen.getByRole("region", { name: "Deals, quotes and proposals" })).toHaveTextContent("Proposal Sent");
    expect(screen.getByRole("region", { name: "Communication and activity" })).toHaveTextContent("Asked for a revised quote");
  });

  it("hides the Payments panel from Sales and says why in the Outstanding tile", async () => {
    setup({ role: "sales" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(screen.queryByRole("region", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.getByText("Finance only")).toBeInTheDocument();
    expect(screen.getByText("Ask Finance")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("INV-1042");
    expect(document.body.textContent).not.toContain("580,000");
  });

  it("never shows or adds up a deal value the API masks (Delivery)", async () => {
    setup({ role: "delivery" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(screen.getByRole("region", { name: "Deals, quotes and proposals" })).toHaveTextContent("Value hidden");
    expect(screen.getByText("WON TO DATE").parentElement).toHaveTextContent("Values hidden");
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
    // the recurring service's value is masked for Delivery, too
    expect(screen.getByRole("region", { name: "Services and projects" })).not.toHaveTextContent("60,000");
  });

  it("explains the parts Finance may not read instead of dropping them", async () => {
    setup({ role: "finance" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(within(screen.getByRole("region", { name: "Tasks" })).getByRole("note")).toHaveTextContent("Finance keeps follow-up notes instead");
    expect(within(screen.getByRole("region", { name: "Tasks" })).getByRole("note")).toHaveTextContent("Ask Management or Sales");
    expect(within(screen.getByRole("region", { name: "Communication and activity" })).getByRole("note")).toHaveTextContent("cannot read the customer's history");
    expect(screen.getByRole("region", { name: "Payments" })).toBeInTheDocument();
    // a view-only role gets no edit controls
    expect(screen.queryByRole("button", { name: /Edit|Merge|Archive|Log activity/ })).not.toBeInTheDocument();
  });

  it("shows the lifecycle as text for a role that cannot edit, and as a control for one that can", async () => {
    const view = setup({ role: "finance" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(screen.queryByRole("combobox", { name: "Lifecycle" })).not.toBeInTheDocument();
    view.unmount();
    setup({ role: "sales" });
    expect(await screen.findByRole("combobox", { name: "Lifecycle" })).toHaveValue("ls-active");
  });

  it("needs a reason to change the lifecycle, sends it, and offers Undo and the manual-override release", async () => {
    const set = vi.fn(() => ({ manual: true }));
    setup({ role: "sales" }, { setCompanyLifecycle: set });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Lifecycle" }), "ls-renewal");
    const dialog = await screen.findByRole("dialog", { name: "Change lifecycle" });
    expect(within(dialog).getByRole("button", { name: "Change lifecycle" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Why are you changing it/), "Contract renewed by phone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change lifecycle" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ body: { stateId: "ls-renewal", reason: "Contract renewed by phone" } })));
    expect(await screen.findByText("Lifecycle: Renewal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("matches the lifecycle engine: a Dormant Customer shows as dormant, and a manual state can be handed back", async () => {
    const release = vi.fn(() => ({ manual: false }));
    setup({ role: "sales", stateKey: "DORMANT_CUSTOMER", manual: true }, { releaseCompanyLifecycle: release });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(screen.getAllByText("Dormant Customer").length).toBeGreaterThan(0);
    expect(screen.getByText(/Set by hand/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Let the system decide" }));
    await waitFor(() => expect(release).toHaveBeenCalled());
  });

  it("shows an archived company read-only with a banner, and Restore only to roles that may archive", async () => {
    const restore = vi.fn(() => ({}));
    const view = setup({ role: "sales", archived: true }, { postCompaniesByCompanyIdRestore: restore });
    expect(await screen.findByRole("status")).toHaveTextContent("Everything on this customer is read-only until it’s restored.");
    expect(screen.queryByRole("combobox", { name: "Lifecycle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Edit|Merge|Archive|Log activity)$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("record-extras")).toHaveAttribute("data-archived", "true");
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restore).toHaveBeenCalled());
    view.unmount();
    setup({ role: "finance", archived: true });
    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("mounts the shared record-extras panel for the company", async () => {
    setup({ role: "management" });
    const extras = await screen.findByTestId("record-extras");
    expect(extras).toHaveAttribute("data-kind", "company");
    expect(extras).toHaveAttribute("data-id", "c-1");
  });

  it("answers a refusal with the explained no-access, a missing company with a not-found page, and a failure with Retry", async () => {
    const a = setup({ role: "sales" }, { getCustomer360: () => apiError(403, "Forbidden") }, KEYS.delivery);
    expect(await screen.findByText(/Companies/, { selector: "h3" })).toBeInTheDocument();
    a.unmount();
    const b = setup({ role: "sales" }, { getCustomer360: () => apiError(404, "Not found") });
    expect(await screen.findByText("This company was not found")).toBeInTheDocument();
    b.unmount();
    setup({ role: "sales" }, { getCustomer360: () => apiError(500, "Boom") });
    expect(await screen.findByText("This customer didn’t load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("has no accessibility violations for Management or Finance", async () => {
    const a = setup({ role: "management" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(await violations(a.container)).toEqual([]);
    a.unmount();
    const b = setup({ role: "finance" });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(await violations(b.container)).toEqual([]);
  });
});
