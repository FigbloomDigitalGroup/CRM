/**
 * The phone's bottom navigation (F4.10, design M1). Like the desktop sidebar it is a pure function of the person's permissions, never of a
 * role's name: what you see follows what you can do. Hiding a tab is a courtesy; every API route still checks its own permission.
 *
 * Design: Sales and Management get Today, Leads, Capture (centre), Customers, Tasks; Delivery and Support get Today, Customers, Note (centre),
 * Tasks; Finance gets Today, Customers, Alerts; the technical role gets My work, Tasks, Alerts.
 */

export type MobileTabId = "today" | "leads" | "capture" | "note" | "customers" | "tasks" | "alerts";

export interface MobileTab {
  id: MobileTabId;
  label: string;
  icon: "home" | "users" | "plus" | "contact" | "tasks" | "bell";
  /** The raised orange action in the middle of the bar: opens a sheet instead of a page. */
  center?: boolean;
  /** Path under the organisation's `/m` root. */
  path: string;
}

const has = (keys: readonly string[], k: string) => keys.includes(k);
const any = (keys: readonly string[], ...ks: string[]) => ks.some((k) => has(keys, k));

export function mobileTabs(keys: readonly string[]): MobileTab[] {
  const canLeads = any(keys, "leads.view.own", "leads.view.all", "leads.view.shared");
  const canCapture = has(keys, "leads.create") && has(keys, "contacts.create");
  const canCustomers = any(keys, "companies.view", "contacts.view");
  const canTasks = any(keys, "tasks.view.own", "tasks.view.all");
  const canNote = has(keys, "activities.create") && canCustomers && !canLeads;
  const workOnly = has(keys, "mywork.view");
  const tabs: MobileTab[] = [{ id: "today", label: workOnly ? "My work" : "Today", icon: "home", path: "" }];
  if (canLeads) tabs.push({ id: "leads", label: "Leads", icon: "users", path: "/leads" });
  if (canCapture) tabs.push({ id: "capture", label: "Capture", icon: "plus", center: true, path: "" });
  if (canCustomers) tabs.push({ id: "customers", label: "Customers", icon: "contact", path: "/customers" });
  if (!canCapture && canNote) tabs.push({ id: "note", label: "Note", icon: "plus", center: true, path: "" });
  if (canTasks) tabs.push({ id: "tasks", label: "Tasks", icon: "tasks", path: "/tasks" });
  // People with no lead work and no capture action (Finance, the technical role) get Alerts in the bar; everyone else reaches it from the bell.
  if (!canLeads && !canCapture && !canNote) tabs.push({ id: "alerts", label: "Alerts", icon: "bell", path: "/alerts" });
  return tabs;
}

/** Which tab a path belongs to. */
export function tabForPath(pathname: string, orgSlug: string): MobileTabId | null {
  const root = `/o/${orgSlug}/m`;
  if (!pathname.startsWith(root)) return null;
  const parts = pathname.slice(root.length).replace(/^\//, "").split("/");
  const rest = parts[0];
  if (!rest) return "today";
  if (rest === "leads" || rest === "customers" || rest === "tasks" || rest === "alerts") return rest;
  // A record belongs to the tab it is found from: a lead under Leads, a person or company under Customers.
  if (rest === "record") return parts[1] === "lead" ? "leads" : parts[1] === "contact" || parts[1] === "company" ? "customers" : null;
  return null;
}

/** Organisation pages that have a phone twin: a phone opening one lands on the twin (unless the person chose the desktop view). */
export const PHONE_TWINS: Record<string, string> = {
  "": "/m",
  "/leads": "/m/leads",
  "/tasks": "/m/tasks",
  "/companies": "/m/customers",
  "/contacts": "/m/customers",
  "/notifications": "/m/alerts",
};

export const PHONE_MAX_WIDTH = 640;
