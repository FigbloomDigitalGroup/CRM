import { archivedWhere, type ArchiveMeta } from "../lib/archive";
import type { JsonClause } from "../lib/customFields";
import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import { TAG_LINKS_INCLUDE, tagFilter } from "./tags";
import { companyIdsNamed } from "./searchMatch";

const DEAL_INCLUDE = {
  company: true,
  primaryContact: true,
  lead: true,
  service: true,
  pipelineStage: true,
  lostReason: true,
  ...TAG_LINKS_INCLUDE,
} satisfies Prisma.DealInclude;

export interface CreateDealInput {
  customFields?: Prisma.InputJsonValue;
  organizationId: string;
  companyId: string;
  primaryContactId?: string;
  serviceId?: string;
  ownerMembershipId: string;
  pipelineStageId: string;
  value?: number | string;
  currency?: string;
  expectedCloseDate?: Date;
  notes?: string;
  createdByMembershipId?: string;
}

/**
 * No `leadId` param -- linking a Deal to its originating Lead is the job of
 * `convertLeadToDeal` below, which also stamps the Lead's `convertedAt`. A
 * bare `leadId` here would let a Deal attach without marking the Lead
 * converted, leaving the two records inconsistent.
 */
export async function createDeal(input: CreateDealInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.deal.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        primaryContactId: input.primaryContactId,
        serviceId: input.serviceId,
        ownerMembershipId: input.ownerMembershipId,
        pipelineStageId: input.pipelineStageId,
        value: input.value,
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate,
        notes: input.notes,
        createdByMembershipId: input.createdByMembershipId,
        customFields: input.customFields,
      },
      include: DEAL_INCLUDE,
    }),
  );
}

/**
 * `outcome`/`wonAt`/`lostAt`/`lostReasonId` are set here only as values the
 * service layer computed from a pipeline-stage transition
 * (`dealService.ts#resolveOutcomeFields`), never a direct pass-through of
 * client input -- a caller can't PATCH straight to `outcome: "WON"`.
 */
export interface UpdateDealInput {
  customFields?: Prisma.InputJsonValue;
  primaryContactId?: string | null;
  serviceId?: string | null;
  pipelineStageId?: string;
  value?: number | string | null;
  currency?: string;
  expectedCloseDate?: Date | null;
  notes?: string | null;
  outcome?: "OPEN" | "WON" | "LOST";
  lostReasonId?: string | null;
  wonAt?: Date | null;
  lostAt?: Date | null;
  /** Only ever set by `dealService.assignDeal` -- never from a general edit. */
  ownerMembershipId?: string;
}

export async function updateDeal(
  organizationId: string,
  dealId: string,
  input: UpdateDealInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.update({
      where: { id: dealId, organizationId },
      data: input,
      include: DEAL_INCLUDE,
    }),
  );
}

export async function getDealById(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.findFirst({
      where: { id: dealId, organizationId },
      include: DEAL_INCLUDE,
    }),
  );
}

export interface ListDealsFilters {
  query?: string;
  /** Set by `listDeals` / `countDeals` once the companies the text names are looked up by id (searchMatch.ts); not for callers. */
  companyIdsNamed?: string[];
  ownerMembershipId?: string;
  pipelineStageId?: string;
  outcome?: "OPEN" | "WON" | "LOST";
  companyId?: string;
  serviceId?: string;
  /**
   * Stalled = still open and past its expected close date (FIG-443).
   * Overrides `outcome` if both are passed, though no call site does that
   * today.
   */
  stalledOnly?: boolean;
  /**
   * Set by the service for a won-only viewer (B1.03): ANDed with everything
   * else, so no combination of the other filters can reach an open or lost deal.
   */
  visibleOutcome?: "WON";
  /** Archived deals are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
  includeArchived?: boolean;
  /** The archived tab: only archived records (B2.16). */
  archivedOnly?: boolean;
  /** `customField[key]=value` filters (FIG-803), built by `buildCustomFieldWhere`. */
  customFieldClauses?: JsonClause[];
  /** Records carrying any of these tags (FIG-798). */
  tagIds?: string[];
  /** Open deals with no activity for longer than their stage allows (FIG-1035); built by the service from the stage thresholds. */
  inactiveStages?: { stageId: string; before: Date }[];
  /** Open deals whose expected close date is before today (FIG-1035). Same as the older `stalledOnly`. */
  closeDatePassed?: boolean;
  /** Caps the number of rows returned (e.g. global search's per-group limit, FIG-787) -- omit for the unbounded list views. */
  take?: number;
  /** Rows to skip before `take` -- set by the paged list functions (FIG-789), not by callers. */
  skip?: number;
}

