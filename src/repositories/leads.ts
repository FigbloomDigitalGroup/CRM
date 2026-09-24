import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateLeadInput {
  organizationId: string;
  leadStatusId: string;
  companyId?: string;
  contactId?: string;
  leadSourceId?: string;
  temperature?: "HOT" | "WARM" | "COLD";
  serviceInterestId?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
  qualificationData?: Prisma.InputJsonValue;
}

export async function createLead(input: CreateLeadInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.lead.create({
      data: {
        organizationId: input.organizationId,
        leadStatusId: input.leadStatusId,
        companyId: input.companyId,
        contactId: input.contactId,
        leadSourceId: input.leadSourceId,
        temperature: input.temperature,
        serviceInterestId: input.serviceInterestId,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
        qualificationData: input.qualificationData,
      },
    }),
  );
}

export class LeadAlreadyConvertedError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} has already been converted to a deal.`);
  }
}

export class LeadMissingCompanyError extends Error {
  constructor(leadId: string) {
    super(
      `Lead ${leadId} has no associated company. Resolving/creating the target ` +
        "company from lead+contact details is a lead-conversion business rule " +
        "owned by FIG-440, not the FIG-438 data-model foundation; attach a " +
        "companyId to the lead before calling convertLeadToDeal.",
    );
  }
}

export interface ConvertLeadToDealInput {
  organizationId: string;
  leadId: string;
  ownerMembershipId?: string;
  pipelineStageId?: string;
  serviceId?: string;
}

/**
 * Minimal, representative implementation of the Lead -> Deal conversion
 * workflow described in FIG-436 section 12: it is an application-level
 * workflow (not a bare status update), it carries source/owner/qualification
 * context forward, it applies a configured initial stage, and duplicate
 * conversion is prevented.
 *
 * The full conversion business logic (e.g. resolving/creating a company from
 * an unlinked lead, assignment rules, notifications) is explicitly FIG-440
 * scope per FIG-436 section 26; this function demonstrates and exercises the
 * data-model guarantees FIG-438 is responsible for.
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
    if (!lead.companyId) {
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
          companyId: lead.companyId,
          primaryContactId: lead.contactId,
          leadId: lead.id,
          serviceId: input.serviceId ?? lead.serviceInterestId,
          ownerMembershipId,
          pipelineStageId,
          createdByMembershipId: lead.createdByMembershipId,
          notes: lead.notes,
        },
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

export interface UpdateLeadInput {
  leadStatusId?: string;
  companyId?: string | null;
  contactId?: string | null;
  leadSourceId?: string | null;
  temperature?: "HOT" | "WARM" | "COLD";
  serviceInterestId?: string | null;
  qualificationData?: Prisma.InputJsonValue;
  lostReasonId?: string | null;
  nextFollowUpAt?: Date | null;
  notes?: string | null;
}

export async function updateLead(
  organizationId: string,
  leadId: string,
  input: UpdateLeadInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: input,
    }),
  );
}

/**
 * Reassigning ownership is a distinct operation from a general edit
 * (FIG-437 section 9 "leads.assign" is its own permission, separate from
 * leads.edit.*) — kept as its own repository function so the service layer
 * can gate it independently.
 */
export async function reassignLeadOwner(
  organizationId: string,
  leadId: string,
  ownerMembershipId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: { ownerMembershipId },
    }),
  );
}

export async function getLeadById(organizationId: string, leadId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findFirst({
      where: { id: leadId, organizationId },
      include: {
        company: true,
        contact: true,
        leadStatus: true,
        leadSource: true,
        lostReason: true,
      },
    }),
  );
}

export interface ListLeadsFilters {
  query?: string;
  ownerMembershipId?: string;
  leadStatusId?: string;
  leadSourceId?: string;
  temperature?: "HOT" | "WARM" | "COLD";
}

export async function listLeads(
  organizationId: string,
  filters: ListLeadsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: {
        organizationId,
        ownerMembershipId: filters.ownerMembershipId,
        leadStatusId: filters.leadStatusId,
        leadSourceId: filters.leadSourceId,
        temperature: filters.temperature,
        ...(filters.query
          ? {
              OR: [
                { notes: { contains: filters.query, mode: "insensitive" } },
                {
                  company: {
                    name: { contains: filters.query, mode: "insensitive" },
                  },
                },
                {
                  contact: {
                    firstName: { contains: filters.query, mode: "insensitive" },
                  },
                },
                {
                  contact: {
                    lastName: { contains: filters.query, mode: "insensitive" },
                  },
                },
                {
                  contact: {
                    email: { contains: filters.query, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        company: true,
        contact: true,
        leadStatus: true,
        leadSource: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/** Surfaces likely-duplicate leads by contact email/phone or company, for the UI/API caller to warn on before creating (FIG-438 section 9; not a hard block). */
export async function findPossibleDuplicateLeads(
  organizationId: string,
  candidate: {
    contactEmail?: string;
    contactPhone?: string;
    companyId?: string;
  },
) {
  const clauses: Prisma.LeadWhereInput[] = [];
  if (candidate.companyId) clauses.push({ companyId: candidate.companyId });
  if (candidate.contactEmail)
    clauses.push({ contact: { email: candidate.contactEmail } });
  if (candidate.contactPhone)
    clauses.push({ contact: { phone: candidate.contactPhone } });
  if (clauses.length === 0) return [];

  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: { organizationId, convertedAt: null, OR: clauses },
      include: { company: true, contact: true },
      take: 5,
    }),
  );
}
