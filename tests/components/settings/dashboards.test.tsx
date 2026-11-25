import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardsEditor } from "../../../src/ui/screens/settings/Dashboards";
import { defaultLayout } from "../../../src/ui/screens/home/catalogue";
import { renderScreen, stubClient } from "../screens/deals/harness";
import type { Handler } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const view = (kind: string, widgets = defaultLayout("sales"), isDefault = true) => ({ kind, widgets, isDefault });

describe("Settings: Dashboards (UC-W1)", () => {
  it("lists a role's widgets, moves and hides them, and saves the whole order", async () => {
    const bodies: unknown[] = [];
    const handlers: Record<string, Handler> = {
      getDashboardLayouts: () => view("sales"),
      putDashboardLayouts: ({ body }) => (bodies.push(body), view("sales", (body as { widgets: never[] }).widgets, false)),
    };
    const { client } = stubClient(handlers);
    renderScreen(<DashboardsEditor />, client, { permissionKeys: ["configuration.manage"], roleName: "Management" });
    const list = await screen.findByRole("list", { name: "Sales dashboard widgets" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Key figures");
    expect(screen.getByText(/People only ever see the widgets their permissions allow/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move To do down" }));
    await userEvent.click(screen.getByRole("switch", { name: "Show Quotes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const sent = bodies[0] as { kind: string; widgets: { id: string; visible: boolean }[] };
    expect(sent.kind).toBe("sales");
    expect(sent.widgets.map((w) => w.id).slice(0, 3)).toEqual(["kpis", "new_leads", "todo"]);
    expect(sent.widgets.find((w) => w.id === "quotes")?.visible).toBe(false);
  });

  it("resets a role to the default by sending null", async () => {
    const bodies: unknown[] = [];
    const { client } = stubClient({
      getDashboardLayouts: () => view("sales", defaultLayout("sales"), false),
      putDashboardLayouts: ({ body }) => (bodies.push(body), view("sales")),
    });
    renderScreen(<DashboardsEditor />, client, { permissionKeys: ["configuration.manage"], roleName: "Management" });
    await userEvent.click(await screen.findByRole("button", { name: "Reset to default" }));
    await waitFor(() => expect(bodies).toEqual([{ kind: "sales", widgets: null }]));
  });

  it("is read-only without configuration.manage", async () => {
    const { client } = stubClient({ getDashboardLayouts: () => view("sales") });
    renderScreen(<DashboardsEditor />, client, { permissionKeys: [], roleName: "Sales" });
    expect(await screen.findByRole("switch", { name: "Show Quotes" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
  });
});
