import type { Release } from "./featureFlags";
import { releaseAtLeast } from "./featureFlags";

/**
 * The command index behind the command palette (FIG-1149, B6.17, design X3): every page a person may go to and every action they may
 * start, as a pure function of their permission keys, so "commands only list actions the role may perform" is a unit test.
 * The permission keys mirror `src/ui/screens/palette/items.ts` and `src/ui/shell/navigation.ts` (a test keeps them in step).
 * A command is a courtesy, never the boundary: every route still checks the same permission itself.
 */

export type CommandKind = "navigate" | "create" | "assistant" | "help";
export type CommandGroup = "GO TO" | "CREATE" | "ASSISTANT" | "HELP";

export interface Command {
  id: string;
  kind: CommandKind;
  group: CommandGroup;
  title: string;
  /** Path under the organisation (`/leads`, `/leads?new=1`); empty for commands the shell runs itself. */
  path: string | null;
  /** The key beside it in the palette, such as `G L` or `N`. */
  hint: string | null;
}

interface Def {
  id: string;
  kind: CommandKind;
  title: string;
  path: string | null;
  hint?: string;
  allowed: (keys: readonly string[]) => boolean;
  minRelease?: Release;
  /** Needs this organisation toggle on (the assistant). */
  toggle?: string;
}

const any = (keys: readonly string[], ...want: string[]) => want.some((k) => keys.includes(k));

export const NAVIGATE: readonly Def[] = [
  { id: "go-dashboard", kind: "navigate", title: "Go to Home", path: "", hint: "G H", allowed: () => true },
  { id: "go-leads", kind: "navigate", title: "Go to Leads", path: "/leads", hint: "G L", allowed: (k) => any(k, "leads.view.own", "leads.view.all", "leads.view.shared") },
  { id: "go-deals", kind: "navigate", title: "Go to Deals", path: "/deals", hint: "G D", allowed: (k) => any(k, "deals.view.own", "deals.view.all", "deals.view.won") },
  { id: "go-tasks", kind: "navigate", title: "Go to Tasks", path: "/tasks", hint: "G T", allowed: (k) => any(k, "tasks.view.own", "tasks.view.all") },
  { id: "go-calendar", kind: "navigate", title: "Go to Calendar", path: "/calendar", allowed: (k) => any(k, "tasks.view.own", "tasks.view.all") },
  { id: "go-companies", kind: "navigate", title: "Go to Companies", path: "/companies", hint: "G C", allowed: (k) => any(k, "companies.view") },
  { id: "go-contacts", kind: "navigate", title: "Go to Contacts", path: "/contacts", allowed: (k) => any(k, "contacts.view") },
  { id: "go-conversations", kind: "navigate", title: "Go to Conversations", path: "/conversations", allowed: (k) => any(k, "communications.view") },
  { id: "go-renewals", kind: "navigate", title: "Go to Renewals", path: "/renewals", allowed: (k) => any(k, "company_services.manage") },
  { id: "go-payments", kind: "navigate", title: "Go to Payments", path: "/payments", allowed: (k) => any(k, "finance.view.payments") },
  { id: "go-reports", kind: "navigate", title: "Go to Reports", path: "/reports", hint: "G R", allowed: (k) => any(k, "reporting.view.own", "reporting.view.all") },
  { id: "go-forecast", kind: "navigate", title: "Go to Forecast", path: "/forecast", allowed: (k) => any(k, "forecast.view.all", "deals.view.own", "deals.edit.own"), minRelease: "v1.1" },
  { id: "go-preferences", kind: "navigate", title: "Go to Preferences", path: "/preferences", allowed: () => true },
  { id: "go-settings", kind: "navigate", title: "Go to Settings", path: "/settings", allowed: (k) => any(k, "configuration.manage") },
];

export const CREATE: readonly Def[] = [
  { id: "new-lead", kind: "create", title: "New lead", path: "/leads?new=1", hint: "N", allowed: (k) => any(k, "leads.create") },
  { id: "log-note", kind: "create", title: "Log a call or note", path: "/leads", allowed: (k) => any(k, "activities.create") },
  { id: "new-task", kind: "create", title: "New task", path: "/tasks", allowed: (k) => any(k, "tasks.create") },
  { id: "new-contact", kind: "create", title: "New contact", path: "/contacts", allowed: (k) => any(k, "contacts.create") },
  { id: "new-company", kind: "create", title: "New company", path: "/companies", allowed: (k) => any(k, "companies.create") },
];

/** Commands the shell runs itself: the assistant needs `ai.use` and the organisation's assistant switch; Help is for everyone. */
export const SHELL: readonly Def[] = [
  { id: "ask", kind: "assistant", title: "Ask Figbloom", path: null, allowed: (k) => any(k, "ai.use"), minRelease: "v1.1", toggle: "assistant.enabled" },
  { id: "help", kind: "help", title: "Help and what's new", path: null, hint: "?", allowed: () => true },
];

const GROUP: Record<CommandKind, CommandGroup> = { navigate: "GO TO", create: "CREATE", assistant: "ASSISTANT", help: "HELP" };

export interface CommandContext {
  permissionKeys: readonly string[];
  release: Release;
  /** Whether each organisation toggle named by a command is on. */
  toggles: Readonly<Record<string, boolean>>;
}

/** Every command the person may use, in the palette's order (create, assistant, help, then go to). */
export function buildCommands(c: CommandContext): Command[] {
  const ok = (d: Def) => d.allowed(c.permissionKeys) && (!d.minRelease || releaseAtLeast(c.release, d.minRelease)) && (!d.toggle || c.toggles[d.toggle] === true);
  const toCommand = (d: Def): Command => ({ id: d.id, kind: d.kind, group: GROUP[d.kind], title: d.title, path: d.path, hint: d.hint ?? null });
  return [...CREATE, ...SHELL, ...NAVIGATE].filter(ok).map(toCommand);
}

export type SearchType = "companies" | "contacts" | "leads" | "deals" | "tasks";

/** The record kinds the palette's search may return for this person; the same rule the search endpoint applies. */
export function searchableTypes(keys: readonly string[]): SearchType[] {
  const out: SearchType[] = [];
  if (keys.includes("companies.view")) out.push("companies");
  if (keys.includes("contacts.view")) out.push("contacts");
  if (any(keys, "leads.view.own", "leads.view.all")) out.push("leads");
  if (any(keys, "deals.view.own", "deals.view.all", "deals.view.won")) out.push("deals");
  if (any(keys, "tasks.view.own", "tasks.view.all")) out.push("tasks");
  return out;
}
