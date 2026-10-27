import type { Contact, Prisma } from "@prisma/client";
import { canAssignAccountOwner, canWorkAccounts } from "../auth/accountAccess";
import { assertWritable, cleanArchiveReason } from "../lib/archive";
import { findDuplicates } from "./duplicateService";
import { auditCustomFieldChanges, prepareCustomFields } from "./customFieldService";
import { MERGE_UNDO_WINDOW_MS, validateMergeChoices, type MergeOptions } from "../lib/merge";
import { mergeRecords } from "../repositories/merges";
import type { AuthContext } from "../auth/context";
import {
  deny, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getCompanyById } from "../repositories/companies";
import {
  archiveContact as archiveContactRecord,
  createContact as createContactRecord,
  findPossibleDuplicateContacts,
  getContactById,
  countContacts as countContactsRecords,
  listContacts as listContactsRecords,
  restoreContact as restoreContactRecord,
  updateContact as updateContactRecord,
  type CreateContactInput,
  type ListContactsFilters,
  type UpdateContactInput,
} from "../repositories/contacts";
import {
  cleanEmail,
  cleanNotes,
  cleanOptionalText,
  cleanRequiredText,
  omitNull,
} from "./accountValidation";
import { diffAuditedFields } from "./auditDiff";
import {
  assertEligibleAccountOwner,
  listAccountOwnerCandidates,
} from "./ownerEligibility";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";

/** Beyond ownership (audited separately, below): identity and re-parenting (FIG-600 AC). */
const AUDITED_CONTACT_FIELDS = ["firstName", "lastName", "companyId"] as const;

export type CreateContactServiceInput = Omit<
  CreateContactInput,
  "organizationId" | "createdByMembershipId"
>;

/**
 * Contacts, like companies, are shared org-wide: anyone who can view them
 * sees all of them, anyone who can edit them can edit all of them. Only
 * handing a contact to a different owner is restricted
 * (`canAssignAccountOwner`: Management).
 */

/**
 * A contact can only be filed under a company that exists in this
 * organization and is still active. The foreign key alone would happily
 * accept another tenant's company id, so this is checked explicitly.
 */
async function assertLinkableCompany(
  organizationId: string,
  companyId: string | null | undefined,
) {
  if (!companyId) return;
  const company = await getCompanyById(organizationId, companyId);
  if (!company) {
    throw new ValidationError("That company does not exist in this organization.");
  }
  if (company.archivedAt) {
    throw new ValidationError(
      "That company is archived. Restore it or pick an active company.",
    );
  }
}

/** People who can be handed a contact -- feeds the owner pickers. Management only. */
export async function listAssignableContactOwners(ctx: AuthContext) {
  if (!canAssignAccountOwner(ctx, "contacts")) {
    throw deny(ctx, "contacts.edit + membership.manage", ["contacts.edit", "membership.manage"]);
  }
  return listAccountOwnerCandidates(ctx.organizationId, "contacts");
}

