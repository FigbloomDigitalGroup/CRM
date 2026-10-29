import { DEMO_RECORDS } from "../assistant/demo/data";

/**
 * What the command palette (X3, FIG-1172) lists. A pure function of the person's permission keys, so "only permitted actions" is a unit test:
 * a link or action the role cannot use is not in the list at all (hard rule: hiding is a courtesy, every page and route still checks).
 * The keys mirror `src/ui/shell/navigation.ts`.
 */

export type PaletteGroupId = "RECORDS" | "RECENT" | "ACTIONS" | "GO TO";

export interface PaletteItem {
  id: string;
  group: PaletteGroupId;
  title: string;
  sub?: string;
  /** Opens a page. */
  href?: string;
  /** Or runs something in the shell. */
  run?: "assistant" | "help";
  /** The key shown beside it. */
  hint?: string;
}

export interface PaletteGroup {
  id: PaletteGroupId;
  items: PaletteItem[];
}

const any = (keys: readonly string[], ...want: string[]) => want.some((k) => keys.includes(k));

/** Where each "go to" shortcut and link leads, and who may use it. */
export const GOTO: { id: string; label: string; path: string; shortcut?: string; allowed: (k: readonly string[]) => boolean }[] = [
  { id: "dashboard", label: "Home", path: "", shortcut: "H", allowed: () => true },
  { id: "leads", label: "Leads", path: "/leads", shortcut: "L", allowed: (k) => any(k, "leads.view.own", "leads.view.all", "leads.view.shared") },
  { id: "deals", label: "Deals", path: "/deals", shortcut: "D", allowed: (k) => any(k, "deals.view.own", "deals.view.all", "deals.view.won") },
  { id: "tasks", label: "Tasks", path: "/tasks", shortcut: "T", allowed: (k) => any(k, "tasks.view.own", "tasks.view.all") },
  { id: "calendar", label: "Calendar", path: "/calendar", allowed: (k) => any(k, "tasks.view.own", "tasks.view.all") },
  { id: "companies", label: "Companies", path: "/companies", shortcut: "C", allowed: (k) => any(k, "companies.view") },
  { id: "contacts", label: "Contacts", path: "/contacts", allowed: (k) => any(k, "contacts.view") },
  { id: "conversations", label: "Conversations", path: "/conversations", allowed: (k) => any(k, "communications.view") },
  { id: "renewals", label: "Renewals", path: "/renewals", allowed: (k) => any(k, "company_services.manage") },
  { id: "payments", label: "Payments", path: "/payments", allowed: (k) => any(k, "finance.view.payments") },
  { id: "reports", label: "Reports", path: "/reports", shortcut: "R", allowed: (k) => any(k, "reporting.view.own", "reporting.view.all") },
  { id: "preferences", label: "Preferences", path: "/preferences", allowed: () => true },
  { id: "settings", label: "Settings", path: "/settings", allowed: (k) => any(k, "configuration.manage") },
];

export const ACTIONS: { id: string; label: string; path?: string; run?: PaletteItem["run"]; hint?: string; allowed: (k: readonly string[]) => boolean }[] = [
  { id: "new-lead", label: "New lead", path: "/leads?new=1", hint: "N", allowed: (k) => any(k, "leads.create") },
  { id: "log-note", label: "Log a call or note", path: "/leads", allowed: (k) => any(k, "activities.create") },
  { id: "new-task", label: "New task", path: "/tasks", allowed: (k) => any(k, "tasks.create") },
  { id: "new-contact", label: "New contact", path: "/contacts", allowed: (k) => any(k, "contacts.create") },
  { id: "new-company", label: "New company", path: "/companies", allowed: (k) => any(k, "companies.create") },
  { id: "ask", label: "Ask Figbloom", run: "assistant", allowed: () => true },
  { id: "help", label: "Help and what’s new", run: "help", hint: "?", allowed: () => true },
];

const canOpen = (keys: readonly string[], kind: "lead" | "deal" | "company") =>
  kind === "lead" ? GOTO[1]!.allowed(keys) : kind === "deal" ? GOTO[2]!.allowed(keys) : GOTO[5]!.allowed(keys);

const PLURAL = { lead: "leads", deal: "deals", company: "companies" } as const;

export function buildPaletteItems(input: { orgSlug: string; permissionKeys: readonly string[]; query: string }): PaletteGroup[] {
  const { orgSlug, permissionKeys: keys } = input;
  const base = `/o/${orgSlug}`;
  const q = input.query.trim().toLowerCase();

  const records: PaletteItem[] = DEMO_RECORDS.filter((r) => canOpen(keys, r.kind))
    .filter((r) => (q ? r.name.toLowerCase().includes(q) : false))
    .slice(0, 6)
    .map((r) => ({ id: `rec-${r.id}`, group: "RECORDS", title: r.name, sub: r.sub, href: `${base}/${PLURAL[r.kind]}` }));

  const recent: PaletteItem[] = q
    ? []
    : DEMO_RECORDS.filter((r) => canOpen(keys, r.kind))
        .filter((_, i) => i === 0 || i === 4)
        .slice(0, 2)
        .map((r) => ({ id: `recent-${r.id}`, group: "RECENT", title: r.name, sub: `${r.sub} · recently opened`, href: `${base}/${PLURAL[r.kind]}` }));

  const actions: PaletteItem[] = ACTIONS.filter((a) => a.allowed(keys))
    .filter((a) => !q || a.label.toLowerCase().includes(q) || (a.id === "new-lead" && "new lead".includes(q)))
    .map((a) => ({ id: a.id, group: "ACTIONS", title: a.label, href: a.path ? `${base}${a.path}` : undefined, run: a.run, hint: a.hint }));

  const goto: PaletteItem[] = GOTO.filter((g) => g.allowed(keys))
    .filter((g) => !q || `go to ${g.label}`.toLowerCase().includes(q) || g.label.toLowerCase().includes(q))
    .map((g) => ({ id: `go-${g.id}`, group: "GO TO", title: `Go to ${g.label}`, href: `${base}${g.path}`, hint: g.shortcut ? `G ${g.shortcut}` : undefined }));

  return ([
    { id: "RECORDS", items: records },
    { id: "RECENT", items: recent },
    { id: "ACTIONS", items: actions },
    { id: "GO TO", items: goto },
  ] as PaletteGroup[]).filter((g) => g.items.length > 0);
}

/** The target of "G then a letter", or null when the person may not open it. */
export function gotoShortcut(letter: string, keys: readonly string[], orgSlug: string): string | null {
  const g = GOTO.find((x) => x.shortcut?.toLowerCase() === letter.toLowerCase());
  return g && g.allowed(keys) ? `/o/${orgSlug}${g.path}` : null;
}
