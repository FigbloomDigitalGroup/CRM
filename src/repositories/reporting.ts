import { withOrgContext } from "../db/orgScopedClient";

export interface ReportFilters {
  ownerMembershipId?: string;
  leadSourceId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function dateRange(filters: { dateFrom?: Date; dateTo?: Date }) {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return {
    ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
    ...(filters.dateTo ? { lt: filters.dateTo } : {}),
  };
}

/** Lead volume by source (AC: "lead volume and source"), scoped by leads' `createdAt`. */
export async function getLeadVolumeBySource(
  organizationId: string,
  filters: ReportFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.groupBy({
      by: ["leadSourceId"],
      where: {
        organizationId,
        ownerMembershipId: filters.ownerMembershipId,
        leadSourceId: filters.leadSourceId,
        createdAt: dateRange(filters),
      },
      _count: { _all: true },
    }),
  );
}

/**
 * Conversion = of leads created in the window, what fraction have
 * `convertedAt` set as of now, regardless of when conversion happened --
 * see IMPLEMENTATION_NOTES.md for why this beats gating on `convertedAt`
 * falling in the window.
 */
export async function getLeadConversionSummary(
  organizationId: string,
  filters: ReportFilters,
) {
  return withOrgContext(organizationId, async (tx) => {
    const where = {
      organizationId,
      ownerMembershipId: filters.ownerMembershipId,
      leadSourceId: filters.leadSourceId,
      createdAt: dateRange(filters),
    };
    const [total, converted] = await Promise.all([
      tx.lead.count({ where }),
      tx.lead.count({ where: { ...where, convertedAt: { not: null } } }),
    ]);
    return { total, converted };
  });
}

/**
 * Won/lost deals (AC: "won/lost deals"), scoped by the deal's `wonAt`/
 * `lostAt` -- when the outcome actually happened, not when the deal was
 * first created.
 */
export async function getDealOutcomeSummary(
  organizationId: string,
  filters: ReportFilters,
) {
  return withOrgContext(organizationId, async (tx) => {
    const baseWhere = {
      organizationId,
      ownerMembershipId: filters.ownerMembershipId,
      serviceId: filters.serviceId,
    };
    const [won, lost] = await Promise.all([
      tx.deal.aggregate({
        where: { ...baseWhere, outcome: "WON", wonAt: dateRange(filters) },
        _count: { _all: true },
        _sum: { value: true },
      }),
      tx.deal.aggregate({
        where: { ...baseWhere, outcome: "LOST", lostAt: dateRange(filters) },
        _count: { _all: true },
      }),
    ]);
    return {
      won: { count: won._count._all, value: won._sum.value },
      lost: { count: lost._count._all },
    };
  });
}

/**
 * Pipeline value by stage (AC: "pipeline value") is always a current
 * snapshot of open deals -- not date-ranged, since "what's in the
 * pipeline right now" isn't a historical question.
 */
export async function getPipelineValueByStage(
  organizationId: string,
  filters: Omit<ReportFilters, "dateFrom" | "dateTo">,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["pipelineStageId"],
      where: {
        organizationId,
        outcome: "OPEN",
        ownerMembershipId: filters.ownerMembershipId,
        serviceId: filters.serviceId,
        pipelineStageId: filters.pipelineStageId,
      },
      _count: { _all: true },
      _sum: { value: true },
    }),
  );
}

/** Sales by service (AC): value of WON deals in the window, grouped by service. */
export async function getSalesByService(
  organizationId: string,
  filters: ReportFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["serviceId"],
      where: {
        organizationId,
        outcome: "WON",
        ownerMembershipId: filters.ownerMembershipId,
        // Regression: this filter was missing despite grouping by
        // serviceId, so filtering by a bogus serviceId silently returned
        // unfiltered rows.
        serviceId: filters.serviceId,
        wonAt: dateRange(filters),
      },
      _count: { _all: true },
      _sum: { value: true },
    }),
  );
}

/**
 * Tasks whose `dueAt` fell in the window, grouped by status. "Overdue" is
 * reported separately (see tasks.ts's `overdueOnly` filter) since it's a
 * live question, not one tied to a date range.
 */
export async function getFollowUpStatusBreakdown(
  organizationId: string,
  filters: ReportFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.groupBy({
      by: ["status"],
      where: {
        organizationId,
        assigneeMembershipId: filters.ownerMembershipId,
        dueAt: dateRange(filters),
      },
      _count: { _all: true },
    }),
  );
}