export async function createContact(
  ctx: AuthContext,
  input: CreateContactServiceInput,
  /** `skipDuplicateCheck`: the caller already checked (quick capture warns first), so do not search a second time. */
  options: { skipDuplicateCheck?: boolean } = {},
) {
  requirePermission(ctx, "contacts.create");

  const firstName = cleanRequiredText(input.firstName, "First name");
  if (!firstName) throw new ValidationError("First name is required.");

  // The person who adds a contact owns it (when they could work it);
  // naming someone else is a reassignment and needs the same rights as one.
  let ownerMembershipId: string | undefined = canWorkAccounts(
    ctx.permissionKeys,
    "contacts",
  )
    ? ctx.membershipId
    : undefined;
  if (
    input.ownerMembershipId &&
    input.ownerMembershipId !== ctx.membershipId
  ) {
    if (!canAssignAccountOwner(ctx, "contacts")) {
      throw deny(ctx, "contacts.edit + membership.manage (to choose a different owner)", ["contacts.edit", "membership.manage"]);
    }
    await assertEligibleAccountOwner(
      ctx.organizationId,
      input.ownerMembershipId,
      "contacts",
    );
    ownerMembershipId = input.ownerMembershipId;
  }

  await assertLinkableCompany(ctx.organizationId, input.companyId);

  const clean = {
    firstName,
    lastName: omitNull(cleanOptionalText(input.lastName, "Last name")),
    jobTitle: omitNull(cleanOptionalText(input.jobTitle, "Job title")),
    department: omitNull(cleanOptionalText(input.department, "Department")),
    phone: omitNull(cleanOptionalText(input.phone, "Phone", 40)),
    email: omitNull(cleanEmail(input.email)),
    notes: omitNull(cleanNotes(input.notes)),
  };

  const possibleDuplicates = options.skipDuplicateCheck
    ? []
    : await findPossibleDuplicateContacts(ctx.organizationId, { email: clean.email, phone: clean.phone });
  const found = options.skipDuplicateCheck
    ? { candidates: [], hiddenCount: 0 }
    : await findDuplicates(ctx, {
        entity: "contact",
        firstName: clean.firstName,
        lastName: clean.lastName,
        email: clean.email,
        phone: clean.phone,
        companyId: input.companyId,
      });

  const custom = await prepareCustomFields(ctx.organizationId, "CONTACT", {
    incoming: input.customFields as Record<string, unknown> | undefined,
    mode: "create",
  });

  const contact = await createContactRecord({
    ...input,
    ...clean,
    customFields: custom?.values as Prisma.InputJsonValue | undefined,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    ownerMembershipId,
  });

  if (ownerMembershipId && ownerMembershipId !== ctx.membershipId) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "contact.owner_reassigned",
      entityType: "Contact",
      entityId: contact.id,
      previousValue: { ownerMembershipId: ctx.membershipId },
      newValue: { ownerMembershipId },
    });
  }

  return { contact, possibleDuplicates, duplicates: found.candidates, hiddenDuplicates: found.hiddenCount };
}

export async function updateContact(
  ctx: AuthContext,
  contactId: string,
  input: UpdateContactInput,
) {
  requirePermission(ctx, "contacts.edit");

  const previous = await getContactById(ctx.organizationId, contactId);
  if (!previous) {
    throw new NotFoundError("Contact", contactId);
  }
  assertWritable(ctx, "contact", previous, "editing it");

  const custom = await prepareCustomFields(ctx.organizationId, "CONTACT", {
    existing: previous.customFields as Record<string, unknown>,
    incoming: input.customFields as Record<string, unknown> | undefined,
    mode: "update",
  });

  const data: UpdateContactInput = {
    customFields: custom?.values as Prisma.InputJsonValue | undefined,
    firstName: cleanRequiredText(input.firstName, "First name"),
    lastName: cleanOptionalText(input.lastName, "Last name"),
    jobTitle: cleanOptionalText(input.jobTitle, "Job title"),
    department: cleanOptionalText(input.department, "Department"),
    phone: cleanOptionalText(input.phone, "Phone", 40),
    email: cleanEmail(input.email),
    notes: cleanNotes(input.notes),
    companyId: input.companyId,
  };

  // Only re-validate the company when it is actually being changed, so a
  // contact whose company was archived later can still have its other
  // details corrected.
  if (
    input.companyId !== undefined &&
    input.companyId !== previous.companyId
  ) {
    await assertLinkableCompany(ctx.organizationId, input.companyId);
  }

  let ownerChanged = false;
  if (
    input.ownerMembershipId !== undefined &&
    input.ownerMembershipId !== previous.ownerMembershipId
  ) {
    if (!canAssignAccountOwner(ctx, "contacts")) {
      throw deny(ctx, "contacts.edit + membership.manage (to reassign the owner)", ["contacts.edit", "membership.manage"]);
    }
    if (!input.ownerMembershipId) {
      throw new ValidationError(
        "A contact needs an owner -- pick someone to hand it to.",
      );
    }
    await assertEligibleAccountOwner(
      ctx.organizationId,
      input.ownerMembershipId,
      "contacts",
    );
    data.ownerMembershipId = input.ownerMembershipId;
    ownerChanged = true;
  }

  // Ownership changes are auditable (FIG-441 AC) regardless of which
  // other fields this same edit also touches.
  if (ownerChanged) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "contact.owner_reassigned",
      entityType: "Contact",
      entityId: contactId,
      previousValue: { ownerMembershipId: previous.ownerMembershipId },
      newValue: { ownerMembershipId: data.ownerMembershipId },
    });
  }

  // Broadened beyond ownership to other important field changes (FIG-600
  // AC) -- name edits and re-parenting to a different company, bundled
  // into one event.
  const diff = diffAuditedFields(previous, data, AUDITED_CONTACT_FIELDS);
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

  const updated = await updateContactRecord(ctx.organizationId, contactId, data);
  if (custom) await auditCustomFieldChanges(ctx, "Contact", contactId, custom.changes);
  return updated;
}

