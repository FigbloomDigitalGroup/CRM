/**
 * The dashboard widget catalogue (UC-W1, FIG-1802): every tile and panel of the role homes, what it needs, and where it sits by default.
 * Pure data and functions, no React and no server imports, so the screen, the API route and the tests all use the same list.
 *
 * Management may HIDE or REORDER the widgets of a role's home. It can never add one the person's permission keys do not grant (rule 7):
 * `resolveLayout` drops every widget the keys do not cover, whatever was stored.
 */

export const HOME_KINDS = ["management", "sales", "delivery", "finance", "technical", "marketing"] as const;
export type HomeKind = (typeof HOME_KINDS)[number];

export const HOME_KIND_LABEL: Record<HomeKind, string> = {
  management: "Management",
  sales: "Sales",
  delivery: "Delivery",
  finance: "Finance",
  technical: "Restricted Technical",
  marketing: "Marketing",
};

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  /** The homes this widget may appear on. */
  kinds: HomeKind[];
  /** Permission keys the person must ALL hold. */
  keys: string[];
  /** The person must hold at least one of these (when given). */
  anyKeys?: string[];
  /** "full" widgets take the whole row; "panel" widgets sit two to a row. */
  width: "full" | "panel";
  /** Default position per home (lower first). */
  order: Partial<Record<HomeKind, number>>;
  /** A widget that cannot be hidden (the home would be empty without it). */
  locked?: boolean;
}

const INVOICE_KEYS = ["invoices.view", "finance.view.payments"];

export const DASHBOARD_WIDGETS: WidgetDef[] = [
  { id: "first_run", title: "Getting started checklist", description: "The first steps for a new organisation.", kinds: ["management"], keys: [], width: "full", order: { management: 1 } },
  { id: "kpis", title: "Key figures", description: "The headline tiles at the top of the home.", kinds: ["management", "sales", "delivery", "finance", "technical"], keys: [], width: "full", order: { management: 2, sales: 1, delivery: 1, finance: 1, technical: 1 } },
  { id: "todo", title: "To do", description: "Tasks that need attention.", kinds: ["management", "sales"], keys: [], width: "panel", order: { management: 3, sales: 2 } },
  { id: "new_leads", title: "New leads", description: "Leads that arrived since the last visit.", kinds: ["management", "sales"], keys: [], width: "panel", order: { management: 4, sales: 3 } },
  { id: "pipeline", title: "Pipeline by stage", description: "Open deals by stage.", kinds: ["management", "sales"], keys: [], width: "panel", order: { management: 5, sales: 4 } },
  { id: "moving", title: "Moving and stalled deals", description: "Deals that moved and deals gone quiet.", kinds: ["management", "sales"], keys: [], width: "panel", order: { management: 6, sales: 5 } },
  { id: "invoice_drafts", title: "Invoice drafts to prepare", description: "Won deals without an invoice yet (names only).", kinds: ["sales"], keys: [], anyKeys: ["invoices.view", "invoices.create"], width: "panel", order: { sales: 6 } },
  { id: "invoice_tiles", title: "Invoice tiles", description: "Invoiced, collected and overdue.", kinds: ["management", "finance"], keys: INVOICE_KEYS, width: "full", order: { management: 7, finance: 2 } },
  { id: "quotes", title: "Quotes", description: "Where the quotes stand.", kinds: ["management", "sales"], keys: ["quotes.view"], width: "panel", order: { management: 8, sales: 7 } },
  { id: "social", title: "Social snapshot", description: "Followers and mentions needing a reply.", kinds: ["management"], keys: ["social.view"], width: "panel", order: { management: 9 } },
  { id: "month_vs_last", title: "This month against last", description: "The month compared with the one before.", kinds: ["management"], keys: [], width: "full", order: { management: 10 } },
  { id: "revenue", title: "Revenue by service", description: "Won value split by service.", kinds: ["management"], keys: [], width: "panel", order: { management: 11 } },
  { id: "team_health", title: "Team health", description: "Workload and follow-up health per person.", kinds: ["management"], keys: [], width: "panel", order: { management: 12 } },
  { id: "retention", title: "Retention", description: "Renewals and customers at risk.", kinds: ["management"], keys: [], width: "panel", order: { management: 13 } },
  { id: "adoption", title: "Adoption", description: "How much of the CRM the team is using.", kinds: ["management"], keys: [], width: "panel", order: { management: 14 } },
  { id: "handed_off", title: "Handed-off deals", description: "Won work coming to Delivery.", kinds: ["delivery"], keys: [], width: "panel", order: { delivery: 2 } },
  { id: "my_tasks", title: "My tasks", description: "Open tasks assigned to me.", kinds: ["delivery"], keys: [], width: "panel", order: { delivery: 3 } },
  { id: "won_deals", title: "Won deals", description: "Won deals with their contract amount and payment state.", kinds: ["finance"], keys: [], width: "panel", order: { finance: 3 } },
  { id: "ageing", title: "Ageing", description: "Outstanding invoices in age buckets.", kinds: ["finance"], keys: INVOICE_KEYS, width: "panel", order: { finance: 4 } },
  { id: "tech_notice", title: "Access notice", description: "What a Restricted Technical person can see.", kinds: ["technical"], keys: [], width: "full", order: { technical: 2 } },
  { id: "tech_work", title: "My work", description: "Assigned tasks with the client requirements.", kinds: ["technical"], keys: [], width: "full", order: { technical: 3 } },
  { id: "social_overview", title: "Social overview", description: "Channels, followers, mentions and campaigns.", kinds: ["marketing"], keys: ["social.view"], width: "full", order: { marketing: 1 }, locked: true },
];

