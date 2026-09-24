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

/**
 * Lead -> Deal conversion (FIG-440) lives in
 * `src/repositories/deals.ts#convertLeadToDeal` — it's a Deal-creating
 * operation, so the Deal repository is its home even though it starts from
 * a Lead id.
 */

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
  createdAfter?: Date;
  createdBefore?: Date;
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
        ...(filters.createdAfter || filters.createdBefore
          ? {
              createdAt: {
                ...(filters.createdAfter ? { gte: filters.createdAfter } : {}),
                ...(filters.createdBefore ? { lt: filters.createdBefore } : {}),
              },
            }
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