/** Shared by the list and count queries so a page and its total can never disagree (FIG-789). */
/** Adds the custom field filters on top of the plain filters. */
function dealsWhere(...args: Parameters<typeof baseDealsWhere>): Prisma.DealWhereInput {
  const base = baseDealsWhere(...args);
  const clauses = args[1].customFieldClauses;
  if (!clauses || clauses.length === 0) return base;
  return { AND: [base, ...clauses.map((c) => ({ customFields: c as Prisma.JsonFilter<"Deal"> }))] };
}

function baseDealsWhere(
  organizationId: string,
  filters: ListDealsFilters,
): Prisma.DealWhereInput {
  // Conditions that each need their own OR/AND go in one list, so none can overwrite another.
  const all: Prisma.DealWhereInput[] = [];
  if (filters.visibleOutcome) all.push({ outcome: filters.visibleOutcome });
  if (filters.stalledOnly || filters.closeDatePassed) {
    all.push({ outcome: "OPEN", expectedCloseDate: { lt: startOfToday() } });
  }
  if (filters.inactiveStages) {
    all.push({
      outcome: "OPEN",
      OR: filters.inactiveStages.length
        ? filters.inactiveStages.map((s) => ({ pipelineStageId: s.stageId, lastActivityAt: { lt: s.before } }))
        : [{ id: "00000000-0000-0000-0000-000000000000" }],
    });
  }
  if (filters.query) {
    all.push({
      OR: [
        { notes: { contains: filters.query, mode: "insensitive" } },
        ...(filters.companyIdsNamed
          ? filters.companyIdsNamed.length ? [{ companyId: { in: filters.companyIdsNamed } }] : []
          : [{ company: { name: { contains: filters.query, mode: "insensitive" as const } } }]),
      ],
    });
  }
  return {
    organizationId,
    ownerMembershipId: filters.ownerMembershipId,
    pipelineStageId: filters.pipelineStageId,
    outcome: filters.outcome,
    companyId: filters.companyId,
    serviceId: filters.serviceId,
    ...archivedWhere(filters),
    ...tagFilter(filters.tagIds),
    ...(all.length > 0 ? { AND: all } : {}),
  };
}

/** Midnight at the start of today, so a deal closing today is not yet late. */
function startOfToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Stage columns for the board (FIG-1035): how many deals each stage holds in the
 * caller's scope, and the value summed per currency. The service decides whether
 * the caller may see the values at all.
 */
export async function boardColumns(organizationId: string, filters: ListDealsFilters = {}) {
  return withOrgContext(organizationId, async (tx) => {
    const where = dealsWhere(organizationId, filters);
    const rows = await tx.deal.groupBy({
      by: ["pipelineStageId", "currency"],
      where,
      _count: { _all: true },
      _sum: { value: true },
    });
    const valued = await tx.deal.groupBy({
      by: ["pipelineStageId", "currency"],
      where: { AND: [where, { value: { not: null } }] },
      _count: { _all: true },
    });
    return { rows, valued };
  });
}

export async function touchDealActivity(organizationId: string, dealId: string, at: Date = new Date()) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.updateMany({ where: { id: dealId, organizationId, lastActivityAt: { lt: at } }, data: { lastActivityAt: at } }),
  );
}

async function withCompanyMatch(tx: Prisma.TransactionClient, organizationId: string, filters: ListDealsFilters): Promise<ListDealsFilters> {
  if (!filters.query) return filters;
  const ids = await companyIdsNamed(tx, organizationId, filters.query);
  return ids ? { ...filters, companyIdsNamed: ids } : filters;
}

