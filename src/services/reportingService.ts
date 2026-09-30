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

  const dateTo = filters.dateTo ? new Date(filters.dateTo) : new Date();
  const dateFrom = filters.dateFrom
    ? new Date(filters.dateFrom)
    : new Date(dateTo.getTime() - 30 * DAY_MS);

  const repoFilters: ReportFilters = {
    ownerMembershipId: filters.ownerMembershipId,
    leadSourceId: filters.leadSourceId,
    pipelineStageId: filters.pipelineStageId,
    serviceId: filters.serviceId,
    dateFrom,
    dateTo,
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