export interface LayoutEntry {
  id: string;
  visible: boolean;
}

const byId = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

export function widgetsFor(kind: HomeKind): WidgetDef[] {
  return DASHBOARD_WIDGETS.filter((w) => w.kinds.includes(kind)).sort((a, b) => (a.order[kind] ?? 99) - (b.order[kind] ?? 99));
}

/** Whether a person holding `can` may see the widget at all. */
export function widgetAllowed(w: WidgetDef, can: (key: string) => boolean): boolean {
  return w.keys.every(can) && (!w.anyKeys || w.anyKeys.some(can));
}

export function defaultLayout(kind: HomeKind): LayoutEntry[] {
  return widgetsFor(kind).map((w) => ({ id: w.id, visible: true }));
}

/**
 * The layout a person gets: the stored one (if any) merged with the catalogue. Unknown ids, ids of another home and duplicates are dropped; a
 * widget the stored layout does not mention is appended in its default place; a locked widget is always visible; and a widget the person's
 * permission keys do not grant is dropped, so a stored layout can never reveal anything.
 */
export function resolveLayout(kind: HomeKind, stored: readonly LayoutEntry[] | null | undefined, can: (key: string) => boolean): LayoutEntry[] {
  const valid = new Set(widgetsFor(kind).map((w) => w.id));
  const seen = new Set<string>();
  const out: LayoutEntry[] = [];
  for (const e of stored ?? []) {
    if (!e || typeof e.id !== "string" || !valid.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, visible: byId.get(e.id)!.locked ? true : e.visible !== false });
  }
  for (const w of widgetsFor(kind)) if (!seen.has(w.id)) out.push({ id: w.id, visible: true });
  return out.filter((e) => widgetAllowed(byId.get(e.id)!, can));
}

/** Checks what Management sends: problems as plain messages (empty when fine). */
export function layoutProblems(kind: string, widgets: unknown): string[] {
  if (!(HOME_KINDS as readonly string[]).includes(kind)) return [`"${kind}" is not a dashboard.`];
  if (!Array.isArray(widgets)) return ["Send the widgets as a list."];
  const valid = new Set(widgetsFor(kind as HomeKind).map((w) => w.id));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const e of widgets as LayoutEntry[]) {
    if (!valid.has(e?.id)) problems.push(`"${String(e?.id)}" is not a widget of the ${kind} dashboard.`);
    else if (seen.has(e.id)) problems.push(`"${e.id}" is listed twice.`);
    else if (byId.get(e.id)!.locked && e.visible === false) problems.push(`"${byId.get(e.id)!.title}" cannot be hidden.`);
    seen.add(e?.id);
  }
  return problems;
}

/** Which home a person gets: the same order the Home screen has always used. `has` answers whether the dashboard has a section. */
export function homeKindFrom(has: (sectionKey: string) => boolean, can: (key: string) => boolean): HomeKind | null {
  if (has("management")) return "management";
  if (has("sales_today")) return "sales";
  if (has("delivery")) return "delivery";
  if (has("finance")) return "finance";
  if (has("technical")) return "technical";
  if (can("social.view")) return "marketing";
  return null;
}
