import type { Release } from "./featureFlags";

/**
 * Help articles, page tips, release notes and shortcuts (FIG-1149, B6.17, design X3). Static copy kept in code so it is reviewed and
 * translated with the rest of the wording; the API (`src/services/helpService.ts`) filters it by the caller's role and release.
 *
 * An entry that names `requiresAny` is only offered to a role holding at least one of those permission keys, so Help never describes
 * (or names) a screen the person cannot open. Nothing here carries a record, a value or a person's data.
 */

export interface HelpArticle {
  slug: string;
  title: string;
  /** The page it belongs to: the key `tipsFor` uses (home, leads, deals, tasks, companies, reports, settings, general). */
  area: string;
  summary: string;
  body: string[];
  keywords: string[];
  requiresAny?: readonly string[];
  minRelease?: Release;
}

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    area: "general",
    summary: "Find your way around: the sidebar, search, the command palette and where your work lives.",
    body: [
      "The sidebar shows only the pages your role can use. If you expect a page that is not there, ask Management; each page that is closed to you explains who owns it.",
      "Use the search bar to find any record you may open. Press Ctrl or Cmd with K for the command palette: it jumps to pages and starts the actions your role allows.",
    ],
    keywords: ["start", "sidebar", "search", "navigation"],
  },
  {
    slug: "leads-basics",
    title: "Adding and qualifying leads",
    area: "leads",
    summary: "Only a name is required. Qualify later; duplicates warn you but never block saving.",
    body: ["Create a lead from the Leads page or with N. Add what you know and qualify when you have talked to the person.", "If a lead looks like a duplicate you are warned and can still save it, or open the existing record."],
    keywords: ["lead", "qualify", "duplicate", "new"],
    requiresAny: ["leads.view.own", "leads.view.all", "leads.view.shared"],
  },
  {
    slug: "deals-and-stages",
    title: "Deals and pipeline stages",
    area: "deals",
    summary: "Move deals between stages by dragging a card or with Move to on touch screens.",
    body: ["A deal sits in one stage. Moving to Closed Lost needs a reason; some stages can need a quote or proposal first when Management has switched that rule on.", "Automations may remind and draft, but they never move a deal for you."],
    keywords: ["deal", "stage", "pipeline", "won", "lost"],
    requiresAny: ["deals.view.own", "deals.view.all", "deals.view.won"],
  },
  {
    slug: "deal-values",
    title: "Why a deal value is hidden",
    area: "deals",
    summary: "Deal values show only to roles that may see them, and to the deal's owner.",
    body: ["A hidden value is marked, not left blank. Totals are shown whole or not at all, so a hidden value can never be worked out from a sum.", "If you need to see values for your work, ask Management to review your role."],
    keywords: ["value", "masked", "hidden", "permission", "margin"],
    requiresAny: ["deals.view.own", "deals.view.all", "deals.view.won"],
  },
  {
    slug: "tasks-and-calendar",
    title: "Tasks and the calendar",
    area: "tasks",
    summary: "Every task links to a lead, deal, company or contact. Overdue tasks come first on your home page.",
    body: ["Create tasks from a record or from the Tasks page. Reminders follow your Preferences."],
    keywords: ["task", "calendar", "reminder", "overdue"],
    requiresAny: ["tasks.view.own", "tasks.view.all"],
  },
  {
    slug: "companies-and-contacts",
    title: "Companies and contacts",
    area: "companies",
    summary: "Open a company for its full history: contacts, deals, services and, where you may see them, payments.",
    body: ["Merge duplicates from the record; a merge can be undone for a short time."],
    keywords: ["company", "contact", "customer", "merge"],
    requiresAny: ["companies.view", "contacts.view"],
  },
  {
    slug: "reports",
    title: "Reports and My metrics",
    area: "reports",
    summary: "Reports follow your role. Without organisation reports you see My metrics: your own figures only.",
    body: ["Every report shows its definition under the title, and a table beside every chart."],
    keywords: ["report", "metrics", "chart", "export"],
    requiresAny: ["reporting.view.own", "reporting.view.all"],
  },
  {
    slug: "payments",
    title: "Payments and invoices",
    area: "payments",
    summary: "Payments are visible to Finance and Management only.",
    body: ["Record invoices and payments against won deals. Other roles never see amounts, in lists, search, exports or notifications."],
    keywords: ["payment", "invoice", "finance"],
    requiresAny: ["finance.view.payments"],
  },
  {
    slug: "settings-overview",
    title: "Settings and the audit log",
    area: "settings",
    summary: "Management configures the organisation. Every change is recorded in the audit log.",
    body: ["Each editor says what a change affects before you save."],
    keywords: ["settings", "audit", "configuration"],
    requiresAny: ["configuration.manage", "organization.manage_settings"],
  },
  {
    slug: "import-export",
    title: "Importing and exporting",
    area: "general",
    summary: "Bring data in from a spreadsheet with the migration wizard, or export a list you may see.",
    body: ["Large exports can need Management approval. Exports contain only what you may see on screen."],
    keywords: ["import", "export", "csv", "migrate"],
    requiresAny: ["leads.import", "leads.export", "contacts.import", "contacts.export", "companies.import", "companies.export", "deals.export", "export.bulk"],
  },
  {
    slug: "saved-views",
    title: "Saved views",
    area: "general",
    summary: "Keep a filter one click away, for yourself or shared with the team, and pin it in the sidebar.",
    body: ["A shared view never shows anyone more than their own role allows: parts that need a permission a colleague lacks are left out for them."],
    keywords: ["view", "filter", "pin", "share"],
    minRelease: "v1.1",
  },
  {
    slug: "forecast",
    title: "Forecast and targets",
    area: "deals",
    summary: "An estimate from stage probabilities, never a commitment.",
    body: ["Weighted pipeline is each open deal's value times the probability of its stage. You see your own deals; Management sees the team."],
    keywords: ["forecast", "target", "weighted", "pipeline"],
    requiresAny: ["forecast.view.all", "deals.view.own"],
    minRelease: "v1.1",
  },
  {
    slug: "assistant",
    title: "Ask Figbloom",
    area: "general",
    summary: "Find anything and draft follow-ups. You confirm every action.",
    body: ["The assistant only uses records you may open, and masks values the way the rest of the app does."],
    keywords: ["assistant", "ai", "draft", "ask"],
    requiresAny: ["ai.use"],
    minRelease: "v1.1",
  },
];

