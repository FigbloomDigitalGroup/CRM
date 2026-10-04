import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  archiveContact as archiveContactRecord,
  createContact as createContactRecord,
  findPossibleDuplicateContacts,
  getContactById,
  listContacts as listContactsRecords,
  mergeContacts as mergeContactsRecord,
  restoreContact as restoreContactRecord,
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

/** Soft-delete (FIG-601) -- the row and everything linked to it stays intact, just hidden from default lists. */
export async function archiveContact(ctx: AuthContext, contactId: string) {
  requirePermission(ctx, "contacts.archive");
  const contact = await getContact(ctx, contactId);
  if (contact.archivedAt) {
    throw new ValidationError("This contact is already archived.");
  }

  const archived = await archiveContactRecord(ctx.organizationId, contactId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.archived",
    entityType: "Contact",
    entityId: contactId,
  });

  return archived;
}

/**
 * Restoring a contact that was the *loser* of a merge only un-hides the
 * now-empty shell record -- see `companyService.restoreCompany`'s doc
 * comment for the same caveat on the Contact side.
 */
export async function restoreContact(ctx: AuthContext, contactId: string) {
  requirePermission(ctx, "contacts.archive");
  const contact = await getContact(ctx, contactId);
  if (!contact.archivedAt) {
    throw new ValidationError("This contact is not archived.");
  }

  const restored = await restoreContactRecord(ctx.organizationId, contactId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.restored",
    entityType: "Contact",
    entityId: contactId,
  });

  return restored;
}

/**
 * Merges `loserId` into `winnerId` (FIG-601 AC) -- every Lead/Deal(-as-
 * primary-contact)/Activity/Task/Communication currently pointing at the
 * loser gets re-pointed at the winner in one transaction, then the loser
 * is archived with `mergedIntoId` set. See `companyService.mergeCompanies`
 * for the equivalent on the Company side.
 */
export async function mergeContacts(
  ctx: AuthContext,
  loserId: string,
  winnerId: string,
) {
  requirePermission(ctx, "contacts.merge");
  if (loserId === winnerId) {
    throw new ValidationError("Cannot merge a contact into itself.");
  }

  const loser = await getContact(ctx, loserId);
  const winner = await getContact(ctx, winnerId);
  if (loser.archivedAt) {
    throw new ValidationError("This contact is already archived -- it may already have been merged.");
  }
  if (winner.archivedAt) {
    throw new ValidationError("Cannot merge into an archived contact.");
  }

  const merged = await mergeContactsRecord(ctx.organizationId, loserId, winnerId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.merged",
    entityType: "Contact",
    entityId: loserId,
    newValue: { mergedIntoId: winnerId },
    metadata: { winnerName: `${winner.firstName} ${winner.lastName ?? ""}`.trim() },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.merged_from",
    entityType: "Contact",
    entityId: winnerId,
    metadata: { loserId, loserName: `${loser.firstName} ${loser.lastName ?? ""}`.trim() },
  });

  return merged;
}
