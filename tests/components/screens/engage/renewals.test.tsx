import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RenewalsScreen } from "../../../../src/ui/screens/engage/RenewalsScreen";
import { REFERENCE, STAGES, apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";
import { retention, service } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/renewals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MANAGEMENT = ["company_services.view", "company_services.manage", "reporting.view.all", "organization.manage_settings", "tasks.create", "deals.create", "activities.create", "communications.create"];
const SALES = ["company_services.view", "company_services.manage", "tasks.create", "deals.create", "activities.create", "communications.create"];

const SERVICES = [
  service({ id: "s-1" }),
  service({ id: "s-2", companyId: "c-5", companyName: "Lapsed Logistics", serviceName: "Starlink plan", state: "LAPSED", daysToRenewal: -20, renewsOn: new Date(Date.now() - 20 * 86_400_000).toISOString(), billingCycle: "MONTHLY", ownerMembershipId: "m-dl" }),
  service({ id: "s-3", companyId: "c-6", companyName: "Calm Co", serviceName: "Retainer", state: "ACTIVE", daysToRenewal: 200, renewsOn: new Date(Date.now() + 200 * 86_400_000).toISOString(), value: null, valueMasked: true }),
];

function setup(handlers: Record<string, Handler> = {}, keys = MANAGEMENT, ret = retention()) {
  const stub = stubClient({
    getReferenceData: () => ({ ...REFERENCE, pipelineStages: STAGES }),
    getRenewalsAndRetention: () => ret,
    listRecurringServices: () => ({ items: SERVICES, page: 1, pageSize: 50, total: SERVICES.length, pageCount: 1, nextCursor: null }),
    getRenewalSettings: () => ({ dueSoonDays: 30, graceDays: 14 }),
    getReportsCustomers: () => ({ summary: { customers: 20, active: 12, repeat: 7, dormant: 2 }, items: [], page: 1, pageSize: 1, total: 20, pageCount: 20 }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<RenewalsScreen />, stub.client, { permissionKeys: keys, userName: "Dev Sales", membershipId: "m-1" }) };
}

describe("Renewals and retention (F3.05, E2)", () => {
  it("shows the key numbers from the API's counts and each section", async () => {
    setup();
    expect(await screen.findByText("All customers")).toBeInTheDocument();
    expect(screen.getByText("Reminders only. Nothing here changes a record until you act.")).toBeInTheDocument();
    const kpi = (label: string) => screen.getByText(label, { selector: ".fb-en-kpi__l" }).closest(".fb-en-kpi") as HTMLElement;
    expect(kpi("Going quiet")).toHaveTextContent("1");
    expect(kpi("Going quiet")).toHaveTextContent("no contact in 45+ days");
    expect(kpi("Proposals unanswered")).toHaveTextContent("sent 5+ days ago");
    await waitFor(() => expect(kpi("Repeat customers")).toHaveTextContent("7"));
    const table = await screen.findByRole("table", { name: "Recurring services and renewals" });
    expect(within(table).getByText("Brookside Dairy")).toBeInTheDocument();
    expect(within(table).getByText("Due in 12 days")).toBeInTheDocument();
    expect(within(table).getByText("Lapsed 20 days ago")).toBeInTheDocument();
    expect(within(table).getByText(/KES 120,000 \/ yr/)).toBeInTheDocument();
    expect(screen.getByText("Hillcrest Preparatory School")).toBeInTheDocument();
    expect(screen.getByText(/P-2026-014 · sent 7 days ago/)).toBeInTheDocument();
    expect(screen.getByText("Greenfield Farms")).toBeInTheDocument();
    expect(screen.getByText("CCTV")).toBeInTheDocument();
    expect(screen.getByText("Automation Systems")).toBeInTheDocument();
  });

  it("never shows a service value the API masks", async () => {
    setup();
    const table = await screen.findByRole("table", { name: "Recurring services and renewals" });
    const calm = within(table).getByText("Calm Co").closest("tr") as HTMLElement;
    expect(calm.textContent).not.toMatch(/KES\s?\d/);
    expect(within(calm).getByRole("note")).toHaveAccessibleName(/Hidden/);
  });

  it("filters the services table by state", async () => {
    const user = userEvent.setup();
    setup();
    const table = await screen.findByRole("table", { name: "Recurring services and renewals" });
    await user.click(screen.getByRole("button", { name: /Lapsed\s*1/ }));
    expect(within(table).queryByText("Brookside Dairy")).toBeNull();
    expect(within(table).getByText("Lapsed Logistics")).toBeInTheDocument();
  });

  it("adds a renewal follow-up task for the service's owner, once", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postTasks: () => ({ id: "t-1" }) });
    await user.click(await screen.findByRole("button", { name: "Add follow-up for Lapsed Logistics Starlink plan" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postTasks")?.args.body).toMatchObject({ title: "Renewal: confirm Starlink plan with Lapsed Logistics", assigneeMembershipId: "m-dl", companyId: "c-5", priority: "MEDIUM" }));
    expect(await screen.findAllByRole("button", { name: /Add follow-up for Lapsed Logistics/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Add follow-up for Lapsed Logistics/ })).toBeDisabled();
  });

  it("plans a check-in with the quiet customer's owner and logs contact in two taps", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postTasks: () => ({ id: "t-2" }), quickLog: () => ({ activityId: "a", communicationId: "c", taskId: null }) });
    await user.click(await screen.findByRole("button", { name: "Plan a check-in with Hillcrest Preparatory School" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postTasks")?.args.body).toMatchObject({ title: "Check in with Hillcrest Preparatory School", assigneeMembershipId: "m-dl", companyId: "c-3" }));
    await user.click(screen.getByRole("button", { name: "Log contact with Hillcrest Preparatory School" }));
    const dialog = await screen.findByRole("dialog", { name: /Log contact with Hillcrest/ });
    await user.click(within(dialog).getByRole("button", { name: "Save log" }));
    await waitFor(() => expect(calls.find((c) => c.id === "quickLog")?.args.body).toMatchObject({ channel: "CALL", outcome: "REACHED", companyId: "c-3" }));
  });

  it("chases an unanswered proposal by logging a WhatsApp on its deal", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ quickLog: () => ({ activityId: "a", communicationId: "c", taskId: null }) });
    await user.click(await screen.findByRole("button", { name: "Chase Kileleshwa Property Managers" }));
    const dialog = await screen.findByRole("dialog", { name: /Log contact with Kileleshwa/ });
    expect(within(dialog).getByRole("radio", { name: "WhatsApp" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(dialog).getByRole("button", { name: "Save log" }));
    await waitFor(() => expect(calls.find((c) => c.id === "quickLog")?.args.body).toMatchObject({ channel: "WHATSAPP", dealId: "d-9" }));
    expect(screen.getByRole("link", { name: "Kileleshwa Property Managers" })).toHaveAttribute("href", "/o/figbloom/deals/d-9");
  });

  it("starts a renewal deal in the first open stage, closing when the service renews", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postDeals: () => ({ id: "d-new" }) });
    await user.click(await screen.findByRole("button", { name: "Start renewal deal for Brookside Dairy Hosting" }));
    const dialog = await screen.findByRole("dialog", { name: "Start a renewal deal" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Start deal" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "Start deal" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postDeals")?.args.body).toMatchObject({ companyId: "c-1", pipelineStageId: "st-1", serviceId: "sv-1", notes: "Renewal of Hosting." }));
  });

  it("lets Management change the dormancy threshold and tells Sales it is Management's", async () => {
    const user = userEvent.setup();
    const { calls, unmount } = setup({ putReportsSettings: () => ({ dormancyDays: 120 }) });
    const select = await screen.findByRole("combobox", { name: "Dormant after (days)" });
    await user.selectOptions(select, "120");
    await waitFor(() => expect(calls.find((c) => c.id === "putReportsSettings")?.args.body).toEqual({ dormancyDays: 120 }));
    unmount();
    setup({}, SALES, retention({ scope: "own" }));
    expect(await screen.findByText("Customers you own")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Dormant after (days)" })).toBeDisabled();
    expect(screen.getByText(/Management sets this/)).toBeInTheDocument();
    // Own scope has no organisation reports, so the fourth number is the cross-sell count, and the report is never asked for.
    expect(screen.getByText("Cross-sell ideas", { selector: ".fb-en-kpi__l" })).toBeInTheDocument();
  });

  it("hides actions the role cannot take", async () => {
    setup({}, ["company_services.view", "company_services.manage"]);
    await screen.findByRole("table", { name: "Recurring services and renewals" });
    expect(screen.queryByRole("button", { name: /Add follow-up/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Start renewal deal/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Chase/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Plan a check-in/ })).toBeNull();
  });

  it("explains a refusal, and shows the empty states", async () => {
    const denied = setup({ getRenewalsAndRetention: () => apiError(403, "Nope") }, ["company_services.view"]);
    expect(await screen.findByRole("region", { name: /Renewals and retention/ })).toBeInTheDocument();
    denied.unmount();
    const empty = retention({ counts: { LAPSED: 0, DUE_30: 0, UNANSWERED_PROPOSALS: 0, GOING_QUIET: 0, CROSS_SELL: 0 }, lists: {} });
    setup({ listRecurringServices: () => ({ items: [], page: 1, pageSize: 50, total: 0, pageCount: 0, nextCursor: null }) }, MANAGEMENT, empty);
    expect(await screen.findByText("No one has gone quiet.")).toBeInTheDocument();
    expect(screen.getByText("No proposals waiting.")).toBeInTheDocument();
    expect(screen.getByText(/No recurring services yet/)).toBeInTheDocument();
  });

  it("passes an accessibility check", async () => {
    const { container } = setup();
    await screen.findByRole("table", { name: "Recurring services and renewals" });
    expect(await violations(container)).toEqual([]);
  });
});