export const PAGE_TIPS: Record<string, { title: string; tips: string[] }> = {
  home: { title: "Home", tips: ["Use the search bar to find any record you can access.", "Press ? for keyboard shortcuts."] },
  leads: { title: "Leads", tips: ["Only the name is required. Qualify later.", "Duplicates warn you, they never block saving.", "Use Saved views to keep your favourite filters one click away."] },
  deals: { title: "Deals", tips: ["Drag cards between stages, or use Move to on touch screens.", "Deal values show only to roles that may see them. Hidden values are marked, not blank."] },
  tasks: { title: "Tasks", tips: ["Every task links to a lead, deal, company or contact.", "Overdue tasks appear first on your home page."] },
  companies: { title: "Companies", tips: ["Open a company for its full history: contacts, deals, services and payments you may see."] },
  reports: { title: "Reports", tips: ["Reports follow your role. Without organisation reports you see My metrics."] },
  settings: { title: "Settings", tips: ["Changes are recorded in the audit log.", "Each editor says what a change affects before you save."] },
};

export interface ReleaseNote {
  id: string;
  release: Release;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  detail: string;
  requiresAny?: readonly string[];
}

/** Newest first within a release does not matter; the service sorts by date. */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  { id: "v1-attachments-tags-fields", release: "v1", date: "2026-11-10", title: "Attachments, tags and custom fields", detail: "On every lead, deal, company and contact." },
  { id: "v1-masking", release: "v1", date: "2026-11-10", title: "Values shown by role", detail: "Deal values, margins and payments are shown only to the roles that may see them, everywhere." },
  { id: "v11-ask", release: "v1.1", date: "2026-11-17", title: "Ask Figbloom and Ctrl or Cmd K", detail: "Find anything and draft follow-ups. You confirm every action.", requiresAny: ["ai.use"] },
  { id: "v11-saved-views", release: "v1.1", date: "2026-11-17", title: "Saved views in the sidebar", detail: "Keep a filter one click away, for yourself or shared with the team." },
  { id: "v11-forecast", release: "v1.1", date: "2026-11-17", title: "Forecast and targets", detail: "Weighted pipeline by month and where each person stands against their target.", requiresAny: ["forecast.view.all", "deals.view.own"] },
  { id: "v11-colours", release: "v1.1", date: "2026-11-17", title: "Your own colours", detail: "Pick your own sidebar, accent and highlight. We check every colour is readable." },
  { id: "v11-forms-sequences", release: "v1.1", date: "2026-11-17", title: "Web forms and follow-up sequences", detail: "Build a form that creates leads safely, and timed reminders that never move a deal for you.", requiresAny: ["configuration.manage", "cadences.manage"] },
  { id: "v2-api", release: "v2", date: "2026-11-20", title: "API tokens and webhooks", detail: "Connect other systems with scoped tokens.", requiresAny: ["api_tokens.manage", "webhooks.manage"] },
];

export const SHORTCUTS: readonly { label: string; keys: string }[] = [
  { label: "Command palette", keys: "Ctrl/Cmd K" },
  { label: "New lead", keys: "N" },
  { label: "Go to leads, deals, tasks", keys: "G L, G D, G T" },
  { label: "Go to companies, reports", keys: "G C, G R" },
  { label: "Go home", keys: "G H" },
  { label: "Help", keys: "?" },
  { label: "Close any panel", keys: "Esc" },
];
