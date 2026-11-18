import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Forecast } from "../../../src/ui/screens/commercial/Forecast";
import { monthName, targetNote, weightedOf } from "../../../src/ui/screens/commercial/forecastMath";
import { REFERENCE, STAGES, apiError, deal, page, renderScreen, stubClient } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/forecast", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const money = (count: number, full: number | null, weighted: number | null) => ({ count, full, weighted });
const person = (over: Record<string, unknown> = {}) => ({
  membershipId: "m-1", name: "Dev Sales", openDeals: 1, wonDeals: 1, state: "on-track", target: 500000, won: 200000, weighted: 300000, forecast: 500000, shortBy: 0, attainmentPercent: 40, ...over,
});
const forecast = (over: Record<string, unknown> = {}) => ({
  scope: "team", month: "2026-11", months: 2, asOf: "2026-11-05T08:00:00.000Z", currency: "KES", valueMasked: false,
  stages: [{ id: "st-2", key: "PROPOSAL_SENT", name: "Proposal Sent", probability: 50, probabilitySet: true, ...money(1, 450000, 225000) }],
  pipeline: money(1, 450000, 225000),
  buckets: [{ month: "2026-11", ...money(0, 0, 0) }, { month: "2026-12", ...money(1, 450000, 225000) }],
  earlier: money(0, 0, 0), later: money(0, 0, 0), unscheduled: money(0, 0, 0),
  won: { count: 1, total: 200000 }, people: [person()], team: { state: "on-track", target: 500000, won: 200000, weighted: 300000, forecast: 500000, shortBy: 0, attainmentPercent: 40, targetSource: "sum-of-people" },
  ...over,
});
const DEAL = deal({ id: "d1", company: "Kijani Foods", stage: STAGES[1]! });
const handlers = (f: unknown, extra: Record<string, () => unknown> = {}) => ({
  getForecast: () => f,
  getDeals: () => page([DEAL, deal({ id: "d2", company: "Savannah Logistics", stage: STAGES[1]!, ownerMembershipId: "m-2", value: null, valueMasked: true })]),
  getReferenceData: () => REFERENCE,
  ...extra,
});
const MANAGER = ["forecast.view.all", "targets.manage", "deals.view.value"];

describe("forecast and targets read the real API (FIG-1170)", () => {
  it("draws the totals, buckets and targets from the API and asks for the team scope", async () => {
    const stub = stubClient(handlers(forecast()));
    renderScreen(<Forecast />, stub.client, { permissionKeys: MANAGER, membershipId: "m-mg" });
    expect(await screen.findByRole("img", { name: /Weighted closes: NOV .*DEC KES 225K/ })).toBeInTheDocument();
    expect(stub.calls.find((c) => c.id === "getForecast")?.args.query).toEqual({ scope: "team" });
    expect(screen.getByText("Won in November")).toBeInTheDocument();
    expect(screen.getByLabelText("Target for Dev Sales")).toHaveValue(500000);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Expected closes by month" })).toBeInTheDocument();
    expect(screen.getByText("Kijani Foods")).toBeInTheDocument();
  });

  it("saves an edited target with PUT /forecast/targets", async () => {
    const put = vi.fn(() => ({ id: "t1" }));
    const stub = stubClient(handlers(forecast(), { putForecastTargets: put }));
    renderScreen(<Forecast />, stub.client, { permissionKeys: MANAGER, membershipId: "m-mg" });
    const input = await screen.findByLabelText("Target for Dev Sales");
    await userEvent.clear(input);
    await userEvent.type(input, "600000");
    await userEvent.tab();
    await waitFor(() => expect(stub.calls.some((c) => c.id === "putForecastTargets")).toBe(true));
    expect(stub.calls.find((c) => c.id === "putForecastTargets")?.args.body).toEqual({ month: "2026-11", membershipId: "m-1", amount: 600000 });
  });

  it("renders masked money as masked, never a number, and shows counts in the chart", async () => {
    const f = forecast({
      valueMasked: true, pipeline: money(2, null, null), buckets: [{ month: "2026-11", ...money(0, null, null) }, { month: "2026-12", ...money(2, null, null) }],
      won: { count: 1, total: null }, team: { state: "masked", target: 500000, won: null, weighted: null, forecast: null, shortBy: null, attainmentPercent: null, targetSource: "team" },
      people: [person({ membershipId: "m-2", name: "Dev Sales Two", state: "masked", won: null, weighted: null, forecast: null, shortBy: null, attainmentPercent: null })],
    });
    const stub = stubClient(handlers(f));
    renderScreen(<Forecast />, stub.client, { permissionKeys: ["forecast.view.all"], membershipId: "m-mg" });
    expect(await screen.findByRole("img", { name: /DEC 2 deals/ })).toBeInTheDocument();
    expect(screen.getAllByRole("note").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/Target for/)).not.toBeInTheDocument();
  });

  it("a Sales member asks for their own scope and cannot edit targets", async () => {
    const stub = stubClient(handlers(forecast({ scope: "mine", team: null })));
    renderScreen(<Forecast />, stub.client, { permissionKeys: ["deals.view.own", "reporting.view.own"], membershipId: "m-1" });
    expect(await screen.findByRole("img", { name: /Weighted closes/ })).toBeInTheDocument();
    expect(stub.calls.find((c) => c.id === "getForecast")?.args.query).toEqual({ scope: "mine" });
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Target for/)).not.toBeInTheDocument();
    expect(screen.queryByText("Savannah Logistics")).not.toBeInTheDocument();
  });

  it("explains a V1 organisation (FEATURE_UNAVAILABLE) instead of failing", async () => {
    const unavailable = apiError(403, "Forecast arrives with V1.1.", { code: "FEATURE_UNAVAILABLE", feature: { key: "release.v11", reason: "release", availableIn: "V1.1" } });
    const stub = stubClient({ getForecast: () => unavailable });
    renderScreen(<Forecast />, stub.client, { permissionKeys: MANAGER });
    expect(await screen.findByText("Forecast is not available yet")).toBeInTheDocument();
  });

  it("a role with no forecast permission gets the explained no-access without calling the API", () => {
    const stub = stubClient({});
    renderScreen(<Forecast />, stub.client, { permissionKeys: [] });
    expect(screen.getByText(/access/i)).toBeInTheDocument();
    expect(stub.calls).toHaveLength(0);
  });
});

describe("forecast display helpers", () => {
  it("names months, rounds a weighted value to the cent, and words the target state", () => {
    expect(monthName("2026-11")).toBe("November");
    expect(monthName("2026-01", true)).toBe("JAN");
    expect(weightedOf("450000", 50)).toBe(225000);
    expect(weightedOf(null, 50)).toBeNull();
    expect(targetNote("no-target", null, String)).toMatch(/set a target/);
    expect(targetNote("short", 1000, (n) => `K${n}`)).toContain("K1000 short");
  });
});
