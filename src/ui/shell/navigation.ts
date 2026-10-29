import { canUseResource, resolveScope } from "@/auth/permissions";
import type { NavIcon, NavItem, NavSection, QuickCreateItem } from "./navModel";

/**
 * The shell's navigation (F1.03), from the design's navigation map. A pure function of the person's permissions, so "each role sees only the
 * navigation the matrix allows" is a unit test over the real permission matrix, not a screenshot. It never looks at a role name: what you
 * see follows what you can do (hard rule on role literals).
 *
 * Hiding a link a person cannot use is a courtesy, never the security boundary: every page and every API route checks the same permission
 * itself and answers with the explained no-access.
 */

export type { NavIcon, NavItem, NavSection, QuickCreateItem } from "./navModel";

export interface NavInput {
  permissionKeys: readonly string[];
  membershipId: string;
  /** Counts the owning screens provide, by item key. */
  badges?: Partial<Record<string, number>>;
  /** Pages the member chose to hide from their own sidebar (Preferences, B1.08). The dashboard can never be hidden. */
  hidden?: readonly string[];
}

interface Def {
  section: string;
  key: string;
  label: (ctx: NavInput) => string;
  path: string;
  icon: NavIcon;
  tint: NavItem["tint"];
  allowed: (ctx: NavInput) => boolean;
  /** False until the screen exists (M7 to M9 switch these on as they land), so the nav never links to a page that is not there. */
  built: boolean;
  exact?: boolean;
}

const has = (c: NavInput, key: string) => c.permissionKeys.includes(key);
const any = (c: NavInput, ...keys: string[]) => keys.some((k) => has(c, k));

const SECTIONS: { key: string; label: (c: NavInput) => string; bottom?: boolean }[] = [
  { key: "overview", label: () => "Overview" },
  // Delivery and Finance see won deals only (provisional departure), and the design calls their section "Pipeline".
  { key: "workspace", label: (c) => (resolveScope(c, "deals", "view").scope === "read-only" && !has(c, "leads.view.own") && !has(c, "leads.view.all") ? "Pipeline" : "Sales workspace") },
  { key: "customers", label: () => "Customers" },
  { key: "after-sale", label: () => "After the sale" },
  { key: "insights", label: () => "Insights and settings", bottom: true },
];

