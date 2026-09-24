import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import {
  createContact as createContactRecord,
  findPossibleDuplicateContacts,
  getContactById,
  listContacts as listContactsRecords,
  updateContact as updateContactRecord,
  type CreateContactInput,
  type ListContactsFilters,
  type UpdateContactInput,
} from "../repositories/contacts";

export type CreateContactServiceInput = Omit<
  CreateContactInput,
  "organizationId" | "createdByMembershipId"
>;

export async function createContact(
  ctx: AuthContext,
  input: CreateContactServiceInput,
) {
  requirePermission(ctx, "contacts.create");

  const possibleDuplicates = await findPossibleDuplicateContacts(
    ctx.organizationId,
    {
      email: input.email,
      phone: input.phone,
    },
  );

  const contact = await createContactRecord({
    ...input,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
  });

  return { contact, possibleDuplicates };
}

export async function updateContact(
  ctx: AuthContext,
  contactId: string,
  input: UpdateContactInput,
) {
  requirePermission(ctx, "contacts.edit");
  return updateContactRecord(ctx.organizationId, contactId, input);
}

export async function getContact(ctx: AuthContext, contactId: string) {
  requirePermission(ctx, "contacts.view");
  const contact = await getContactById(ctx.organizationId, contactId);
  if (!contact) {
    throw new NotFoundError("Contact", contactId);
  }
  return contact;
}

export async function listContacts(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
) {
  requirePermission(ctx, "contacts.view");
  return listContactsRecords(ctx.organizationId, filters);
}

export async function checkDuplicateContacts(
  ctx: AuthContext,
  candidate: { email?: string; phone?: string },
) {
  requirePermission(ctx, "contacts.create");
  return findPossibleDuplicateContacts(ctx.organizationId, candidate);
}
