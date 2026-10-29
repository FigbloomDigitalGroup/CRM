import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "../../../../src/ui/screens/home/Home";
import { apiError, expectNoAxeViolations, page, renderScreen, type Handlers } from "./harness";

/**
 * F2.09 and F2.10: the role homes (D1, D2, D3), in the design's words, against a stand-in API. What each role sees is decided by the API (a
 * section it may not have is absent), so these tests give each role the sections the API gives it, and check what the screen does with them.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const task = (id: string, title: string, dueAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  dueAt,
  priority: "MEDIUM",
  status: "PENDING",
  assigneeName: "Dev Sales",
  link: { type: "Deal", id: "d1", label: "Brookside Dairy" },
  readOnly: false,
  ...extra,
});

const board = (hidden: boolean) => ({
  columns: [
    { stage: { id: "s1", name: "Solution Presented", isWon: false, isLost: false }, count: 1, stalledCount: 1, valuesHidden: hidden, values: hidden ? [] : [{ currency: "KES", amount: 450000 }] },
    { stage: { id: "s2", name: "Proposal Sent", isWon: false, isLost: false }, count: 11, stalledCount: 0, valuesHidden: hidden, values: hidden ? [] : [{ currency: "KES", amount: 320000 }] },
    { stage: { id: "s3", name: "Negotiation", isWon: false, isLost: false }, count: 1, stalledCount: 1, valuesHidden: hidden, values: hidden ? [] : [{ currency: "KES", amount: 980000 }] },
    { stage: { id: "s4", name: "Closed Won", isWon: true, isLost: false }, count: 1, stalledCount: 0, valuesHidden: hidden, values: [] },
  ],
});

const deal = (masked: boolean) => ({
  id: "d1",
  company: { name: "Brookside Dairy" },
  value: masked ? null : "450000",
  valueMasked: masked,
  currency: "KES",
  ownerMembershipId: "m-1",
  pipelineStage: { name: "Solution Presented" },
  signals: { stalled: true, daysSinceActivity: 18 },
});

const salesSection = {
  key: "sales_today",
  title: "Today",
  scope: "Your own leads, deals and tasks",
  ok: true,
  data: {
    myDay: { tasksOverdue: 2, tasksToday: 1, meetingsToday: 0 },
    hotLeads: { count: 1, top: [] },
    stalledDeals: 2,
    dealsPastCloseDate: 0,
    pipeline: { open: 13, won: 0, lost: 0, openValue: 1750000 },
    quickActions: [],
  },
};

function salesHandlers(over: Handlers = {}, masked = false): Handlers {
  return {
    getDashboard: () => ({ available: [], sections: [salesSection] }),
    getTasksGroupsByGroup: ({ params }) =>
      params?.group === "OVERDUE"
        ? page([task("t1", "Send inventory proposal to Brookside", iso(-9 * 86_400_000))], { key: "OVERDUE" })
        : params?.group === "TODAY"
          ? page([task("t2", "Call Wanjiku about the retainer", iso(3_600_000), { link: { type: "Lead", id: "l1", label: "Java House" } })], { key: "TODAY" })
          : page([]),
    listLeads: () =>
      page([
        { id: "l1", createdAt: iso(-3_600_000), temperature: "HOT", company: { name: "Java House Africa" }, contact: null, leadSource: { name: "Facebook" }, serviceInterestId: "svc1", ownerMembershipId: "m-1" },
        { id: "l2", createdAt: iso(-7_200_000), temperature: "WARM", company: null, contact: { firstName: "Amara", lastName: "Osei" }, leadSource: { name: "Website" }, serviceInterestId: null, ownerMembershipId: null },
      ]),
    getReferenceData: () => ({ services: [{ id: "svc1", name: "Branding" }], members: [] }),
    getDealsBoard: () => board(masked),
    getDeals: () => page([deal(masked)]),
    patchTasksByTaskId: () => ({}),
    ...over,
  };
}

const SALES = { roleName: "Sales", permissionKeys: ["leads.create", "tasks.create", "activities.create", "deals.view.own"] };

beforeEach(() => window.localStorage.clear());

describe("Sales Today (D1)", () => {
  it("shows the design's four tiles, what to do today, the newest leads and the pipeline", async () => {
    const { container } = renderScreen(<HomeScreen />, salesHandlers(), SALES);
    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(await screen.findByText("My work")).toBeInTheDocument();

    expect(await screen.findByTestId("kpi-today")).toHaveTextContent(/Follow-ups due today\s*1/);
    expect(screen.getByTestId("kpi-overdue")).toHaveTextContent(/Overdue\s*2/);
    expect(screen.getByTestId("kpi-stalled")).toHaveTextContent(/Stalled deals\s*2/);
    // The overdue tile turns red, and says so with more than colour: the number and how old the oldest one is, as in the design.
    expect(screen.getByTestId("kpi-overdue")).toHaveTextContent(/oldest \d+ days?/);

    expect(await screen.findByText("Send inventory proposal to Brookside")).toBeInTheDocument();
    // The design's wording: the date and time it was due, not a count of days.
    expect(screen.getByText(/^Overdue · \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2}( [AP]M)?$/)).toBeInTheDocument();
    expect(screen.getByText("Call Wanjiku about the retainer")).toBeInTheDocument();
    expect(await screen.findByText("Java House Africa")).toBeInTheDocument();
    expect(screen.getByText("Amara Osei")).toBeInTheDocument();
    expect(screen.getByText(/unassigned/)).toBeInTheDocument();

    expect(await screen.findByText(/Solution Presented · 1/)).toBeInTheDocument();
    expect(screen.getByText("KES 450,000")).toBeInTheDocument();
    expect(screen.getByText("Stalled · 18 days")).toBeInTheDocument();
    expect(screen.getByText(/Stages only change when someone moves them/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("offers only the quick actions the role may use", async () => {
    renderScreen(<HomeScreen />, salesHandlers(), { ...SALES, permissionKeys: ["leads.create"] });
    expect(await screen.findByRole("link", { name: "New lead" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New task" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log a call" })).toBeNull();
  });

  it("completes a task in one tap, refreshes the home, and offers Undo", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<HomeScreen />, salesHandlers(), SALES);
    await user.click(await screen.findByRole("button", { name: "Mark done: Send inventory proposal to Brookside" }));
    await waitFor(() => expect(r.last("patchTasksByTaskId")).toMatchObject({ params: { taskId: "t1" }, body: { status: "COMPLETED" } }));
    expect(await screen.findByText(/marked done/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(r.last("patchTasksByTaskId")).toMatchObject({ body: { status: "PENDING" } }));
  });

  it("never shows a deal value the API masked: no amounts in the pipeline, the list or the tooltips, and says why", async () => {
    renderScreen(<HomeScreen />, salesHandlers({}, true), SALES);
    expect(await screen.findByText(/Solution Presented · 1/)).toBeInTheDocument();
    await screen.findByText("Stalled · 18 days");
    expect(document.body.textContent).not.toMatch(/KES\s*\d/);
    expect(screen.getAllByRole("note", { name: /Hidden for your role|hidden|masked/i }).length).toBeGreaterThan(0);
  });

  it("shows the design's empty state when there is nothing yet", async () => {
    const handlers = salesHandlers({
      getDashboard: () => ({ available: [], sections: [{ ...salesSection, data: { ...salesSection.data, myDay: { tasksOverdue: 0, tasksToday: 0, meetingsToday: 0 }, hotLeads: { count: 0, top: [] }, pipeline: { open: 0, won: 0, lost: 0, openValue: 0 } } }] }),
      listLeads: () => page([]),
    });
    renderScreen(<HomeScreen />, handlers, SALES);
    expect(await screen.findByRole("heading", { name: "Nothing here yet. Start with your first lead." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first lead" })).toBeInTheDocument();
  });

  it("says nothing is due without a fuss", async () => {
    renderScreen(<HomeScreen />, salesHandlers({ getTasksGroupsByGroup: () => page([]) }), SALES);
    expect(await screen.findByText("Nothing due today. Nice.")).toBeInTheDocument();
  });

  it("shows the design's error state with a retry, and keeps what was saved safe", async () => {
    let fail = true;
    const user = userEvent.setup();
    const r = renderScreen(<HomeScreen />, salesHandlers({ getDashboard: () => (fail ? Promise.reject(apiError(503)) : { available: [], sections: [salesSection] }) }), SALES);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load your dashboard");
    expect(screen.getByText(/Nothing you saved is lost/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("kpi-today")).toBeInTheDocument();
    expect(r.count("getDashboard")).toBeGreaterThan(1);
  });

  it("explains a refusal instead of an error", async () => {
    renderScreen(<HomeScreen />, salesHandlers({ getDashboard: () => Promise.reject(apiError(403, { denial: { yourRole: "Sales", ownerRoles: ["Management"], whoToAsk: ["Dev Management"] } })) }), SALES);
    expect(await screen.findByRole("region", { name: /isn.t part of your workspace|workspace/i })).toBeInTheDocument();
  });

  it("a section that fails on its own is reported in place, with a retry, and the page is not lost", async () => {
    renderScreen(<HomeScreen />, salesHandlers({ getDashboard: () => ({ available: [], sections: [{ key: "sales_today", title: "Today", scope: "", ok: false, error: "This section could not be loaded. The rest of the page is unaffected." }] }) }), SALES);
    expect(await screen.findByRole("alert")).toHaveTextContent("Today could not be loaded");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

/* Management (D2) */

