import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateContactInput {
  organizationId: string;
  firstName: string;
  lastName?: string;
  companyId?: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
  notes?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  companyId?: string | null;
  phone?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
  notes?: string;
  ownerMembershipId?: string | null;
}

export interface ListContactsFilters {
  query?: string;
  companyId?: string;
  ownerMembershipId?: string;
}

export async function createContact(input: CreateContactInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.contact.create({
      data: {
        organizationId: input.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        companyId: input.companyId,
        phone: input.phone,
        email: input.email,
        jobTitle: input.jobTitle,
        department: input.department,
        notes: input.notes,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
      },
    }),
  );
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  input: UpdateContactInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.update({
      where: { id: contactId, organizationId },
      data: input,
    }),
  );
}

export async function getContactById(
  organizationId: string,
  contactId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findFirst({
      where: { id: contactId, organizationId },
      include: { company: true },
    }),
  );
}

/** Every contact belonging to `companyId` — supports "multiple contacts per company" (FIG-438 section 4). */
export async function listContactsByCompany(
  organizationId: string,
  companyId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: { organizationId, companyId },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function listContacts(
  organizationId: string,
  filters: ListContactsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: {
        organizationId,
        companyId: filters.companyId,
        ownerMembershipId: filters.ownerMembershipId,
        ...(filters.query
          ? {
              OR: [
                { firstName: { contains: filters.query, mode: "insensitive" } },
                { lastName: { contains: filters.query, mode: "insensitive" } },
                { email: { contains: filters.query, mode: "insensitive" } },
                { phone: { contains: filters.query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/** Duplicate detection by email/phone (a shared work phone across contacts is legitimate — FIG-438 section 9 — so this surfaces candidates, it does not block). */
export async function findPossibleDuplicateContacts(
  organizationId: string,
  candidate: { email?: string; phone?: string },
) {
  const clauses: Prisma.ContactWhereInput[] = [];
  if (candidate.email) clauses.push({ email: candidate.email });
  if (candidate.phone) clauses.push({ phone: candidate.phone });
  if (clauses.length === 0) return [];

  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: { organizationId, OR: clauses },
      take: 5,
    }),
  );
}