export async function listDeals(
  organizationId: string,
  filters: ListDealsFilters = {},
) {
  return withOrgContext(organizationId, async (tx) =>
    tx.deal.findMany({
      where: dealsWhere(organizationId, await withCompanyMatch(tx, organizationId, filters)),
      include: DEAL_INCLUDE,
      orderBy: [
        { pipelineStage: { sequence: "asc" } },
        { createdAt: "desc" },
        { id: "asc" },
      ],
      take: filters.take,
      skip: filters.skip,
    }),
  );
}

/** Rows matching `filters` across all pages (FIG-789) -- ignores `take`/`skip`. */
/** Deals per owner for the same filters a list would use (FIG-1043), so a signal and its list filter always agree. */
export async function countDealsByOwner(organizationId: string, filters: ListDealsFilters = {}) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.deal.groupBy({ by: ["ownerMembershipId"], where: dealsWhere(organizationId, filters), _count: { _all: true } });
    return rows.map((r) => ({ ownerMembershipId: r.ownerMembershipId, count: r._count._all }));
  });
}

export async function countDeals(
  organizationId: string,
  filters: ListDealsFilters = {},
) {
  return withOrgContext(organizationId, async (tx) =>
    tx.deal.count({ where: dealsWhere(organizationId, await withCompanyMatch(tx, organizationId, filters)) }),
  );
}

/**
 * COUNT/SUM aggregates for the dashboard (FIG-789), so it never loads every
 * deal just to count them. `filters` carries the caller's own/all scope.
 * `openNotOwnedByViewer` lets the service decide whether every open deal's
 * value is visible to the viewer (see `getDealSummary`).
 */
export async function summarizeDeals(
  organizationId: string,
  filters: ListDealsFilters,
  viewerMembershipId: string,
) {
  const base = dealsWhere(organizationId, {
    ...filters,
    outcome: undefined,
    stalledOnly: undefined,
  });

  return withOrgContext(organizationId, async (tx) => {
    const byOutcome = await tx.deal.groupBy({
      by: ["outcome"],
      where: base,
      _count: { _all: true },
    });
    const openByCurrency = await tx.deal.groupBy({
      by: ["currency"],
      where: { AND: [base, { outcome: "OPEN" }] },
      _count: { _all: true, value: true },
      _sum: { value: true },
    });
    const openNotOwnedByViewer = await tx.deal.count({
      where: {
        AND: [
          base,
          { outcome: "OPEN" },
          { ownerMembershipId: { not: viewerMembershipId } },
        ],
      },
    });

    const countOf = (outcome: "OPEN" | "WON" | "LOST") =>
      byOutcome.find((r) => r.outcome === outcome)?._count._all ?? 0;

    return {
      total: byOutcome.reduce((sum, r) => sum + r._count._all, 0),
      open: countOf("OPEN"),
      won: countOf("WON"),
      lost: countOf("LOST"),
      openByCurrency: openByCurrency.map((r) => ({
        currency: r.currency,
        count: r._count._all,
        valuedCount: r._count.value,
        sum: Number(r._sum.value ?? 0),
      })),
      openNotOwnedByViewer,
    };
  });
}

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveDeal(organizationId: string, dealId: string, meta: ArchiveMeta = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.update({
      where: { id: dealId, organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: meta.membershipId ?? null,
        archiveReason: meta.reason ?? null,
      },
      include: DEAL_INCLUDE,
    }),
  );
}

export async function restoreDeal(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.update({
      where: { id: dealId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null },
      include: DEAL_INCLUDE,
    }),
  );
}

