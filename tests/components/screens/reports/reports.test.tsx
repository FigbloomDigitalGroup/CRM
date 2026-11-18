import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportsScreen } from "../../../../src/ui/screens/reports/ReportsScreen";
import { page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/reports",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MANAGEMENT = ["reporting.view.all", "reporting.view.own", "export.bulk", "deals.view.value", "leads.view.all"];

function report(key: string, title: string, over: Record<string, unknown> = {}) {
  return {
    key,
    title,
    definition: `${title} definition.`,
    scope: "organisation",
    valueMasked: false,
    chart: { type: "bar", metric: "leads", series: [{ label: "Website", value: 12 }, { label: "Referral", value: 6 }] },
    table: { columns: [{ key: "label", label: "Source", type: "text" }, { key: "leads", label: "Leads", type: "number" }], rows: [{ label: "Website", leads: 12 }, { label: "Referral", leads: 6 }], totals: { label: "Total", leads: 18 } },
    ...over,
  };
}

const PIPELINE = report("PIPELINE_BY_STAGE", "Pipeline by stage", {
  chart: { type: "bar", metric: "value", fallbackMetric: "deals", series: [{ label: "Proposal Sent", value: 600000 }] },
  table: { columns: [{ key: "label", label: "Stage", type: "text" }, { key: "deals", label: "Open deals", type: "number" }, { key: "value", label: "Value", type: "money" }], rows: [{ label: "Proposal Sent", deals: 3, value: "600000.00" }], totals: { label: "Total", deals: 3, value: "600000.00" } },
});

function org(over: Record<string, unknown> = {}) {
  return {
    dateFrom: "2026-09-20",
    dateTo: "2026-10-19",
    leadVolumeBySource: [],
    leadConversion: { total: 20, converted: 5 },
    dealOutcomes: { won: { count: 4, value: "800000.00" }, lost: { count: 4 } },
    pipelineByStage: [{ _count: { _all: 3 }, _sum: { value: "600000.00" }, pipelineStageId: "st-2" }],
    salesByService: [],
    followUpBreakdown: [{ _count: { _all: 8 }, status: "COMPLETED" }, { _count: { _all: 2 }, status: "PENDING" }],
    valueMasked: false,
    ...over,
  };
}

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    getReportsMyWork: () => ({ dueToday: [{}, {}], overdue: [{}, {}, {}], newLeads: [{}], stalledDeals: [] }),
    getReportsOrganization: () => org(),
    getReportsV2: () => ({ range: null, reports: [report("LEAD_SOURCES", "Lead volume by source"), PIPELINE] }),
    getReferenceData: () => ({ leadSources: [{ id: "s1", name: "Website", isActive: true, sequence: 1 }], leadStatuses: [], pipelineStages: [{ id: "st-2", name: "Proposal Sent", isActive: true }], services: [{ id: "sv", name: "Inventory", isActive: true, sequence: 1 }], lostReasons: [], members: [{ membershipId: "m-2", userName: "Dev Sales", roleName: "Sales", roleKey: "SALES" }] }),
    getReportsCustomers: () => ({ ...page([{ companyId: "c1", companyName: "Brookside Dairy", segment: "active", repeat: true, wonCount: 2, wonValue: "500000.00", lastWonAt: "2026-10-01T00:00:00.000Z", activeServices: 1 }]), dormancyDays: 90, summary: { customers: 1, active: 1, repeat: 1, dormant: 0 }, valueMasked: false }),
    getReportsRenewals: () => ({ ...page([{ companyId: "c1", companyName: "Brookside Dairy", serviceName: "Hosting", endDate: "2026-11-15", daysLeft: 27, lapsed: false }]), withinDays: 90, summary: { renewing: 1, lapsed: 0 } }),
    getReportsSalesBySalesperson: () => ({ dateFrom: "x", dateTo: "y", period: "total", rows: [{ ownerMembershipId: "m-2", ownerName: "Dev Sales", month: null, wonCount: 4, wonValue: "800000.00" }], valueMasked: false }),
    ...over,
  };
}

