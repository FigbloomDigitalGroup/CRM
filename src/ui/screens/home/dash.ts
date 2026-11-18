/**
 * The shapes the dashboard sections answer with (`src/services/dashboardService.ts`). The contract types a section's `data` as unknown (each
 * role's section is a different shape), so the screens read it through these.
 */

export interface SalesTodayData {
  myDay: { tasksOverdue: number | null; tasksToday: number | null; meetingsToday: number | null };
  hotLeads: { count: number; top: { id: string; company: string | null; contact: string | null }[] } | null;
  stalledDeals: number | null;
  dealsPastCloseDate: number | null;
  pipeline: { open: number; won: number; lost: number; openValue: string | number | null } | null;
  quickActions: { key: string; label: string }[];
}

interface MetricsBlock {
  leadConversion: { total: number; converted: number };
  dealOutcomes: { won: { count: number; value: string | number | null }; lost: { count: number } };
  salesByService: { _count: { _all: number }; _sum: { value: string | number | null }; serviceId: string | null }[];
  valueMasked: boolean;
}

export interface ManagementData {
  thisMonth: { from: string; to: string; metrics: MetricsBlock };
  lastMonth: { from: string; to: string; metrics: MetricsBlock };
  teamWorkload: { membershipId: string; name: string | null; openTasks: number; overdueTasks: number }[];
  overdueByOwner: {
    tasks: { total: number; byOwner: { membershipId: string; name: string | null; count: number }[] } | null;
    stalledDeals: { total: number; byOwner: { membershipId: string; name: string | null; count: number }[] } | null;
  };
  adoption: { rate: number; activeMembers: number; weeks: { from: string; to: string; views: number; pagesUsed: number; activeUsers: number }[] } | null;
}

export interface DeliveryData {
  awaitingOwner: number;
  onboardingInProgress: number;
  delivered: number;
  mine: { onboarding: number; delivered: number };
}

export interface FinanceData {
  wonDeals: number;
  openValue: string | number | null;
  payments: {
    available: boolean;
    dueThisWeek: { count: number; outstanding: string };
    overdue: { count: number; outstanding: string; oldestDaysOverdue: number | null };
    collectedThisMonth: { count: number; amount: string };
    outstanding: string;
    nothingToCollect: boolean;
  };
}

export interface TechnicalData {
  counts: { OVERDUE: number; TODAY: number; THIS_WEEK: number; LATER: number; NO_DATE: number; DONE: number };
  timeZone: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string | null;
  requirements?: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  assigneeName?: string | null;
  link?: { type: string; id: string; label: string } | null;
  readOnly?: boolean;
}

export type SectionKey = "sales_today" | "management" | "delivery" | "finance" | "technical" | "my_metrics";

export interface SectionAnswer {
  key: string;
  title: string;
  scope: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** One record's page, built from a link the API gave ("Lead", "Deal", "Company", "Contact", "Task"). */
export function recordHref(orgSlug: string, type: string, id: string): string {
  const base = `/o/${orgSlug}`;
  switch (type.toLowerCase()) {
    case "lead":
      return `${base}/leads/${id}`;
    case "deal":
      return `${base}/deals/${id}`;
    case "company":
      return `${base}/companies/${id}`;
    case "contact":
      return `${base}/contacts/${id}`;
    case "task":
      return `${base}/tasks`;
    default:
      return base;
  }
}

/** The chip on a task row: "Lead · Name", "Deal · Company", "Customer · Name", as the design writes it. */
export function linkChipLabel(link: { type: string; label: string }): string {
  if (link.label.includes(" · ")) return link.label;
  const kind = { lead: "Lead", deal: "Deal", company: "Customer", contact: "Contact" }[link.type.toLowerCase() as "lead"];
  return kind ? `${kind} · ${link.label}` : link.label;
}

/** The person's name for a lead row: the company first, then the contact. */
export function leadName(l: { company?: { name: string } | null; contact?: { firstName: string; lastName?: unknown } | null }): string {
  if (l.company?.name) return l.company.name;
  const c = l.contact;
  if (c) return [c.firstName, typeof c.lastName === "string" ? c.lastName : ""].filter(Boolean).join(" ");
  return "Unnamed lead";
}
