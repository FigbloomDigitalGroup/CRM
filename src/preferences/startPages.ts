import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { canUseResource } from "../auth/permissions";

/**
 * The pages a member may open on sign-in (B1.08), and the ones the sidebar can
 * hide. A page is offered only when the member's role can use it, so a Finance
 * member is never offered Leads. The same predicate validates what is saved and
 * resolves what is stale (a role change can retire a saved start page).
 */
export interface StartPageDef {
  key: string;
  label: string;
  /** Path under `/o/{orgSlug}`. */
  path: string;
  allowed: (ctx: AuthContext) => boolean;
}

export const START_PAGES: readonly StartPageDef[] = [
  { key: "dashboard", label: "Dashboard", path: "", allowed: () => true },
  {
    key: "leads",
    label: "Leads",
    path: "/leads",
    allowed: (c) => hasPermission(c, "leads.view.own") || hasPermission(c, "leads.view.all"),
  },
  { key: "deals", label: "Deals", path: "/deals", allowed: (c) => canUseResource(c, "deals") },
  {
    key: "tasks",
    label: "Tasks",
    path: "/tasks",
    allowed: (c) => hasPermission(c, "tasks.view.own") || hasPermission(c, "tasks.view.all"),
  },
  { key: "contacts", label: "Contacts", path: "/contacts", allowed: (c) => hasPermission(c, "contacts.view") },
  { key: "companies", label: "Companies", path: "/companies", allowed: (c) => hasPermission(c, "companies.view") },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    allowed: (c) => hasPermission(c, "reporting.view.own") || hasPermission(c, "reporting.view.all"),
  },
  {
    key: "settings",
    label: "Settings",
    path: "/settings",
    allowed: (c) => hasPermission(c, "organization.manage_settings"),
  },
];

export function startPagesFor(ctx: AuthContext): StartPageDef[] {
  return START_PAGES.filter((p) => p.allowed(ctx));
}

export function findStartPage(key: string): StartPageDef | undefined {
  return START_PAGES.find((p) => p.key === key);
}
