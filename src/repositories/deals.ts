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
   * Stalled = still open and past its expected close date (FIG-443).
   * Overrides `outcome` if both are passed, though no call site does that
   * today.
   */
  stalledOnly?: boolean;
  /** Archived deals are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
  includeArchived?: boolean;
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
        ...(filters.includeArchived ? {} : { archivedAt: null }),
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

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveDeal(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.update({
      where: { id: dealId, organizationId },
      data: { archivedAt: new Date() },
      include: DEAL_INCLUDE,
    }),
  );
}

export async function restoreDeal(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.update({
      where: { id: dealId, organizationId },
      data: { archivedAt: null },
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
