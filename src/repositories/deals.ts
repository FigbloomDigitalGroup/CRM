import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

const DEAL_INCLUDE = {
  company: true,
  primaryContact: true,
  lead: true,
  service: true,
  pipelineStage: true,
  lostReason: true,
} satisfies Prisma.DealInclude;

export interface CreateDealInput {
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
 * Deliberately has no `leadId` parameter -- linking a Deal to its
 * originating Lead is exclusively the job of `convertLeadToDeal` below,
 * which also stamps the Lead's `convertedAt`. Accepting a bare `leadId`
 * here would let a caller attach a Deal to a Lead without marking that
 * Lead converted, leaving the two records inconsistent.
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
      },
      include: DEAL_INCLUDE,
    }),
  );
}

/**
 * Outcome (`outcome`/`wonAt`/`lostAt`) and `lostReasonId` are only ever
 * written here as values the service layer computed from a pipeline-stage
 * transition (see `dealService.ts#resolveOutcomeFields`) -- never as a
 * direct pass-through of client input, so a caller can't PATCH a deal
 * straight to `outcome: "WON"` without actually moving it through a
 * won-flagged stage.
 */
export interface UpdateDealInput {
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
  ownerMembershipId?: string;
  pipelineStageId?: string;
  outcome?: "OPEN" | "WON" | "LOST";
  companyId?: string;
  serviceId?: string;
  /**
   * "Stalled" (FIG-443's Sales-dashboard AC) is defined as: still open, and
   * past the expected close date it was given. This overrides `outcome` if
   * both are passed -- there's no call site that does that today, but if
   * one ever does, stalled-ness (an open deal past due) should win.
   */
  stalledOnly?: boolean;
}

export async function listDeals(
  organizationId: string,
  filters: ListDealsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.findMany({
      where: {
        organizationId,
        ownerMembershipId: filters.ownerMembershipId,
        pipelineStageId: filters.pipelineStageId,
        outcome: filters.outcome,
        companyId: filters.companyId,
        serviceId: filters.serviceId,
        ...(filters.stalledOnly
          ? { outcome: "OPEN", expectedCloseDate: { lt: new Date() } }
          : {}),
        ...(filters.query
          ? {
              OR: [
                { notes: { contains: filters.query, mode: "insensitive" } },
                {
                  company: {
                    name: { contains: filters.query, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      },
      include: DEAL_INCLUDE,
      orderBy: [{ pipelineStage: { sequence: "asc" } }, { createdAt: "desc" }],
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

export interface ConvertLeadToDealInput {
  organizationId: string;
  leadId: string;
  companyId?: string;
  ownerMembershipId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  value?: number | string;
  expectedCloseDate?: Date;
  notes?: string;
}

/**
 * Implements the Lead -> Deal conversion workflow (FIG-436 section 12): it
 * is an application-level workflow (not a bare status flip), it carries
 * source/owner/qualification context forward, applies a configured initial
 * stage, resolves a company for leads that were captured without one, and
 * prevents duplicate conversion via the unique (organizationId, leadId)
 * constraint on Deal.
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

    const companyId = lead.companyId ?? input.companyId;
    if (!companyId) {
      throw new LeadMissingCompanyError(lead.id);
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
          primaryContactId: lead.contactId,
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
        data: { convertedAt: new Date() },
      });

      return deal;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Unique (organizationId, leadId) constraint on Deal — see FIG-436
        // section 12, "Duplicate conversion is prevented."
        throw new LeadAlreadyConvertedError(lead.id);
      }
      throw err;
    }
  });
}
