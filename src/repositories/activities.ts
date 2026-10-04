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

/**
 * A Company's or Contact's own timeline (FIG-600 AC: "activities across
 * their leads and deals") -- in practice almost every Activity gets logged
 * against whichever Lead/Deal a rep is actively working, not the
 * Company/Contact record itself, so a timeline scoped to only the direct
 * `companyId`/`contactId` link would read as nearly empty. `leadIds`/
 * `dealIds` are resolved by `activityService.ts` first (and already
 * filtered to what the caller is actually allowed to see -- own vs. all --
 * before reaching here; this function has no opinion on visibility).
 */
export interface TimelineActivitiesFilter {
  companyId?: string;
  contactId?: string;
  leadIds?: string[];
  dealIds?: string[];
}

export async function listActivitiesForTimeline(
  organizationId: string,
  filter: TimelineActivitiesFilter,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.activity.findMany({
      where: {
        organizationId,
        OR: [
          ...(filter.companyId ? [{ companyId: filter.companyId }] : []),
          ...(filter.contactId ? [{ contactId: filter.contactId }] : []),
          ...(filter.leadIds?.length ? [{ leadId: { in: filter.leadIds } }] : []),
          ...(filter.dealIds?.length ? [{ dealId: { in: filter.dealIds } }] : []),
        ],
      },
      orderBy: { occurredAt: "asc" },
    }),
  );
}
