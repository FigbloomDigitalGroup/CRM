/**
 * The navigation's data shapes and the pure helpers the browser needs. Kept apart from `navigation.ts` (which reads the permission matrix
 * and so stays on the server): the layout builds the sections there and hands this plain data to the sidebar.
 */

export type NavIcon =
  | "dashboard"
  | "leads"
  | "deals"
  | "tasks"
  | "calendar"
  | "companies"
  | "contacts"
  | "conversations"
  | "communication"
  | "mail"
  | "chat"
  | "video"
  | "handoffs"
  | "renewals"
  | "payments"
  | "reports"
  | "preferences"
  | "settings";

export interface NavItem {
  key: string;
  label: string;
  /** Path under `/o/{orgSlug}`; empty for the dashboard. */
  path: string;
  icon: NavIcon;
  /** The sidebar's icon tint in the design: green (sales), orange (customers and after the sale), white (overview). */
  tint: "w" | "g" | "o";
  /** The count shown as a badge, when the owning screen supplies one (unread notifications, overdue tasks). */
  badge?: number;
  /** Exact match only (the dashboard root would otherwise match every page). */
  exact?: boolean;
}

export interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
  /** The bottom group ("Insights and settings"). */
  bottom?: boolean;
  /** A dropdown group (the Communication group, F6.20): the label is a button that opens and closes its links. */
  collapsible?: boolean;
  /** The icon beside a collapsible group's label. */
  icon?: NavIcon;
}

export interface QuickCreateItem {
  key: "lead" | "contact" | "company" | "task" | "note";
  label: string;
  /** The page that owns the create form until the create drawers land (M7, M8). */
  path: string;
}

/** The links the sidebar's filter box matches: by label, case-insensitively. Sections with no match disappear. */
export function filterNav(sections: NavSection[], query: string): NavSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections.map((s) => ({ ...s, items: s.items.filter((i) => i.label.toLowerCase().includes(q)) })).filter((s) => s.items.length > 0);
}

/** True when any link of the group is the current page, so a collapsible group opens by itself on the page it holds. */
export function sectionHasActive(section: NavSection, base: string, pathname: string | null): boolean {
  return section.items.some((i) => isActivePath(i, base, pathname));
}

/** The count on a collapsible group's header: the sum of its links' badges (nothing when none has one). */
export function sectionBadge(section: NavSection): number | undefined {
  const total = section.items.reduce((n, i) => n + (i.badge ?? 0), 0);
  return total > 0 ? total : undefined;
}

export function isActivePath(item: NavItem, base: string, pathname: string | null): boolean {
  const href = `${base}${item.path}`;
  if (!pathname) return false;
  if (item.exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
