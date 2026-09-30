import { withOrgContext } from "../db/orgScopedClient";

export interface CreateActivityInput {
  organizationId: string;
  type: "CALL" | "MEETING" | "NOTE" | "EMAIL" | "WHATSAPP" | "OTHER";
  subject?: string;
  description?: string;
  occurredAt?: Date;
  outcome?: string;
  authorMembershipId: string;
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

export async function createActivity(input: CreateActivityInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.activity.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        subject: input.subject,
        description: input.description,
        occurredAt: input.occurredAt,
        outcome: input.outcome,
        authorMembershipId: input.authorMembershipId,
        companyId: input.companyId,
        contactId: input.contactId,
        leadId: input.leadId,
        dealId: input.dealId,
      },
    }),
  );
}

/**
 * Callers scope by exactly one parent record (`activityService.ts`
 * authorizes against that parent before calling this) -- a timeline is
 * always "activities for this lead/deal," never an unscoped org-wide feed.
 */
export interface ListActivitiesFilters {
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

/** Oldest first (FIG-441): reads as history, not a "recent activity" feed. */
export async function listActivities(
  organizationId: string,
  filters: ListActivitiesFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.activity.findMany({
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
