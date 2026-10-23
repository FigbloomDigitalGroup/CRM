import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import type { ScoreFactor } from "../lib/scoring";

/** Data access for lead scores and customer health (FIG-1032). Every call runs inside the organisation's RLS context. */

const DAY = 24 * 60 * 60 * 1000;

export async function leadScoringFacts(organizationId: string, leadId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, organizationId },
      select: {
        id: true,
        createdAt: true,
        temperature: true,
        serviceInterestId: true,
        qualificationData: true,
        nextFollowUpAt: true,
        convertedAt: true,
        archivedAt: true,
        leadSource: { select: { key: true, name: true } },
      },
    });
    if (!lead) return null;
    const [activityRange, communicationRange, similarWins] = await Promise.all([
      tx.activity.aggregate({ where: { organizationId, leadId }, _min: { occurredAt: true }, _max: { occurredAt: true } }),
      tx.communication.aggregate({ where: { organizationId, leadId }, _min: { occurredAt: true }, _max: { occurredAt: true } }),
      lead.serviceInterestId
        ? tx.deal.count({ where: { organizationId, outcome: "WON", serviceId: lead.serviceInterestId } })
        : Promise.resolve(0),
    ]);
    const mins = [activityRange._min.occurredAt, communicationRange._min.occurredAt].filter((d): d is Date => !!d);
    const maxes = [activityRange._max.occurredAt, communicationRange._max.occurredAt].filter((d): d is Date => !!d);
    return {
      lead,
      firstContactAt: mins.length ? new Date(Math.min(...mins.map((d) => d.getTime()))) : null,
      lastContactAt: maxes.length ? new Date(Math.max(...maxes.map((d) => d.getTime()))) : null,
      similarWins,
    };
  });
}

export async function companyHealthFacts(organizationId: string, companyId: string, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true, createdAt: true } });
    if (!company) return null;
    const since30 = new Date(now.getTime() - 30 * DAY);
    const since12m = new Date(now.getTime() - 365 * DAY);
    const in60 = new Date(now.getTime() + 60 * DAY);
    const [activities, communications, overdueTasks, renewalsDueSoon, lapsedServices, openDeals, wonDeals] = await Promise.all([
      tx.activity.count({ where: { organizationId, companyId, occurredAt: { gte: since30 } } }),
      tx.communication.count({ where: { organizationId, companyId, occurredAt: { gte: since30 } } }),
      tx.task.count({ where: { organizationId, companyId, archivedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
      tx.companyService.count({ where: { organizationId, companyId, status: "ACTIVE", endDate: { gte: now, lte: in60 } } }),
      tx.companyService.count({ where: { organizationId, companyId, status: "ACTIVE", endDate: { lt: now } } }),
      tx.deal.count({ where: { organizationId, companyId, outcome: "OPEN", archivedAt: null } }),
      tx.deal.count({ where: { organizationId, companyId, outcome: "WON", wonAt: { gte: since12m } } }),
    ]);
    return {
      company,
      recentTouches: activities + communications,
      overdueTasks,
      renewalsDueSoon,
      lapsedServices,
      openDeals,
      wonDealsLast12Months: wonDeals,
    };
  });
}

export function storeLeadScore(organizationId: string, leadId: string, value: { score: number; band: string; factors: ScoreFactor[]; at: Date }) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.updateMany({
      where: { id: leadId, organizationId },
      data: { scoreValue: value.score, scoreBand: value.band, scoreFactors: value.factors as unknown as Prisma.InputJsonValue, scoredAt: value.at },
    }),
  );
}

export function storeCompanyHealth(organizationId: string, companyId: string, value: { score: number; band: string; factors: ScoreFactor[]; at: Date }) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.updateMany({
      where: { id: companyId, organizationId },
      data: { healthValue: value.score, healthBand: value.band, healthFactors: value.factors as unknown as Prisma.InputJsonValue, healthScoredAt: value.at },
    }),
  );
}

/** Open leads in id order, a batch at a time, for the nightly recompute. */
export function leadIdsToScore(organizationId: string, afterId: string | null, take: number) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.lead.findMany({
      where: { organizationId, archivedAt: null, convertedAt: null, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take,
    });
    return rows.map((r) => r.id);
  });
}

export function customerCompanyIdsToScore(organizationId: string, afterId: string | null, take: number) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.company.findMany({
      where: { organizationId, archivedAt: null, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take,
    });
    return rows.map((r) => r.id);
  });
}
