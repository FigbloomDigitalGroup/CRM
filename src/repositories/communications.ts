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
  /** The email template this started from (FIG-797). */
  emailTemplateId?: string;
  /** Waits in the Needs-linking queue: it matched no record (FIG-1053). */
  needsLinking?: boolean;
  counterpartyEmail?: string;
  counterpartyName?: string;
  counterpartyPhone?: string;
  /** Length of a call, in seconds (FIG-1054). */
  durationSeconds?: number;
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
        emailTemplateId: input.emailTemplateId,
        needsLinking: input.needsLinking ?? false,
        counterpartyEmail: input.counterpartyEmail,
        counterpartyName: input.counterpartyName,
        counterpartyPhone: input.counterpartyPhone,
        durationSeconds: input.durationSeconds,
      },
    }),
  );
}

/** A message already stored for this external reference (a webhook retry), so it is never stored twice. */
export function findCommunicationByReference(organizationId: string, externalReference: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.communication.findFirst({ where: { organizationId, externalReference }, select: { id: true, needsLinking: true } }),
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
