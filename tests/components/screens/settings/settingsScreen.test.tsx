import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsScreen, SETTINGS_TABS } from "../../../../src/ui/screens/settings/SettingsScreen";
import { buildRoleMatrix } from "../../../../src/ui/screens/settings/matrix";
import { ROLES } from "../../../../prisma/seedData";
import { renderScreen, stubClient, violations } from "../deals/harness";

let tab = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(tab ? `tab=${tab}` : ""),
}));

const MANAGEMENT = ["organization.manage_settings", "configuration.manage", "membership.view", "membership.manage", "role.assign"];

describe("Settings frame (S1, FIG-1106)", () => {
  it("explains why a role that is not Management cannot open Settings, and where its own choices live", async () => {
    tab = "";
    const { client, calls } = stubClient({});
    const { container } = renderScreen(<SettingsScreen />, client, { permissionKeys: ["leads.view.all"], roleName: "Sales" });
    expect(await screen.findByRole("heading", { name: /Settings/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Settings isn’t part of your workspace/ })).toBeInTheDocument();
    expect(screen.getAllByText("Management", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute("href", "/o/figbloom/preferences");
    // Hiding is not the boundary, but a refused role must not even ask the API for settings data.
    expect(calls).toHaveLength(0);
    expect(await violations(container)).toEqual([]);
  });

  it("lists every V1 section for Management and marks the open one", async () => {
    tab = "audit";
    const { client } = stubClient({
      getAuditLogFilters: () => ({ entityTypes: [], actions: [], actors: [], systemEvents: 0 }),
      listAuditLog: () => ({ items: [], page: 1, pageSize: 25, total: 0, pageCount: 1, nextCursor: null }),
    });
    renderScreen(<SettingsScreen />, client, { permissionKeys: MANAGEMENT, roleName: "Management" });
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getAllByRole("link")).toHaveLength(SETTINGS_TABS.length);
    for (const name of ["Organization profile", "Members", "Website integration", "Inbound email", "Reference data", "Automations", "Integrations", "Data migration", "Security & access", "Data & privacy", "Audit log"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Members" })).toHaveAttribute("href", "/o/figbloom/settings?tab=members");
  });

  it("falls back to the first section for an unknown tab", async () => {
    tab = "nonsense";
    const { client } = stubClient({
      getProfile: () => ({ name: "Figbloom", timezone: "Africa/Nairobi", defaultCurrency: "KES", workingDays: ["MON"], phone: null, website: null, address: null, workingHoursStart: null, workingHoursEnd: null }),
      getOrganizationLook: () => ({ name: "Figbloom", shownName: "Figbloom", displayName: null, logoUrl: null, defaultTheme: "FOREST", defaultPageColour: "WHITE", colours: {}, showLogoOnClientPages: false, allowPersonalisation: true }),
    });
    renderScreen(<SettingsScreen />, client, { permissionKeys: MANAGEMENT });
    expect(await screen.findByRole("heading", { name: "Organization profile" })).toBeInTheDocument();
  });
});

describe("the role matrix data (S8, FIG-1111)", () => {
  it("has a column for every V1 role and every V1 permission, from the approved seed", () => {
    const m = buildRoleMatrix();
    expect(m.roles.map((r) => r.key)).toEqual(ROLES.filter((r) => r.key !== "CUSTOMER_SUPPORT").map((r) => r.key));
    const rows = m.areas.flatMap((a) => a.rows);
    expect(rows.length).toBeGreaterThan(40);
    // The permissions that matter most to Settings and payments (hard rule 7: payments are Finance and Management only).
    for (const key of ["configuration.manage", "audit.view", "membership.manage"]) expect(rows.find((r) => r.key === key)?.roles["MANAGEMENT"], key).toBe(true);
    for (const key of ["configuration.manage", "audit.view"]) expect(Object.values(rows.find((r) => r.key === key)!.roles).filter(Boolean), key).toHaveLength(1);
    const payments = rows.filter((r) => r.key.startsWith("finance.view.payments"));
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) expect(Object.entries(p.roles).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(["FINANCE", "MANAGEMENT"]);
  });

  it("is stable: the approved matrix does not change by accident", () => {
    const m = buildRoleMatrix();
    const compact = Object.fromEntries(m.areas.flatMap((a) => a.rows).map((r) => [r.key, m.roles.filter((role) => r.roles[role.key]).map((role) => role.key[0]! + role.key.slice(1, 3)).join(",")]));
    expect(compact).toMatchSnapshot();
  });
});
