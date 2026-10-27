import type { AuthContext } from "../auth/context";
import { deny, hasPermission } from "../auth/context";
import { countCalendarActivities } from "../repositories/activities";
import { countHandoffsByStatus } from "../repositories/dealHandoffs";
import { countTaskGroups, countTasksByAssignee } from "../repositories/tasks";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { getDealSummary } from "./dealService";
import { listLeadsPage, countLeads } from "./leadService";
import { getMyWork, taskGroupBounds } from "./taskService";
import { paymentAggregatesFor } from "./paymentService";
import { getMyMetrics, getOrganizationMetrics } from "./reportingService";
import { getSignals } from "./signalService";

/**
 * Role-shaped home pages (FIG-1042, B2.13; screens D1, D2, D3, R2).
 *
 * The dashboard is a set of sections. Each one is loaded on its own, so a failure in
 * one is reported in that section and the rest still arrive. A section the role may
 * not have is left out of the answer altogether, not shown empty. Every section says
 * whose records it covers. Numbers come from COUNT and GROUP BY queries and from the
 * stored signals (FIG-1043); no section loads a list of records just to count it.
 * Values follow the usual masking: amounts appear only where the caller may see them.
 */

export const DASHBOARD_SECTIONS = ["sales_today", "management", "delivery", "finance", "technical", "my_metrics"] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

interface SectionRule {
  title: string;
  /** Permission that opens the section. */
  needs: (ctx: AuthContext) => boolean;
  scope: (ctx: AuthContext) => string;
}

const SECTIONS: Record<DashboardSection, SectionRule> = {
  sales_today: {
    title: "Today",
    needs: (c) => hasPermission(c, "leads.view.own") || hasPermission(c, "deals.view.own"),
    scope: () => "Your own leads, deals and tasks",
  },
  management: {
    title: "Management overview",
    needs: (c) => hasPermission(c, "reporting.view.all"),
    scope: () => "The whole organisation",
  },
  delivery: {
    title: "Delivery",
    needs: (c) => hasPermission(c, "handoff.manage"),
    scope: (c) => (hasPermission(c, "reporting.view.all") ? "All handoffs in the organisation" : "All open handoffs, and the ones you own"),
  },
  finance: {
    title: "Finance",
    needs: (c) => hasPermission(c, "finance.view.payments"),
    scope: () => "Won deals and payments",
  },
  technical: {
    title: "My work",
    needs: (c) => hasPermission(c, "mywork.view"),
    scope: () => "Tasks assigned to you",
  },
  my_metrics: {
    title: "My results",
    needs: (c) => hasPermission(c, "reporting.view.own") && !hasPermission(c, "reporting.view.all"),
    scope: () => "Your own results",
  },
};

export function availableSections(ctx: AuthContext) {
  return DASHBOARD_SECTIONS.filter((key) => SECTIONS[key].needs(ctx)).map((key) => ({
    key,
    title: SECTIONS[key].title,
    scope: SECTIONS[key].scope(ctx),
  }));
}

const DAY_MS = 24 * 60 * 60_000;

function monthRange(now: Date, offset: number) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10), start, end };
}

async function salesToday(ctx: AuthContext, now: Date) {
  const bounds = await taskGroupBounds(ctx, now);
  const taskFilters = { assigneeMembershipId: ctx.membershipId };
  const canTasks = hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all");
  const [taskCounts, meetings, hotLeadCount, hotLeads, pipeline, signals] = await Promise.all([
    canTasks ? countTaskGroups(ctx.organizationId, taskFilters, bounds) : null,
    hasPermission(ctx, "activities.view")
      ? countCalendarActivities(ctx.organizationId, { from: bounds.todayStart, to: bounds.tomorrowStart, authorMembershipId: ctx.membershipId })
      : null,
    hasPermission(ctx, "leads.view.own") ? countLeads(ctx, { temperature: "HOT" }) : null,
    hasPermission(ctx, "leads.view.own") ? listLeadsPage(ctx, { temperature: "HOT" }, { page: 1, pageSize: 5 }) : null,
    hasPermission(ctx, "deals.view.own") ? getDealSummary(ctx) : null,
    getSignals(ctx, now),
  ]);
  const can = (key: string) => hasPermission(ctx, key);
  return {
    myDay: {
      tasksOverdue: taskCounts?.OVERDUE ?? null,
      tasksToday: taskCounts?.TODAY ?? null,
      meetingsToday: meetings,
    },
    hotLeads: hotLeadCount === null ? null : {
      count: hotLeadCount,
      top: hotLeads?.items.map((l) => ({ id: l.id, company: l.company?.name ?? null, contact: l.contact ? [l.contact.firstName, l.contact.lastName].filter(Boolean).join(" ") : null })) ?? [],
    },
    stalledDeals: signals.stalledDeals?.total ?? null,
    dealsPastCloseDate: signals.closeDatePassed?.total ?? null,
    // `openValue` is null whenever the caller may not see every open deal's value.
    pipeline: pipeline === null ? null : { open: pipeline.open, won: pipeline.won, lost: pipeline.lost, openValue: pipeline.openValue },
    quickActions: [
      can("leads.create") ? { key: "new_lead", label: "New lead" } : null,
      can("activities.create") ? { key: "log_activity", label: "Log a call or meeting" } : null,
      can("tasks.create") ? { key: "new_task", label: "New task" } : null,
      can("deals.create") ? { key: "new_deal", label: "New deal" } : null,
    ].filter((a): a is { key: string; label: string } => a !== null),
  };
}

