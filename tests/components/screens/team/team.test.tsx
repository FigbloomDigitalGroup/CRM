import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamScreen } from "../../../../src/ui/screens/team/TeamScreen";
import { balanceRows, sortParam } from "../../../../src/ui/screens/team/model";
import { apiError, expectNoAxeViolations, renderScreen, type Handlers } from "../home/harness";

/** P2-15: the Team page against a stand-in API. Numbers are the API's; the screen only shows them, explains gaps and refuses the wrong role. */

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/team", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const MANAGEMENT = { roleName: "Management", permissionKeys: ["configuration.manage", "leads.view.all", "deals.view.all", "tasks.view.all", "deals.view.value"] };
const hidden = { amount: null, masked: true };
const access = (values: boolean) => ({ leads: true, deals: true, tasks: true, values });

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  membershipId: id, name, email: `${id}@example.test`, initials: name.slice(0, 2), avatarUrl: null, role: { key: "SALES", name: "Sales" }, status: "ACTIVE",
  lastActiveAt: new Date(Date.now() - 3 * 3600_000).toISOString(), openLeads: 12, openDeals: 4, openDealsValue: hidden, tasksDueToday: 2, overdueTasks: 1, newLeads: 3, stuckDeals: 0, ...extra,
});

function handlers(over: Partial<Record<string, unknown>> = {}, values = true): Handlers {
  const money = (n: string) => (values ? { amount: n, masked: false } : hidden);
  return {
    getTeamSummary: () => ({
      range: "7d", rangeStart: new Date().toISOString(), generatedAt: new Date().toISOString(), staleDays: 10, access: access(values),
      summary: { membersActive: 4, membersTotal: 6, openLeads: 48, openDeals: 17, openDealsValue: money("7654321"), overdueTasks: 5, newLeads: 11, dealsWon: { count: 2, value: money("1200000") }, unassignedLeads: 3 },
      workload: [{ membershipId: "m1", name: "Wanjiru Kamau", openLeads: 30 }, { membershipId: "m2", name: "Otieno Ouma", openLeads: 2 }, { membershipId: "m3", name: "Amina Yusuf", openLeads: 0 }],
    }),
    getTeamAttention: () => ({
      staleDays: 10, access: access(values),
      staleLeads: { total: 12, items: [{ id: "l1", company: "Brookside Dairy", contact: null, lastTouchAt: new Date(Date.now() - 20 * 86400_000).toISOString(), ownerMembershipId: "m1", ownerName: "Wanjiru Kamau" }] },
      overdueTasks: { total: 1, items: [{ id: "t1", title: "Call back Rafiki", dueAt: new Date(Date.now() - 86400_000).toISOString(), ownerMembershipId: "m2", ownerName: "Otieno Ouma" }] },
      stuckDeals: { total: 1, items: [{ id: "d1", company: "Sunrise Foods", stage: "Negotiation", daysQuiet: 31, value: money("7654321"), ownerMembershipId: "m1", ownerName: "Wanjiru Kamau" }] },
    }),
    listTeamMembers: () => ({
      range: "7d", access: access(values), items: [row("m1", "Wanjiru Kamau"), row("m2", "Otieno Ouma", { status: "PENDING", lastActiveAt: null })], page: 1, pageSize: 25, total: 2, pageCount: 1, nextCursor: null,
      roles: [{ key: "SALES", name: "Sales" }, { key: "MANAGEMENT", name: "Management" }],
    }),
    getTeamMember: () => ({
      range: "7d", access: access(values), member: row("m1", "Wanjiru Kamau"),
      recentActivity: [{ id: "e1", action: "deal.moved", label: "Moved a deal", entityType: "Deal", entityId: "d1", at: new Date().toISOString(), path: "/deals/d1" }],
      openLeads: [{ id: "l1", company: "Brookside Dairy", contact: null, temperature: "HOT", nextFollowUpAt: null, stale: true }],
      openDeals: [{ id: "d1", company: "Sunrise Foods", stage: "Negotiation", expectedCloseDate: null, stuck: true, value: money("7654321") }],
      tasks: [{ id: "t1", title: "Send proposal", dueAt: new Date(Date.now() - 86400_000).toISOString(), overdue: true }],
      trend: Array.from({ length: 30 }, (_, i) => ({ start: new Date(Date.now() - (29 - i) * 86400_000).toISOString(), count: i % 5 })),
    }),
    ...(over as Handlers),
  };
}

