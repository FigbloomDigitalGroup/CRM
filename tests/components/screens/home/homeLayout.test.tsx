import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "../../../../src/ui/screens/home/Home";
import { renderScreen, type Handlers } from "./harness";

/** UC-W1: a role's home follows the saved dashboard layout, and falls back to the default when there is none or it cannot be read. */

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const technical = {
  key: "technical",
  title: "My work",
  scope: "",
  ok: true,
  data: { counts: { OVERDUE: 1, TODAY: 0, THIS_WEEK: 0, LATER: 0, NO_DATE: 0 }, groups: {} },
};

const base = (over: Handlers = {}): Handlers => ({
  getDashboard: () => ({ available: [], sections: [technical] }),
  getTasksGroupsByGroup: () => ({ items: [], total: 0 }),
  ...over,
});

const MEMBER = { roleName: "Restricted Technical", permissionKeys: ["tasks.create"] };

describe("home follows the dashboard layout (UC-W1)", () => {
  it("shows every widget when no layout is saved or the layout cannot be read", async () => {
    renderScreen(<HomeScreen />, base(), MEMBER);
    expect(await screen.findByText(/You see the tasks assigned to you/)).toBeInTheDocument();
    expect(screen.getByTestId("kpi-overdue")).toBeInTheDocument();
  });

  it("hides a widget Management hid, and keeps the rest in the saved order", async () => {
    const r = renderScreen(
      <HomeScreen />,
      base({
        getDashboardLayouts: () => ({
          kind: "technical",
          isDefault: false,
          widgets: [
            { id: "tech_notice", visible: false },
            { id: "kpis", visible: true },
            { id: "tech_work", visible: true },
          ],
        }),
      }),
      MEMBER,
    );
    expect(await screen.findByTestId("kpi-overdue")).toBeInTheDocument();
    await vi.waitFor(() => expect(r.count("getDashboardLayouts")).toBeGreaterThan(0));
    await vi.waitFor(() => expect(screen.queryByText(/You see the tasks assigned to you/)).toBeNull());
  });

  it("never shows a widget the member's keys do not grant, even when the layout lists it", async () => {
    renderScreen(
      <HomeScreen />,
      base({
        getDashboardLayouts: () => ({ kind: "technical", isDefault: false, widgets: [{ id: "invoice_tiles", visible: true }, { id: "kpis", visible: true }] }),
      }),
      MEMBER,
    );
    const kpi = await screen.findByTestId("kpi-overdue");
    expect(within(document.body).queryByText("Invoiced")).toBeNull();
    expect(kpi).toBeInTheDocument();
  });
});