const DEFS: Def[] = [
  { section: "overview", key: "dashboard", label: (c) => (has(c, "mywork.view") ? "My work" : "Dashboard"), path: "", icon: "dashboard", tint: "w", allowed: () => true, built: true, exact: true },
  { section: "workspace", key: "leads", label: () => "Leads", path: "/leads", icon: "leads", tint: "g", allowed: (c) => any(c, "leads.view.own", "leads.view.all", "leads.view.shared"), built: true },
  {
    section: "workspace",
    key: "deals",
    label: (c) => (resolveScope(c, "deals", "view").scope === "read-only" ? "Won deals" : "Deals"),
    path: "/deals",
    icon: "deals",
    tint: "g",
    allowed: (c) => canUseResource(c, "deals"),
    built: true,
  },
  { section: "workspace", key: "tasks", label: () => "Tasks", path: "/tasks", icon: "tasks", tint: "g", allowed: (c) => any(c, "tasks.view.own", "tasks.view.all"), built: true },
  { section: "workspace", key: "calendar", label: () => "Calendar", path: "/calendar", icon: "calendar", tint: "g", allowed: (c) => any(c, "tasks.view.own", "tasks.view.all"), built: true },
  // V1.1 commercial screens (M10, demo data): the permissions below are stripped until the organisation's release reaches V1.1.
  { section: "workspace", key: "quotes", label: () => "Quotes", path: "/quotes", icon: "deals", tint: "g", allowed: (c) => any(c, "quotes.create", "quotes.approve"), built: true },
  { section: "workspace", key: "approvals", label: () => "Approvals", path: "/approvals", icon: "handoffs", tint: "g", allowed: (c) => any(c, "quotes.approve", "quotes.create"), built: true },
  { section: "insights", key: "forecast", label: () => "Forecast", path: "/forecast", icon: "reports", tint: "o", allowed: (c) => any(c, "forecast.view.all", "quotes.create"), built: true },
  { section: "customers", key: "companies", label: () => "Companies", path: "/companies", icon: "companies", tint: "o", allowed: (c) => has(c, "companies.view"), built: true },
  { section: "customers", key: "contacts", label: () => "Contacts", path: "/contacts", icon: "contacts", tint: "o", allowed: (c) => has(c, "contacts.view"), built: true },
  { section: "customers", key: "conversations", label: () => "Conversations", path: "/conversations", icon: "conversations", tint: "o", allowed: (c) => has(c, "communications.view"), built: true },
  // Customer Support workspace (FIG-1178, demo data): only the proposed role's ticket permission shows it.
  { section: "customers", key: "support", label: () => "Support", path: "/support", icon: "conversations", tint: "o", allowed: (c) => has(c, "tickets.manage"), built: true },
  { section: "after-sale", key: "handoffs", label: () => "Handoffs", path: "/handoffs", icon: "handoffs", tint: "o", allowed: (c) => any(c, "handoff.manage", "deals.handoff"), built: true },
  { section: "after-sale", key: "renewals", label: () => "Renewals", path: "/renewals", icon: "renewals", tint: "o", allowed: (c) => has(c, "company_services.manage"), built: true },
  { section: "after-sale", key: "payments", label: () => "Payments", path: "/payments", icon: "payments", tint: "o", allowed: (c) => has(c, "finance.view.payments"), built: true },
  {
    section: "insights",
    key: "reports",
    label: (c) => (has(c, "reporting.view.all") ? "Reports" : "My metrics"),
    path: "/reports",
    icon: "reports",
    tint: "o",
    allowed: (c) => any(c, "reporting.view.own", "reporting.view.all"),
    built: true,
  },
  { section: "insights", key: "preferences", label: () => "Preferences", path: "/preferences", icon: "preferences", tint: "o", allowed: () => true, built: true },
  // Preferences (M9) holds every member's own settings, so Settings is only for the people who manage the organisation.
  { section: "insights", key: "settings", label: () => "Settings", path: "/settings", icon: "settings", tint: "o", allowed: (c) => has(c, "configuration.manage"), built: true },
];

export function buildNav(input: NavInput): NavSection[] {
  return SECTIONS.map((s) => ({
    key: s.key,
    label: s.label(input),
    bottom: s.bottom,
    items: DEFS.filter((d) => d.section === s.key && d.built && d.allowed(input) && !(d.key !== "dashboard" && input.hidden?.includes(d.key))).map<NavItem>((d) => ({
      key: d.key,
      label: d.label(input),
      path: d.path,
      icon: d.icon,
      tint: d.tint,
      exact: d.exact,
      badge: input.badges?.[d.key] || undefined,
    })),
  })).filter((s) => s.items.length > 0);
}

/** The Quick create menu: only what the person may create. Archived or read-only contexts disable the whole menu with a reason (see `QuickCreate`). */
export function buildQuickCreate(input: NavInput): QuickCreateItem[] {
  const out: QuickCreateItem[] = [];
  if (has(input, "leads.create")) out.push({ key: "lead", label: "New lead", path: "/leads" });
  if (has(input, "contacts.create")) out.push({ key: "contact", label: "New contact", path: "/contacts" });
  if (has(input, "companies.create")) out.push({ key: "company", label: "New company", path: "/companies" });
  if (has(input, "tasks.create")) out.push({ key: "task", label: "New task", path: "/tasks" });
  if (has(input, "activities.create")) out.push({ key: "note", label: "Log a call or note", path: "/leads" });
  return out;
}