const mgmtSection = {
  key: "management",
  title: "Management overview",
  scope: "The whole organisation",
  ok: true,
  data: {
    thisMonth: { from: "2026-10-01", to: "2026-10-31", metrics: { leadConversion: { total: 35, converted: 10 }, dealOutcomes: { won: { count: 1, value: "1250000" }, lost: { count: 0 } }, salesByService: [{ _count: { _all: 1 }, _sum: { value: "1250000" }, serviceId: "svc1" }], valueMasked: false } },
    lastMonth: { from: "2026-09-01", to: "2026-09-30", metrics: { leadConversion: { total: 20, converted: 2 }, dealOutcomes: { won: { count: 0, value: null }, lost: { count: 2 } }, salesByService: [], valueMasked: false } },
    teamWorkload: [
      { membershipId: "m-a", name: "Dev Sales", openTasks: 6, overdueTasks: 5 },
      { membershipId: "m-b", name: "Dev Sales Two", openTasks: 3, overdueTasks: 0 },
    ],
    overdueByOwner: { tasks: { total: 5, byOwner: [] }, stalledDeals: { total: 3, byOwner: [] } },
    adoption: { rate: 0.83, activeMembers: 6, weeks: [{ from: "2026-10-20", to: "2026-10-27", views: 1063, pagesUsed: 11, activeUsers: 5 }, { from: "2026-10-13", to: "2026-10-20", views: 101, pagesUsed: 8, activeUsers: 2 }, { from: "2026-10-06", to: "2026-10-13", views: 0, pagesUsed: 0, activeUsers: 0 }, { from: "2026-09-29", to: "2026-10-06", views: 0, pagesUsed: 0, activeUsers: 0 }] },
  },
};

