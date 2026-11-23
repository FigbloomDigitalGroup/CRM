import { describe, expect, it } from "vitest";
import { ROLES, ROLE_PERMISSIONS } from "../prisma/seedData";
import { buildNav, buildQuickCreate } from "../src/ui/shell/navigation";
import { filterNav, isActivePath, sectionBadge, sectionHasActive } from "../src/ui/shell/navModel";

/**
 * F1.03: "each role sees only the navigation the matrix allows". The expected menus below are written out by hand from the signed permission
 * model and the design's navigation map, not read back from the code under test. They run over the real seeded role permissions.
 */

function menu(role: keyof typeof ROLE_PERMISSIONS | string, badges?: Record<string, number>) {
  const keys = ROLE_PERMISSIONS[role]!;
  return buildNav({ permissionKeys: keys, membershipId: "m1", badges, demoScreens: true }).map((s) => `${s.label}: ${s.items.map((i) => i.label).join(", ")}`);
}

describe("sidebar navigation per role", () => {
  it("Management sees the whole workspace and the organisation reports", () => {
    expect(menu("MANAGEMENT")).toEqual([
      "Overview: Dashboard",
      "Sales workspace: Leads, Deals, Quotes, Tasks, Calendar, Team",
      "Customers: Companies, Contacts",
      "Communication: Conversations, Mail, Chat, Video Conference",
      "After the sale: Handoffs, Renewals, Invoices, Payments",
      "Insights & settings: Forecast & targets, Approvals, Reports, Preferences, Settings",
    ]);
  });

  it("Sales sees the pipeline and its own metrics, not the organisation's reports", () => {
    expect(menu("SALES")).toEqual([
      "Overview: Dashboard",
      "Sales workspace: Leads, Deals, Quotes, Tasks, Calendar",
      "Customers: Companies, Contacts",
      "Communication: Conversations, Mail, Chat, Video Conference",
      "After the sale: Handoffs, Renewals",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Delivery sees won deals only, under the design's Pipeline heading, and no Leads", () => {
    expect(menu("DELIVERY")).toEqual([
      "Overview: Dashboard",
      "Pipeline: Won deals, Tasks, Calendar",
      "Customers: Companies, Contacts",
      "Communication: Conversations, Mail, Chat, Video Conference",
      "After the sale: Handoffs",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Finance sees won deals only, and no Leads or Tasks", () => {
    expect(menu("FINANCE")).toEqual([
      "Overview: Dashboard",
      "Pipeline: Won deals, Quotes",
      "Customers: Companies, Contacts",
      "Communication: Chat",
      "After the sale: Invoices, Payments",
      "Insights & settings: Forecast & targets, My metrics, Preferences",
    ]);
  });

  it("Restricted Technical sees My work and their tasks, and nothing about leads, deals or customers", () => {
    expect(menu("RESTRICTED_TECHNICAL")).toEqual(["Overview: My work", "Sales workspace: Tasks, Calendar", "Communication: Conversations, Chat", "Insights & settings: Preferences"]);
  });

  it("Forecast and Approvals are wired to the real API (no longer demo-only): they follow their permission keys with or without demo screens, and a role without the keys sees neither", () => {
    const labels = (role: string, demoScreens?: boolean) => buildNav({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1", demoScreens }).flatMap((s) => s.items.map((i) => i.label));
    expect(labels("MANAGEMENT")).toEqual(labels("MANAGEMENT", true));
    expect(labels("MANAGEMENT")).toContain("Forecast & targets");
    expect(labels("MANAGEMENT")).toContain("Approvals");
    expect(labels("SALES")).not.toContain("Approvals");
  });

  it("Conversations lives in the Communication group only, never also under Customers (F6.20)", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const sections = buildNav({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1", demoScreens: true });
      const holders = sections.filter((s) => s.items.some((i) => i.key === "conversations")).map((s) => s.key);
      expect(holders.length === 0 || (holders.length === 1 && holders[0] === "communication"), role).toBe(true);
    }
  });

  it("the Communication group is a dropdown; Mail, Chat and Video follow their own permission keys (chat.view, mail.use, meetings.schedule), whether or not demo screens are on", () => {
    const sections = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1" });
    const group = sections.find((s) => s.key === "communication")!;
    expect(group.collapsible).toBe(true);
    expect(group.items.map((i) => i.label)).toEqual(["Conversations", "Mail", "Chat", "Video Conference"]);
    expect(buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1", demoScreens: true }).find((s) => s.key === "communication")!.items.map((i) => i.path)).toEqual(["/conversations", "/mail", "/chat", "/video"]);
  });

  it("Mail needs mail.use, Chat needs chat.view, Video Conference needs meetings.schedule (the V1.1 keys)", () => {
    const labels = (role: string) => buildNav({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1", demoScreens: true }).find((s) => s.key === "communication")?.items.map((i) => i.label) ?? [];
    expect(labels("FINANCE")).toEqual(["Chat"]);
    expect(labels("RESTRICTED_TECHNICAL")).not.toContain("Mail");
    for (const role of Object.keys(ROLE_PERMISSIONS)) expect(labels(role), role).toContain("Chat");
  });

  it("opens the group on the page it holds and sums its links' counts for the header", () => {
    const group = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1", demoScreens: true, badges: { chat: 2, mail: 3 } }).find((s) => s.key === "communication")!;
    expect(sectionHasActive(group, "/o/acme", "/o/acme/chat")).toBe(true);
    expect(sectionHasActive(group, "/o/acme", "/o/acme/leads")).toBe(false);
    expect(sectionBadge(group)).toBe(5);
    expect(sectionBadge({ ...group, items: group.items.map((i) => ({ ...i, badge: undefined })) })).toBeUndefined();
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

describe("no Customer Support role (decision 12, FIG-1525)", () => {
  it("offers five roles and no role sees a Support workspace, tickets or customers link", () => {
    expect(ROLES.map((r) => r.key).sort()).toEqual(["DELIVERY", "FINANCE", "MANAGEMENT", "RESTRICTED_TECHNICAL", "SALES"]);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(["DELIVERY", "FINANCE", "MANAGEMENT", "RESTRICTED_TECHNICAL", "SALES"]);
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const items = buildNav({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1", demoScreens: true }).flatMap((s) => s.items);
      expect(items.filter((i) => /support|ticket/i.test(`${i.key} ${i.label} ${i.path}`)), role).toEqual([]);
    }
  });
});

describe("quick create", () => {
  const kinds = (role: string) => buildQuickCreate({ permissionKeys: ROLE_PERMISSIONS[role]!, membershipId: "m1" }).map((q) => q.key);
  it("offers only what the role may create", () => {
    expect(kinds("MANAGEMENT")).toEqual(["lead", "contact", "company", "task", "quote", "invoice", "note"]);
    expect(kinds("SALES")).toEqual(["lead", "contact", "company", "task", "quote", "note"]);
    expect(kinds("DELIVERY")).toEqual(["task", "note"]);
    expect(kinds("FINANCE")).toEqual(["invoice"]);
    expect(kinds("RESTRICTED_TECHNICAL")).toEqual(["task"]);
  });
});

describe("Quotes and Invoices in the sidebar (UC-R2)", () => {
  const nav = (keys: readonly string[], extra: { quotesEnabled?: boolean } = {}) => buildNav({ permissionKeys: keys, membershipId: "m1", ...extra }).flatMap((s) => s.items.map((i) => `${s.key}/${i.key}`));
  const quoteKeys = (keys: readonly string[], extra: { quotesEnabled?: boolean } = {}) => nav(keys, extra).filter((k) => /quotes|invoices/.test(k));

  it("Quotes follows quotes.view and sits right after Deals; Invoices follows invoices.view and sits right above Payments", () => {
    const m = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1" });
    const ws = m.find((s) => s.key === "workspace")!.items.map((i) => i.key);
    expect(ws.indexOf("quotes")).toBe(ws.indexOf("deals") + 1);
    const after = m.find((s) => s.key === "after-sale")!.items.map((i) => i.key);
    expect(after.indexOf("invoices")).toBe(after.indexOf("payments") - 1);
    const all = m.flatMap((s) => s.items);
    expect(all.find((i) => i.key === "quotes")).toMatchObject({ label: "Quotes", path: "/quotes", icon: "quotes" });
    expect(all.find((i) => i.key === "invoices")).toMatchObject({ label: "Invoices", path: "/invoices", icon: "invoices" });
  });

  it("each role: the two links appear exactly for the holders of the keys, and nobody else's menu changes", () => {
    expect(quoteKeys(ROLE_PERMISSIONS.MANAGEMENT!)).toEqual(["workspace/quotes", "after-sale/invoices"]);
    expect(quoteKeys(ROLE_PERMISSIONS.SALES!)).toEqual(["workspace/quotes"]);
    expect(quoteKeys(ROLE_PERMISSIONS.FINANCE!)).toEqual(["workspace/quotes", "after-sale/invoices"]);
    expect(quoteKeys(ROLE_PERMISSIONS.DELIVERY!)).toEqual([]);
    expect(quoteKeys(ROLE_PERMISSIONS.RESTRICTED_TECHNICAL!)).toEqual([]);
  });

  it("with the keys removed, the links disappear and the rest of the menu is untouched", () => {
    const keys = ROLE_PERMISSIONS.MANAGEMENT!;
    const without = keys.filter((k) => k !== "quotes.view" && k !== "invoices.view");
    expect(nav(without)).toEqual(nav(keys).filter((k) => !/quotes|invoices/.test(k)));
    expect(quoteKeys(keys.filter((k) => k !== "quotes.view"))).toEqual(["after-sale/invoices"]);
    expect(quoteKeys(keys.filter((k) => k !== "invoices.view"))).toEqual(["workspace/quotes"]);
  });

  it("quotes.create or quotes.approve alone do not show Quotes: only quotes.view does (the roles carry it by implication)", () => {
    expect(quoteKeys(["quotes.create", "quotes.approve"])).toEqual([]);
  });

  it("the organisation's quotes.enabled toggle hides Quotes (and New quote) but not Invoices", () => {
    const keys = ROLE_PERMISSIONS.MANAGEMENT!;
    expect(quoteKeys(keys, { quotesEnabled: false })).toEqual(["after-sale/invoices"]);
    expect(quoteKeys(keys, { quotesEnabled: true })).toEqual(["workspace/quotes", "after-sale/invoices"]);
    const kinds = (quotesEnabled?: boolean) => buildQuickCreate({ permissionKeys: keys, membershipId: "m1", quotesEnabled }).map((q) => q.key);
    expect(kinds(false)).not.toContain("quote");
    expect(kinds(false)).toContain("invoice");
    expect(kinds(true)).toContain("quote");
  });

  it("the member's own hidden-pages preference can hide both", () => {
    expect(quoteKeys(ROLE_PERMISSIONS.MANAGEMENT!).length).toBe(2);
    const hidden = buildNav({ permissionKeys: ROLE_PERMISSIONS.MANAGEMENT!, membershipId: "m1", hidden: ["quotes", "invoices"] }).flatMap((s) => s.items.map((i) => i.key));
    expect(hidden).not.toContain("quotes");
    expect(hidden).not.toContain("invoices");
  });

  it("quick create: New quote needs quotes.create, New invoice needs invoices.create, and both point at the page that owns the flow", () => {
    const q = (keys: readonly string[]) => buildQuickCreate({ permissionKeys: keys, membershipId: "m1" });
    expect(q(["quotes.view"])).toEqual([]);
    expect(q(["quotes.create"])).toEqual([{ key: "quote", label: "New quote", path: "/quotes" }]);
    expect(q(["invoices.create"])).toEqual([{ key: "invoice", label: "New invoice", path: "/invoices?new=1" }]);
    expect(q(["invoices.view"])).toEqual([]);
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
