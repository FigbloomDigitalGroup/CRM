import { withOrgContext } from "../db/orgScopedClient";

export interface CreateCommunicationInput {
  organizationId: string;
  channel: "EMAIL" | "PHONE" | "WHATSAPP" | "SMS" | "MEETING" | "SOCIAL" | "OTHER";
  direction: "INBOUND" | "OUTBOUND";
  occurredAt?: Date;
  subject?: string;
  summary: string;
  externalReference?: string;
  /** Null for an inbound communication the webhook logged -- see the model's doc comment in schema.prisma. */
  authorMembershipId?: string;
  activityId?: string;
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

export async function createCommunication(input: CreateCommunicationInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.communication.create({
      data: {
        organizationId: input.organizationId,
        channel: input.channel,
        direction: input.direction,
        occurredAt: input.occurredAt,
        subject: input.subject,
        summary: input.summary,
        externalReference: input.externalReference,
        authorMembershipId: input.authorMembershipId,
        activityId: input.activityId,
        companyId: input.companyId,
        contactId: input.contactId,
        leadId: input.leadId,
        dealId: input.dealId,
      },
    }),
  );
}

/**
 * Callers scope by exactly one parent record (`communicationService.ts`
 * authorizes against that parent before calling this) -- same convention
 * as `listActivities`: a timeline is always "communications for this
 * lead/deal," never an unscoped org-wide feed.
 */
export interface ListCommunicationsFilters {
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

/** Oldest first, same as Activities -- reads as history, not a "recent" feed. */
export async function listCommunications(
  organizationId: string,
  filters: ListCommunicationsFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.communication.findMany({
      where: {
        organizationId,
        companyId: filters.companyId,
        contactId: filters.contactId,
        leadId: filters.leadId,
        dealId: filters.dealId,
      },
      orderBy: { occurredAt: "asc" },
    }),
  );
}
