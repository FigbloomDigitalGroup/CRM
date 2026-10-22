import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ForbiddenError } from "../auth/errors";
import { listDeals } from "./dealService";
import { listLeads } from "./leadService";
import { listTasks } from "./taskService";
import {
  getDealOutcomeSummary,
  getFollowUpStatusBreakdown,
  getLeadConversionSummary,
  getLeadVolumeBySource,
  getPipelineValueByStage,
  getSalesByService,
  type ReportFilters,
} from "../repositories/reporting";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns the raw `dateFrom` / `dateTo` strings from the filter bar into a
 * safe window. Garbage dates fall back to the default (last 30 days), a
 * reversed range is swapped, and a date-only "to" includes that whole day
 * -- the repository windows are end-exclusive, so without this a user
 * choosing today as the end date would silently lose today's records.
 */
export function resolveRange(filters: { dateFrom?: string; dateTo?: string }) {
  const parse = (value?: string) => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  let fromStr = parse(filters.dateFrom) ? filters.dateFrom : undefined;
  let toStr = parse(filters.dateTo) ? filters.dateTo : undefined;
  // A reversed range is swapped rather than silently returning nothing.
  if (fromStr && toStr && parse(fromStr)!.getTime() > parse(toStr)!.getTime()) {
    [fromStr, toStr] = [toStr, fromStr];
  }

  const now = new Date();
  const toInput = parse(toStr);
  const toIsDateOnly = Boolean(toStr && toStr.length <= 10);
  const dateToExclusive = toInput
    ? new Date(toInput.getTime() + (toIsDateOnly ? DAY_MS : 0))
    : now;
  const dateFrom =
    parse(fromStr) ?? new Date(dateToExclusive.getTime() - 30 * DAY_MS);
  return {
    dateFrom,
    /** Exclusive upper bound used in queries; undefined (open-ended) with no explicit end date. */
    dateToQuery: toInput ? dateToExclusive : undefined,
    /** What the page shows as "to" (the last day included). */
    dateTo: toIsDateOnly && toInput ? toInput : dateToExclusive,
  };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function ignoreForbidden<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ForbiddenError) return [];
    throw err;
  }
}

/**
 * "Actionable work": due-today follow-ups, overdue tasks, new leads, and
 * stalled deals, reusing the existing service-layer own/all scoping and
 * value masking rather than re-deriving it here. Each piece independently
 * no-ops to `[]` if the caller's role lacks that permission (e.g. Finance
 * has no tasks.* or leads.* at all) instead of failing the whole
 * dashboard.
 */
export async function getMyActionableWork(ctx: AuthContext) {
  if (
    !hasPermission(ctx, "reporting.view.own") &&
    !hasPermission(ctx, "reporting.view.all")
  ) {
    throw new ForbiddenError("reporting.view.own (or .all)");
  }

  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);

  const [dueToday, overdue, newLeads, stalledDeals] = await Promise.all([
    ignoreForbidden(
      listTasks(ctx, { dueAfter: today, dueBefore: tomorrow }).then((tasks) =>
        tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS"),
      ),
    ),
    ignoreForbidden(listTasks(ctx, { overdueOnly: true })),
    ignoreForbidden(listLeads(ctx, { createdAfter: sevenDaysAgo })),
    ignoreForbidden(listDeals(ctx, { stalledOnly: true })),
  ]);

  return { dueToday, overdue, newLeads, stalledDeals };
}