async function management(ctx: AuthContext, now: Date) {
  const thisMonth = monthRange(now, 0);
  const lastMonth = monthRange(now, -1);
  const [current, previous, signals, open, overdue] = await Promise.all([
    getOrganizationMetrics(ctx, { dateFrom: thisMonth.from, dateTo: thisMonth.to }),
    getOrganizationMetrics(ctx, { dateFrom: lastMonth.from, dateTo: lastMonth.to }),
    getSignals(ctx, now),
    countTasksByAssignee(ctx.organizationId, { upcomingOnly: true }),
    countTasksByAssignee(ctx.organizationId, { overdueOnly: true }),
  ]);
  const members = await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true, user: { select: { name: true } } } });
  const name = new Map(members.map((m) => [m.id, m.user.name]));
  const workload = members
    .map((m) => {
      const upcoming = open.find((r) => r.assigneeMembershipId === m.id)?.count ?? 0;
      const late = overdue.find((r) => r.assigneeMembershipId === m.id)?.count ?? 0;
      return { membershipId: m.id, name: name.get(m.id) ?? null, openTasks: upcoming + late, overdueTasks: late };
    })
    .filter((w) => w.openTasks > 0)
    .sort((a, b) => b.openTasks - a.openTasks || a.membershipId.localeCompare(b.membershipId));
  return {
    thisMonth: { from: thisMonth.from, to: thisMonth.to, metrics: current },
    lastMonth: { from: lastMonth.from, to: lastMonth.to, metrics: previous },
    pipelineByStage: current.pipelineByStage,
    conversion: current.leadConversion,
    teamWorkload: workload,
    overdueByOwner: {
      tasks: signals.overdueTasks ?? null,
      stalledDeals: signals.stalledDeals ?? null,
    },
    adoption: signals.adoption ?? null,
  };
}

async function delivery(ctx: AuthContext) {
  const all = await countHandoffsByStatus(ctx.organizationId);
  const mine = await countHandoffsByStatus(ctx.organizationId, { ownerMembershipId: ctx.membershipId });
  return {
    awaitingOwner: all.AWAITING_OWNER ?? 0,
    onboardingInProgress: all.ONBOARDING ?? 0,
    delivered: all.DELIVERED ?? 0,
    mine: { onboarding: mine.ONBOARDING ?? 0, delivered: mine.DELIVERED ?? 0 },
  };
}

async function finance(ctx: AuthContext) {
  const deals = await getDealSummary(ctx);
  return {
    wonDeals: deals.won,
    // Values only when the caller may see them, as everywhere else.
    openValue: deals.openValue,
    // Due this week, overdue, collected this month and still owing: the section is only offered to Finance and Management.
    payments: { available: true, ...(await paymentAggregatesFor(ctx.organizationId)) },
  };
}

async function technical(ctx: AuthContext) {
  const work = await getMyWork(ctx, { pageSize: 1, groups: ["OVERDUE", "TODAY"] });
  return { counts: work.counts, timeZone: work.timeZone };
}

const LOADERS: Record<DashboardSection, (ctx: AuthContext, now: Date) => Promise<unknown>> = {
  sales_today: salesToday,
  management,
  delivery: (ctx) => delivery(ctx),
  finance: (ctx) => finance(ctx),
  technical: (ctx) => technical(ctx),
  my_metrics: (ctx) => getMyMetrics(ctx),
};

export type SectionResult = { key: DashboardSection; title: string; scope: string; ok: true; data: unknown } | { key: DashboardSection; title: string; scope: string; ok: false; error: string };

export async function loadSection(ctx: AuthContext, key: DashboardSection, now = new Date()): Promise<SectionResult> {
  const rule = SECTIONS[key];
  if (!rule.needs(ctx)) throw deny(ctx, `dashboard.${key}`);
  const base = { key, title: rule.title, scope: rule.scope(ctx) };
  try {
    return { ...base, ok: true, data: await LOADERS[key](ctx, now) };
  } catch (err) {
    logger.error({ err, section: key, organizationId: ctx.organizationId }, "Dashboard section failed");
    return { ...base, ok: false, error: "This section could not be loaded. The rest of the page is unaffected." };
  }
}

/** The sections this role has, each loaded independently; one that fails says so and the others still arrive. */
export async function getDashboard(ctx: AuthContext, now = new Date()) {
  const keys = availableSections(ctx).map((s) => s.key);
  const sections = await Promise.all(keys.map((key) => loadSection(ctx, key, now)));
  return { sections };
}