describe("Team page", () => {
  it("shows the summary, the workload, what needs attention and the members", async () => {
    const { container } = renderScreen(<TeamScreen />, handlers(), MANAGEMENT);
    expect(await screen.findByRole("heading", { name: "Team" })).toBeTruthy();
    const summary = await screen.findByRole("region", { name: "Team summary" });
    expect(within(summary).getByText("4 of 6")).toBeTruthy();
    expect(within(summary).getByText("48")).toBeTruthy();
    expect(within(summary).getByText(/KES 7.7M/)).toBeTruthy();
    expect(await screen.findByText(/3 unassigned leads in the shared pool/)).toBeTruthy();
    expect(screen.getByText("Heavy")).toBeTruthy();
    expect(screen.getByText("Brookside Dairy")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sunrise Foods" }).getAttribute("href")).toBe("/o/figbloom/deals/d1");
    expect((await screen.findAllByText("Wanjiru Kamau")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Invited").length).toBeGreaterThan(0);
    await expectNoAxeViolations(container);
  });

  it("a value the viewer may not see is masked and never in the page", async () => {
    const { container } = renderScreen(<TeamScreen />, handlers({}, false), { ...MANAGEMENT, permissionKeys: MANAGEMENT.permissionKeys.filter((k) => k !== "deals.view.value") });
    await screen.findByRole("region", { name: "Team summary" });
    expect(container.textContent).not.toMatch(/7,654,321|7654321/);
    expect(screen.getAllByRole("note").length).toBeGreaterThan(0);
  });

  it("asks the API for the chosen date range and refetches everything with it", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<TeamScreen />, handlers(), MANAGEMENT);
    await screen.findByRole("region", { name: "Team summary" });
    expect(view.last("getTeamSummary")?.query).toMatchObject({ range: "7d" });
    await user.click(screen.getByRole("tab", { name: "30 days" }));
    await waitFor(() => expect(view.last("getTeamSummary")?.query).toMatchObject({ range: "30d" }));
    await waitFor(() => expect(view.last("listTeamMembers")?.query).toMatchObject({ range: "30d", page: "1" }));
  });

  it("opens a member's detail from the name button, which is reachable with the keyboard", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<TeamScreen />, handlers(), MANAGEMENT);
    const buttons = await screen.findAllByRole("button", { name: "Open Wanjiru Kamau" });
    await user.click(buttons[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Wanjiru Kamau" });
    expect(await within(dialog).findByText("Moved a deal")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open in Members settings" }).getAttribute("href")).toBe("/o/figbloom/settings?tab=members");
    expect(view.last("getTeamMember")?.params).toMatchObject({ membershipId: "m1" });
    await expectNoAxeViolations(dialog);
  });

  it("filters send the role to the server and reset to page one", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<TeamScreen />, handlers(), MANAGEMENT);
    await screen.findAllByRole("button", { name: "Open Wanjiru Kamau" });
    await user.selectOptions(screen.getByLabelText("Role"), "SALES");
    await waitFor(() => expect(view.last("listTeamMembers")?.query).toMatchObject({ role: "SALES", page: "1" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(view.last("listTeamMembers")?.query).not.toHaveProperty("role"));
  });

  it("explains an empty team", async () => {
    renderScreen(<TeamScreen />, handlers({ listTeamMembers: () => ({ range: "7d", access: access(true), items: [], page: 1, pageSize: 25, total: 0, pageCount: 1, nextCursor: null, roles: [] }) }), MANAGEMENT);
    expect(await screen.findByText("No team members yet")).toBeTruthy();
  });

  it("shows an error with a retry, not a blank page", async () => {
    renderScreen(<TeamScreen />, handlers({ getTeamSummary: () => { throw apiError(500); } }), MANAGEMENT);
    expect((await screen.findAllByRole("button", { name: /try again|retry/i })).length).toBeGreaterThan(0);
  });

  it("a role without access gets the explained no-access card and the page asks the API for nothing", async () => {
    const view = renderScreen(<TeamScreen />, handlers(), { roleName: "Sales", permissionKeys: ["leads.view.own"] });
    const card = await screen.findByRole("region", { name: /Team/ });
    expect(within(card).getByText("Sales")).toBeTruthy();
    expect(within(card).getAllByText(/Management/).length).toBeGreaterThan(0);
    expect(view.calls).toEqual([]);
  });

  it("the API's own refusal also becomes the no-access card", async () => {
    renderScreen(<TeamScreen />, handlers({ getTeamSummary: () => { throw apiError(403, { denial: { yourRole: "Management", ownerRoles: ["Management"], whoToAsk: ["Michael"] } }); } }), MANAGEMENT);
    expect(await screen.findByRole("region", { name: /Team/ })).toBeTruthy();
  });
});

describe("Team page helpers", () => {
  it("maps the table sort to the API's sort text", () => {
    expect(sortParam(null)).toBe("name");
    expect(sortParam({ key: "openLeads", dir: "desc" })).toBe("-openLeads");
    expect(sortParam({ key: "name", dir: "asc" })).toBe("name");
  });
  it("flags a heavy and an idle workload", () => {
    const rows = balanceRows([{ membershipId: "a", name: "A", openLeads: 30 }, { membershipId: "b", name: "B", openLeads: 5 }, { membershipId: "c", name: "C", openLeads: 0 }]);
    expect(rows.map((r) => r.flag)).toEqual(["high", null, "idle"]);
    expect(rows[0]!.width).toBe(100);
  });
});