export interface OrganizationMetricsFilters {
  ownerMembershipId?: string;
  leadSourceId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Value-bearing aggregates (pipeline value, won value, sales by service)
 * are nulled out for a caller who lacks `deals.view.value` -- same rule
 * as `dealService.ts#maskValue`, applied to sums instead of individual
 * records (an aggregate can't be partially masked, so it's shown in full
 * or not at all).
 */
export async function getOrganizationMetrics(
  ctx: AuthContext,
  filters: OrganizationMetricsFilters = {},
) {
  requirePermission(ctx, "reporting.view.all");
  const canSeeValue = hasPermission(ctx, "deals.view.value");

  const { dateFrom, dateTo, dateToQuery } = resolveRange(filters);

  const repoFilters: ReportFilters = {
    ownerMembershipId: filters.ownerMembershipId || undefined,
    leadSourceId: filters.leadSourceId || undefined,
    pipelineStageId: filters.pipelineStageId || undefined,
    serviceId: filters.serviceId || undefined,
    dateFrom,
    // With no explicit end date the window is open-ended ("up to now").
    // Bounding it by `new Date()` would drop a record created in the same
    // millisecond, since created_at is TIMESTAMP(3) and Postgres rounds.
    dateTo: dateToQuery,
  };

  const [
    leadVolumeBySource,
    leadConversion,
    dealOutcomes,
    pipelineByStage,
    salesByService,
    followUpBreakdown,
  ] = await Promise.all([
    getLeadVolumeBySource(ctx.organizationId, repoFilters),
    getLeadConversionSummary(ctx.organizationId, repoFilters),
    getDealOutcomeSummary(ctx.organizationId, repoFilters),
    getPipelineValueByStage(ctx.organizationId, repoFilters),
    getSalesByService(ctx.organizationId, repoFilters),
    getFollowUpStatusBreakdown(ctx.organizationId, repoFilters),
  ]);

  return {
    dateFrom,
    dateTo,
    leadVolumeBySource,
    leadConversion,
    dealOutcomes: canSeeValue
      ? dealOutcomes
      : { ...dealOutcomes, won: { ...dealOutcomes.won, value: null } },
    pipelineByStage: pipelineByStage.map((row) => ({
      ...row,
      _sum: canSeeValue ? row._sum : { value: null },
    })),
    salesByService: salesByService.map((row) => ({
      ...row,
      _sum: canSeeValue ? row._sum : { value: null },
    })),
    followUpBreakdown,
    valueMasked: !canSeeValue,
  };
}

export type ReportScopeLevel = "all" | "own" | null;

/**
 * What a caller's reports cover, per area. Management (`reporting.view.all`)
 * gets the organization view; everyone else with `reporting.view.own` gets a
 * personal view limited to the areas their role can open at all -- Finance
 * has no leads or tasks, Delivery has no leads, and so on. An area the role
 * cannot see is `null` and simply is not reported on.
 */
export function getReportScope(ctx: AuthContext) {
  const organization = hasPermission(ctx, "reporting.view.all");
  if (!organization && !hasPermission(ctx, "reporting.view.own")) {
    throw new ForbiddenError("reporting.view.own (or .all)");
  }
  const level = (all: string, own: string): ReportScopeLevel =>
    hasPermission(ctx, all) ? "all" : hasPermission(ctx, own) ? "own" : null;
  return {
    mode: organization ? ("organization" as const) : ("personal" as const),
    leads: level("leads.view.all", "leads.view.own"),
    deals: level("deals.view.all", "deals.view.own"),
    tasks: level("tasks.view.all", "tasks.view.own"),
  };
}

export interface PersonalMetricsFilters {
  leadSourceId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The personal counterpart to `getOrganizationMetrics`, for roles holding
 * only `reporting.view.own`. Each section is scoped to what the role may
 * already see elsewhere in the app: own-only roles report on records they
 * own (tasks: assigned to them); a role that can view every deal reports on
 * every deal. Deal values follow the Deals page: visible on deals you own,
 * otherwise only with `deals.view.value`. Sections the role has no access to
 * are `null`.
 */
export async function getMyMetrics(
  ctx: AuthContext,
  filters: PersonalMetricsFilters = {},
) {
  const scope = getReportScope(ctx);
  const { dateFrom, dateTo, dateToQuery } = resolveRange(filters);
  const me = ctx.membershipId;

  const base: ReportFilters = {
    leadSourceId: filters.leadSourceId || undefined,
    pipelineStageId: filters.pipelineStageId || undefined,
    serviceId: filters.serviceId || undefined,
    dateFrom,
    dateTo: dateToQuery,
  };
  const leadFilters = { ...base, ownerMembershipId: scope.leads === "own" ? me : undefined };
  const dealFilters = { ...base, ownerMembershipId: scope.deals === "own" ? me : undefined };
  const taskFilters = { ...base, ownerMembershipId: scope.tasks === "own" ? me : undefined };

  const canSeeValue =
    scope.deals === "own" || hasPermission(ctx, "deals.view.value");

  const [
    leadVolumeBySource,
    leadConversion,
    dealOutcomes,
    pipelineByStage,
    salesByService,
    followUpBreakdown,
  ] = await Promise.all([
    scope.leads ? getLeadVolumeBySource(ctx.organizationId, leadFilters) : null,
    scope.leads ? getLeadConversionSummary(ctx.organizationId, leadFilters) : null,
    scope.deals ? getDealOutcomeSummary(ctx.organizationId, dealFilters) : null,
    scope.deals ? getPipelineValueByStage(ctx.organizationId, dealFilters) : null,
    scope.deals ? getSalesByService(ctx.organizationId, dealFilters) : null,
    scope.tasks ? getFollowUpStatusBreakdown(ctx.organizationId, taskFilters) : null,
  ]);

  return {
    scope,
    dateFrom,
    dateTo,
    leadVolumeBySource,
    leadConversion,
    dealOutcomes:
      dealOutcomes && !canSeeValue
        ? { ...dealOutcomes, won: { ...dealOutcomes.won, value: null } }
        : dealOutcomes,
    pipelineByStage:
      pipelineByStage?.map((row) => ({
        ...row,
        _sum: canSeeValue ? row._sum : { value: null },
      })) ?? null,
    salesByService:
      salesByService?.map((row) => ({
        ...row,
        _sum: canSeeValue ? row._sum : { value: null },
      })) ?? null,
    followUpBreakdown,
    valueMasked: !canSeeValue,
  };
}