export class LeadAlreadyConvertedError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} has already been converted to a deal.`);
    this.name = "LeadAlreadyConvertedError";
  }
}

export class LeadMissingCompanyError extends Error {
  constructor(leadId: string) {
    super(
      `Lead ${leadId} has no associated company and none was supplied to ` +
        "resolve it at conversion time.",
    );
    this.name = "LeadMissingCompanyError";
  }
}

/** Inline-create payload for a company that doesn't exist yet (FIG-601) -- only reached when the Lead has no companyId and none was supplied. */
export interface NewCompanyDuringConversion {
  name: string;
  industry?: string;
  website?: string;
  location?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

/** Inline-create payload for a contact that doesn't exist yet (FIG-601) -- only reached when the Lead has no contactId. */
export interface NewContactDuringConversion {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
}

export interface ConvertLeadToDealInput {
  organizationId: string;
  leadId: string;
  companyId?: string;
  newCompany?: NewCompanyDuringConversion;
  newContact?: NewContactDuringConversion;
  ownerMembershipId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  value?: number | string;
  expectedCloseDate?: Date;
  notes?: string;
}

/**
 * Lead -> Deal conversion (FIG-436): carries owner/service/notes context
 * forward, applies a configured initial pipeline stage, resolves a company
 * for leads captured without one, and relies on the unique
 * (organizationId, leadId) constraint on Deal to prevent double conversion.
 *
 * FIG-601: a Lead captured with no company/contact at all (e.g. a phone
 * enquiry) no longer has to be patched up with an existing record first --
 * `newCompany`/`newContact` create them inline, in the same transaction,
 * and backfill the Lead itself so it's consistent with the Deal it just
 * produced (both rows know about the same new company/contact, not just
 * the Deal).
 */
export async function convertLeadToDeal(input: ConvertLeadToDealInput) {
  return withOrgContext(input.organizationId, async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, organizationId: input.organizationId },
    });

    if (!lead) {
      throw new Error(
        `Lead ${input.leadId} not found in organization ${input.organizationId}.`,
      );
    }
    if (lead.convertedAt) {
      throw new LeadAlreadyConvertedError(lead.id);
    }

    let companyId = lead.companyId ?? input.companyId;
    let createdCompanyId: string | undefined;
    if (!companyId && input.newCompany) {
      const createdCompany = await tx.company.create({
        data: {
          organizationId: input.organizationId,
          name: input.newCompany.name,
          industry: input.newCompany.industry,
          website: input.newCompany.website,
          location: input.newCompany.location,
          phone: input.newCompany.phone,
          email: input.newCompany.email,
          notes: input.newCompany.notes,
          createdByMembershipId: lead.createdByMembershipId,
        },
      });
      companyId = createdCompany.id;
      createdCompanyId = createdCompany.id;
    }
    if (!companyId) {
      throw new LeadMissingCompanyError(lead.id);
    }

    let primaryContactId = lead.contactId ?? undefined;
    let createdContactId: string | undefined;
    if (!primaryContactId && input.newContact) {
      const createdContact = await tx.contact.create({
        data: {
          organizationId: input.organizationId,
          firstName: input.newContact.firstName,
          lastName: input.newContact.lastName,
          companyId,
          phone: input.newContact.phone,
          email: input.newContact.email,
          jobTitle: input.newContact.jobTitle,
          department: input.newContact.department,
          createdByMembershipId: lead.createdByMembershipId,
        },
      });
      primaryContactId = createdContact.id;
      createdContactId = createdContact.id;
    }

    const ownerMembershipId = input.ownerMembershipId ?? lead.ownerMembershipId;
    if (!ownerMembershipId) {
      throw new Error(
        `Lead ${lead.id} has no owner and none was supplied for conversion.`,
      );
    }

    const pipelineStageId =
      input.pipelineStageId ??
      (
        await tx.pipelineStage.findFirst({
          where: {
            organizationId: input.organizationId,
            isActive: true,
            isWon: false,
            isLost: false,
          },
          orderBy: { sequence: "asc" },
        })
      )?.id;

    if (!pipelineStageId) {
      throw new Error(
        `No configured initial pipeline stage found for organization ${input.organizationId}.`,
      );
    }

    try {
      const deal = await tx.deal.create({
        data: {
          organizationId: input.organizationId,
          companyId,
          primaryContactId,
          leadId: lead.id,
          serviceId: input.serviceId ?? lead.serviceInterestId,
          ownerMembershipId,
          pipelineStageId,
          value: input.value,
          expectedCloseDate: input.expectedCloseDate,
          createdByMembershipId: lead.createdByMembershipId,
          notes: input.notes ?? lead.notes,
        },
        include: DEAL_INCLUDE,
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          convertedAt: new Date(),
          ...(createdCompanyId ? { companyId: createdCompanyId } : {}),
          ...(createdContactId ? { contactId: createdContactId } : {}),
        },
      });

      return deal;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Unique (organizationId, leadId) constraint on Deal caught the race.
        throw new LeadAlreadyConvertedError(lead.id);
      }
      throw err;
    }
  });
}