export async function getContact(ctx: AuthContext, contactId: string) {
  requirePermission(ctx, "contacts.view");
  const contact = await getContactById(ctx.organizationId, contactId);
  if (!contact) {
    throw new NotFoundError("Contact", contactId);
  }
  return contact;
}

/** Every matching contact, unpaged -- internal use; list screens and the API use `listContactsPage` (FIG-789). */
export async function listContacts(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
) {
  requirePermission(ctx, "contacts.view");
  return listContactsRecords(ctx.organizationId, filters);
}

/** One page of contacts plus the total (FIG-789). */
export async function listContactsPage(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
  request: PageRequest = {},
) {
  requirePermission(ctx, "contacts.view");
  const paging = resolvePaging(request);
  const [items, total] = await Promise.all([
    listContactsRecords(ctx.organizationId, {
      ...filters,
      take: paging.take,
      skip: paging.skip,
    }),
    countContactsRecords(ctx.organizationId, filters),
  ]);
  return buildPage(items, total, paging);
}

/** How many contacts match `filters` -- a COUNT, never a row fetch (FIG-789). */
export async function countContacts(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
) {
  requirePermission(ctx, "contacts.view");
  return countContactsRecords(ctx.organizationId, filters);
}

export async function checkDuplicateContacts(
  ctx: AuthContext,
  candidate: { email?: string; phone?: string },
) {
  requirePermission(ctx, "contacts.create");
  return findPossibleDuplicateContacts(ctx.organizationId, candidate);
}

/** Soft-delete (FIG-601) -- the row and everything linked to it stays intact, just hidden from default lists. */
export async function archiveContact(ctx: AuthContext, contactId: string, input: { reason?: string | null } = {}) {
  requirePermission(ctx, "contacts.archive");
  const contact = await getContact(ctx, contactId);
  if (contact.archivedAt) {
    throw new ValidationError("This contact is already archived.");
  }

  const reason = cleanArchiveReason(input.reason);
  const archived = await archiveContactRecord(ctx.organizationId, contactId, {
    membershipId: ctx.membershipId,
    reason,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.archived",
    entityType: "Contact",
    entityId: contactId,
    metadata: reason ? { reason } : undefined,
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
  options: MergeOptions = {},
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

  validateMergeChoices("Contact", options.fields);
  const outcome = await mergeRecords<Contact>({
    organizationId: ctx.organizationId,
    entity: "Contact",
    loserId,
    winnerId,
    mergedByMembershipId: ctx.membershipId,
    choices: options.fields,
    undoExpiresAt: new Date(Date.now() + MERGE_UNDO_WINDOW_MS),
    archiveReason: "Merged into another contact.",
  });
  const merged = { ...outcome.loser, mergeRecordId: outcome.mergeRecordId, undoExpiresAt: new Date(Date.now() + MERGE_UNDO_WINDOW_MS) };

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contact.merged",
    entityType: "Contact",
    entityId: loserId,
    newValue: { mergedIntoId: winnerId },
    metadata: {
      winnerName: `${winner.firstName} ${winner.lastName ?? ""}`.trim(),
      mergeRecordId: outcome.mergeRecordId,
      fieldsChanged: outcome.changedFields,
      moved: outcome.moved,
    },
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