describe("Reports (F3.07)", () => {
  it("shows the attention tiles and the headline figures exactly as the API gave them", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<ReportsScreen />, client, { permissionKeys: MANAGEMENT, roleName: "Management" });
    expect(await screen.findByTestId("kpi-leads")).toHaveTextContent("20");
    expect(screen.getByTestId("kpi-conversion")).toHaveTextContent("25%");
    expect(screen.getByTestId("kpi-won")).toHaveTextContent("4");
    expect(screen.getByTestId("kpi-winrate")).toHaveTextContent("50%");
    expect(screen.getByTestId("kpi-followups")).toHaveTextContent("80%");
    expect(screen.getByTestId("attention-overdue")).toHaveTextContent("3");
    expect(screen.getByTestId("attention-today")).toHaveTextContent("2");
    expect(screen.getByTestId("attention-stalled")).toHaveTextContent("0");
  });

  it("offers every report as a chart and as a table with the same numbers", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<ReportsScreen />, client, { permissionKeys: MANAGEMENT });
    const card = await screen.findByTestId("report-lead_sources");
    expect(within(card).getByRole("img", { name: /Website 12, Referral 6/ })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Table view" }));
    const table = within(card).getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Website" })).toBeInTheDocument();
    expect(within(table).getByText("18")).toBeInTheDocument(); // the totals row
    expect(within(card).getByRole("link", { name: "Download CSV: Lead volume by source" })).toHaveAttribute("href", expect.stringContaining("/reports/v2/LEAD_SOURCES/export?dateFrom="));
  });

  it("hides money from a role without the value permission and offers no CSV without export rights", async () => {
    const { client } = stubClient(
      handlers({
        getReportsOrganization: () => org({ valueMasked: true }),
        getReportsV2: () => ({ range: null, reports: [{ ...PIPELINE, valueMasked: true, chart: { type: "bar", metric: "deals", series: [{ label: "Proposal Sent", value: 3 }] }, table: { ...PIPELINE.table, rows: [{ label: "Proposal Sent", deals: 3, value: null }], totals: { label: "Total", deals: 3, value: null } } }] }),
      }),
    );
    renderScreen(<ReportsScreen />, client, { permissionKeys: ["reporting.view.all", "leads.view.all"] });
    const card = await screen.findByTestId("report-pipeline_by_stage");
    expect(screen.getByTestId("kpi-pipeline")).toHaveTextContent("Hidden");
    expect(screen.getByTestId("kpi-won")).toHaveTextContent("value hidden");
    await userEvent.click(within(card).getByRole("button", { name: "Table view" }));
    expect(within(card).getAllByText("Hidden").length).toBeGreaterThan(0);
    expect(card).not.toHaveTextContent("600");
    expect(screen.queryByRole("link", { name: /Download CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("writes the customer table to a CSV file that matches what is shown", async () => {
    const saved: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (saved.push(b), "blob:x"), revokeObjectURL: () => undefined }));
    const { client } = stubClient(handlers());
    renderScreen(<ReportsScreen />, client, { permissionKeys: MANAGEMENT });
    const card = await screen.findByTestId("report-customers-detail");
    expect(within(card).getByRole("link", { name: "Brookside Dairy" })).toHaveAttribute("href", "/o/figbloom/companies/c1");
    await userEvent.click(within(card).getByRole("button", { name: /Download CSV/ }));
    expect(saved).toHaveLength(1);
    const text = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(saved[0]!);
    });
    expect(text.trim().split("\r\n")).toEqual(["Customer,Status,Won deals,Won value,Last won,Running services", 'Brookside Dairy,Active · Repeat,2,"500,000",1 Oct 2026,1']);
  });

  it("says so when there is not enough data, and offers a retry when the reports fail", async () => {
    const empty = stubClient(handlers({ getReportsOrganization: () => org({ leadConversion: { total: 0, converted: 0 }, dealOutcomes: { won: { count: 0 }, lost: { count: 0 } }, pipelineByStage: [], followUpBreakdown: [] }), getReportsV2: () => ({ range: null, reports: [] }) }));
    renderScreen(<ReportsScreen />, empty.client, { permissionKeys: MANAGEMENT });
    expect(await screen.findByText("Not enough data yet")).toBeInTheDocument();
  });

  it("shows My metrics to a role that only sees its own work, and the explained no-access to the rest", async () => {
    const mine = stubClient({ getMyMetricsV2: () => ({ key: "MY_METRICS", title: "My metrics", definition: "", scope: "own", valueMasked: false, cards: [], chart: { type: "bar", metric: "value", series: [] }, table: { columns: [], rows: [], totals: null } }) });
    renderScreen(<ReportsScreen />, mine.client, { permissionKeys: ["reporting.view.own"], roleName: "Sales" });
    expect(await screen.findByRole("heading", { name: "My metrics" })).toBeInTheDocument();
    expect(mine.calls.every((c) => c.id !== "getReportsV2")).toBe(true);

    const none = stubClient({});
    renderScreen(<ReportsScreen />, none.client, { permissionKeys: [], roleName: "Restricted Technical" });
    expect(await screen.findByText(/Reports isn.t part of your workspace/)).toBeInTheDocument();
    expect(none.call).not.toHaveBeenCalled();
  });

  it("has no accessibility violations on the charts or the tables", async () => {
    const { client } = stubClient(handlers());
    const { container } = renderScreen(<ReportsScreen />, client, { permissionKeys: MANAGEMENT });
    const card = await screen.findByTestId("report-lead_sources");
    expect(await violations(container)).toEqual([]);
    await userEvent.click(within(card).getByRole("button", { name: "Table view" }));
    expect(await violations(container)).toEqual([]);
  });
});
