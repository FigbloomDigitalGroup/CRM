import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
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
import { diffAuditedFields } from "./auditDiff";

/** Beyond ownership (audited separately, below): identity and re-parenting (FIG-600 AC). */
const AUDITED_CONTACT_FIELDS = ["firstName", "lastName", "companyId"] as const;

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

  const previous = await getContactById(ctx.organizationId, contactId);

  // Ownership changes are auditable (FIG-441 AC) regardless of which
  // other fields this same edit also touches.
  if (previous && input.ownerMembershipId !== undefined) {
    if (previous.ownerMembershipId !== input.ownerMembershipId) {
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "contact.owner_reassigned",
        entityType: "Contact",
        entityId: contactId,
        previousValue: { ownerMembershipId: previous.ownerMembershipId },
        newValue: { ownerMembershipId: input.ownerMembershipId },
      });
    }
  }

  // Broadened beyond ownership to other important field changes (FIG-600
  // AC) -- name edits and re-parenting to a different company, bundled
  // into one event.
  if (previous) {
    const diff = diffAuditedFields(previous, input, AUDITED_CONTACT_FIELDS);
    if (diff) {
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "contact.updated",
        entityType: "Contact",
        entityId: contactId,
        previousValue: diff.previousValue,
        newValue: diff.newValue,
      });
    }
  }

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
