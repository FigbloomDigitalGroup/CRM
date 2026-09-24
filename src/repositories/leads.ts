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

export async function getLeadById(organizationId: string, leadId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findFirst({ where: { id: leadId, organizationId } }),
  );
}
