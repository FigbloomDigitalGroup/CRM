import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "../prisma/seedData";
import { buildNav, buildQuickCreate } from "../src/ui/shell/navigation";
import { filterNav, isActivePath } from "../src/ui/shell/navModel";

/**
 * F1.03: "each role sees only the navigation the matrix allows". The expected menus below are written out by hand from the signed permission
 * model and the design's navigation map, not read back from the code under test. They run over the real seeded role permissions.
 */

function menu(role: keyof typeof ROLE_PERMISSIONS | string, badges?: Record<string, number>) {
  const keys = ROLE_PERMISSIONS[role]!;
  return buildNav({ permissionKeys: keys, membershipId: "m1", badges }).map((s) => `${s.label}: ${s.items.map((i) => i.label).join(", ")}`);
}

describe("sidebar navigation per role", () => {
  it("Management sees the whole workspace and the organisation reports", () => {
    expect(menu("MANAGEMENT")).toEqual([
      "Overview: Dashboard",
      "Sales workspace: Leads, Deals, Tasks, Calendar",
      "Customers: Companies, Contacts, Conversations",
      "After the sale: Handoffs, Renewals, Payments",
      "Insights & settings: Forecast & targets, Approvals, Reports, Preferences, Settings",
    ]);
  });

  it("Sales sees the pipeline and its own metrics, not the organisation's reports", () => {
    expect(menu("SALES")).toEqual([
      "Overview: Dashboard",
      "Sales workspace: Leads, Deals, Tasks, Calendar",
      "Customers: Companies, Contacts, Conversations",
      "After the sale: Handoffs, Renewals",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Delivery sees won deals only, under the design's Pipeline heading, and no Leads", () => {
    expect(menu("DELIVERY")).toEqual([
      "Overview: Dashboard",
      "Pipeline: Won deals, Tasks, Calendar",
      "Customers: Companies, Contacts, Conversations",
      "After the sale: Handoffs",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Finance sees won deals only, and no Leads or Tasks", () => {
    expect(menu("FINANCE")).toEqual([
      "Overview: Dashboard",
      "Pipeline: Won deals",
      "Customers: Companies, Contacts",
      "After the sale: Payments",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Restricted Technical sees My work and their tasks, and nothing about leads, deals or customers", () => {
    expect(menu("RESTRICTED_TECHNICAL")).toEqual(["Overview: My work", "Sales workspace: Tasks, Calendar", "Customers: Conversations", "Insights & settings: Preferences"]);
  });

  it("Customer Support (behind its flag) sees customers and tasks, no pipeline", () => {
    expect(menu("CUSTOMER_SUPPORT")).toEqual([
      "Overview: Dashboard",
      "Sales workspace: Tasks",
      "Customers: Companies, Contacts, Conversations",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("a person with no permissions at all (a platform identity has no tenant membership) is left with the dashboard and preferences only", () => {
    const nav = buildNav({ permissionKeys: [], membershipId: "none" }).map((s) => s.items.map((i) => i.label));
    expect(nav).toEqual([["Dashboard"], ["Preferences"]]);
  });

  it("never links to a page that is not built yet, even when the role could use it", () => {
    const all = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1" }).flatMap((s) => s.items.map((i) => i.key));
    // Conversations, Renewals and Payments landed in M8 and Preferences in M9 (F4.01); they are linked now.
    expect(all).toEqual(expect.arrayContaining(["conversations", "renewals", "payments", "preferences"]));
  });

  it("badges appear only where the owning screen supplied a count", () => {
    const tasks = buildNav({ permissionKeys: ROLE_PERMISSIONS.SALES!, membershipId: "m1", badges: { tasks: 4 } }).flatMap((s) => s.items).find((i) => i.key === "tasks");
    expect(tasks?.badge).toBe(4);
    const none = buildNav({ permissionKeys: ROLE_PERMISSIONS.SALES!, membershipId: "m1" }).flatMap((s) => s.items).find((i) => i.key === "tasks");
    expect(none?.badge).toBeUndefined();
  });

  it("leaves out the pages the member chose to hide, but never the dashboard", () => {
    const keys = ROLE_PERMISSIONS.SALES!;
    const nav = buildNav({ permissionKeys: keys, membershipId: "m1", hidden: ["deals", "reports", "dashboard"] }).map((s) => s.items.map((i) => i.key));
    expect(nav.flat()).toContain("dashboard");
    expect(nav.flat()).not.toContain("deals");
    expect(nav.flat()).not.toContain("reports");
    expect(nav.flat()).toContain("leads");
  });

  it("every active member can reach Preferences (their own look and notifications), and only Management sees Settings", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(menu(role).join("|")).toContain("Preferences");
      if (role === "MANAGEMENT") expect(menu(role).join("|")).toContain("Settings");
      else expect(menu(role).join("|")).not.toContain("Settings");
    }
  });
});

describe("quick create", () => {
  const kinds = (role: string) => buildQuickCreate({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1" }).map((q) => q.key);
  it("offers only what the role may create", () => {
    expect(kinds("MANAGEMENT")).toEqual(["lead", "contact", "company", "task", "note"]);
    expect(kinds("SALES")).toEqual(["lead", "contact", "company", "task", "note"]);
    expect(kinds("DELIVERY")).toEqual(["task", "note"]);
    expect(kinds("FINANCE")).toEqual([]);
    expect(kinds("RESTRICTED_TECHNICAL")).toEqual(["task"]);
  });
});

describe("navigation helpers", () => {
  const sections = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1" });
  it("the filter box matches labels case-insensitively and drops empty sections", () => {
    expect(filterNav(sections, "LEAD").map((s) => s.items.map((i) => i.label))).toEqual([["Leads"]]);
    expect(filterNav(sections, "zzz")).toEqual([]);
    expect(filterNav(sections, "  ")).toBe(sections);
  });
  it("the dashboard matches only itself; other items match their sub-pages", () => {
    const dash = sections[0]!.items[0]!;
    const leads = sections[1]!.items[0]!;
    expect(isActivePath(dash, "/o/figbloom", "/o/figbloom")).toBe(true);
    expect(isActivePath(dash, "/o/figbloom", "/o/figbloom/leads")).toBe(false);
    expect(isActivePath(leads, "/o/figbloom", "/o/figbloom/leads/abc")).toBe(true);
    expect(isActivePath(leads, "/o/figbloom", "/o/figbloom/leadsx")).toBe(false);
  });
});