function mgmtHandlers(): Handlers {
  return {
    ...salesHandlers({ getDashboard: () => ({ available: [], sections: [mgmtSection] }) }),
    getReferenceData: () => ({ services: [{ id: "svc1", name: "Fleet / GPS" }], members: [] }),
    getReportsSalesBySalesperson: () => ({ rows: [{ ownerMembershipId: "m-a", wonCount: 1 }] }),
    getRenewalsAndRetention: () => ({ lists: { LAPSED: { items: [{ companyId: "c1", companyName: "Hillcrest School", list: "LAPSED", reason: "Hosting lapsed 12 days ago.", service: { daysToRenewal: -12 }, quietDays: null }] }, DUE_30: { items: [] }, GOING_QUIET: { items: [] } } }),
  };
}

describe("Management (D2)", () => {
  it("shows this month against last, the team, revenue, renewals and adoption, with the whole team in scope", async () => {
    const { container } = renderScreen(<HomeScreen />, mgmtHandlers(), { roleName: "Management", permissionKeys: ["leads.create", "reporting.view.all"] });
    expect(await screen.findByText("Whole team")).toBeInTheDocument();
    expect(await screen.findByText("THIS MONTH VS LAST", { exact: false })).toBeInTheDocument();
    const cards = document.querySelectorAll(".fb-mom__card");
    expect(cards).toHaveLength(5);
    // Up is shown with an arrow, as well as colour: new leads 35 against 20.
    expect(cards[0]).toHaveTextContent("▲ 15");
    expect(cards[0]).toHaveTextContent("Last month 20");
    expect(cards[1]).toHaveTextContent("29%"); // 10 of 35
    expect(cards[4]).toHaveTextContent("▼ 2"); // fewer lost deals is good news but still marked as down
    expect(screen.getByTestId("kpi-open")).toHaveTextContent("9");
    expect(screen.getByTestId("kpi-stalled")).toHaveTextContent("3");

    expect(await screen.findByText("Team follow-up health")).toBeInTheDocument();
    const row = (await screen.findByRole("row", { name: /Dev Sales\b(?! Two)/ })) as HTMLElement;
    expect(within(row).getByText("▲ 5")).toBeInTheDocument();
    expect(await screen.findByText("Hillcrest School")).toBeInTheDocument();
    expect(screen.getByText("5 of 6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("every chart has a table view that carries the same numbers", async () => {
    const user = userEvent.setup();
    renderScreen(<HomeScreen />, mgmtHandlers(), { roleName: "Management", permissionKeys: ["reporting.view.all"] });
    const revenue = (await screen.findByRole("heading", { name: "Revenue won by service line" })).closest("section") as HTMLElement;
    // The service names arrive with the reference data, so the chart is named once they have.
    await waitFor(() => expect(within(revenue).getByRole("img")).toHaveAccessibleName(/Fleet \/ GPS KES 1\.3M/));
    await user.click(within(revenue).getByRole("button", { name: "Table" }));
    const table = within(revenue).getByRole("table");
    expect(within(table).getByRole("cell", { name: "KES 1,250,000" })).toBeInTheDocument();
    const adoption = (await screen.findByRole("heading", { name: "Adoption health" })).closest("section") as HTMLElement;
    expect(within(adoption).getByRole("img")).toHaveAccessibleName(/Active members each week/);
    await user.click(within(adoption).getByRole("button", { name: "Table" }));
    expect(within(adoption).getByRole("table")).toHaveTextContent("1063");
  });

  it("keeps masked won value hidden", async () => {
    const handlers = mgmtHandlers();
    const data = JSON.parse(JSON.stringify(mgmtSection));
    data.data.thisMonth.metrics.valueMasked = true;
    renderScreen(<HomeScreen />, { ...handlers, getDashboard: () => ({ available: [], sections: [data] }) }, { roleName: "Management", permissionKeys: [] });
    await screen.findByText("Revenue won by service line");
    expect(document.body.textContent).not.toMatch(/1,?250,?000|KES 1\.3M|KES 1250K/);
  });
});

/* Delivery, Finance, Technical (D3) */

describe("Delivery (D3)", () => {
  const handlers: Handlers = {
    getDashboard: () => ({ available: [], sections: [{ key: "delivery", title: "Delivery", scope: "", ok: true, data: { awaitingOwner: 2, onboardingInProgress: 1, delivered: 4, mine: { onboarding: 1, delivered: 0 } } }] }),
    getTasksGroups: () => ({ counts: { OVERDUE: 0, TODAY: 1, THIS_WEEK: 2, LATER: 0, NO_DATE: 0, DONE: 0 }, groups: [] }),
    getHandoffs: () => page([{ id: "h1", dealId: "d1", status: "AWAITING_OWNER", company: { id: "c1", name: "Davis & Shirtliff" }, service: { name: "Fleet / GPS" }, deliveryOwner: null, startDate: "2026-11-02T00:00:00Z" }]),
    getTasksGroupsByGroup: () => page([]),
  };
  it("shows what needs an owner, my onboardings and my tasks", async () => {
    renderScreen(<HomeScreen />, handlers, { roleName: "Delivery", permissionKeys: ["tasks.create"] });
    expect(await screen.findByText("Delivery view")).toBeInTheDocument();
    expect(await screen.findByTestId("kpi-awaiting")).toHaveTextContent(/Handoffs needing an owner\s*2/);
    expect(screen.getByTestId("kpi-active")).toHaveTextContent("1");
    expect(await screen.findByText("Davis & Shirtliff")).toBeInTheDocument();
    expect(screen.getByText("Needs an owner")).toBeInTheDocument();
    expect(await screen.findByText("No open tasks.")).toBeInTheDocument();
  });
});

describe("Finance (D3)", () => {
  const dash = { key: "finance", title: "Finance", scope: "", ok: true, data: { wonDeals: 2, openValue: null, payments: { available: true, dueThisWeek: { count: 0, outstanding: "0.00" }, overdue: { count: 1, outstanding: "50000.00", oldestDaysOverdue: 12 }, collectedThisMonth: { count: 3, amount: "120000.00" }, outstanding: "50000.00", nothingToCollect: false } } };
  const rows = [
    { dealId: "d1", companyName: "Davis & Shirtliff", serviceName: "Fleet / GPS", dealValue: "1250000.00", currency: "KES", received: "0.00", outstanding: "0.00", state: "NOT_INVOICED", nextNote: null },
    { dealId: "d2", companyName: "Sarova Hotels", serviceName: "CCTV", dealValue: "400000.00", currency: "KES", received: "350000.00", outstanding: "50000.00", state: "OVERDUE", nextNote: "Chase on Friday" },
  ];
  it("shows what to invoice, what is overdue and what was collected, from the payments the API reports", async () => {
    const { container } = renderScreen(<HomeScreen />, { getDashboard: () => ({ available: [], sections: [dash] }), listWonDealPayments: () => page(rows) }, { roleName: "Finance", permissionKeys: [] });
    expect(await screen.findByText("Finance view")).toBeInTheDocument();
    expect(await screen.findByTestId("kpi-to-invoice")).toHaveTextContent(/Won, not yet invoiced\s*1/);
    expect(screen.getByTestId("kpi-overdue")).toHaveTextContent(/Overdue payments\s*1/);
    expect(screen.getByTestId("kpi-collected")).toHaveTextContent("KES 120K");
    expect(await screen.findByText("Sarova Hotels")).toBeInTheDocument();
    expect(screen.getByText("To invoice")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument(); // a status is a word, never colour alone
    expect(screen.getByText("Chase on Friday")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("a payment the API masked stays masked in the table", async () => {
    const masked = rows.map((r) => ({ ...r, dealValue: null, received: null }));
    renderScreen(<HomeScreen />, { getDashboard: () => ({ available: [], sections: [dash] }), listWonDealPayments: () => page(masked) }, { roleName: "Finance", permissionKeys: [] });
    await screen.findByText("Sarova Hotels");
    expect(document.body.textContent).not.toMatch(/1,?250,?000|350,?000/);
  });
});

describe("Restricted Technical (D3)", () => {
  it("shows only their tasks with the client requirements, and never a value or a finance figure", async () => {
    const t = [task("w1", "Install the CCTV at Sarova", iso(2 * 86_400_000), { requirements: "8 cameras\nNight vision", description: "Site visit first", priority: "HIGH", link: { type: "Company", id: "c1", label: "Sarova Hotels" }, assigneeName: "Dev Technical" })];
    const handlers: Handlers = {
      getDashboard: () => ({ available: [], sections: [{ key: "technical", title: "My work", scope: "", ok: true, data: { counts: { OVERDUE: 0, TODAY: 0, THIS_WEEK: 1, LATER: 0, NO_DATE: 0, DONE: 0 }, timeZone: "Africa/Nairobi" } }] }),
      getMyWork: () => ({ timeZone: "Africa/Nairobi", counts: {}, groups: [{ key: "THIS_WEEK", label: "This week", count: 1, items: t }] }),
    };
    const { container } = renderScreen(<HomeScreen />, handlers, { roleName: "Restricted Technical", permissionKeys: ["tasks.create"] });
    expect(await screen.findByRole("heading", { level: 1, name: "My work" })).toBeInTheDocument();
    expect(screen.getAllByText("Assigned to me").length).toBeGreaterThan(0);
    expect(await screen.findByText("Install the CCTV at Sarova")).toBeInTheDocument();
    expect(screen.getByText("CLIENT REQUIREMENTS FOR THIS WORK")).toBeInTheDocument();
    expect(screen.getByText("8 cameras")).toBeInTheDocument();
    expect(screen.getByText("Night vision")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/KES|Pipeline|invoice|payment|margin/i);
    expect(screen.queryByText("Deals moving and stalled")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("says when no work is assigned yet", async () => {
    const handlers: Handlers = { getDashboard: () => ({ available: [], sections: [{ key: "technical", title: "My work", scope: "", ok: true, data: { counts: { OVERDUE: 0, TODAY: 0, THIS_WEEK: 0, LATER: 0, NO_DATE: 0, DONE: 0 }, timeZone: "UTC" } }] }) };
    renderScreen(<HomeScreen />, handlers, { roleName: "Restricted Technical", permissionKeys: ["tasks.create"] });
    expect(await screen.findByRole("heading", { name: "No work assigned yet" })).toBeInTheDocument();
  });
});
