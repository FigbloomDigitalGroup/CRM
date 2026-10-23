import type { AuthContext } from "../auth/context";
import { hasPermission, requireOwnedRecordPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { canUseResource } from "../auth/permissions";
import { assertWritable } from "../lib/archive";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  changeRecordTags,
  countTagsForRecord,
  createTagRecord,
  deleteTagRecord,
  findTagByName,
  findTagsByIds,
  getTag,
  listTagsForRecord,
  listTagsWithUsage,
  mergeTagRecords,
  updateTagRecord,
  type TaggableEntity,
} from "../repositories/tags";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";

/**
 * Tags (FIG-798). Management (`tags.manage`) creates, renames, recolours,
 * merges and deletes tags in Settings. Anyone who may edit a record can add or
 * remove the organisation's existing tags on it; creating a new tag on the fly
 * needs `tags.manage`.
 */

export const MAX_TAGS_PER_RECORD = 20;
export const MAX_TAG_NAME_LENGTH = 40;

/** Palette keys from the design system, or a six-digit hex colour. */
export const TAG_COLOUR_KEYS = ["forest", "ocean", "sun", "berry", "plum", "slate", "clay", "mint"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;


function cleanName(name: string | undefined): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) throw new ValidationError("A tag needs a name.", [{ path: "name", message: "A name is required." }]);
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new ValidationError("The tag name is too long.", [{ path: "name", message: `At most ${MAX_TAG_NAME_LENGTH} characters.` }]);
  }
  return trimmed;
}

function cleanColour(colour: string | undefined): string {
  if (colour === undefined) return "forest";
  if ((TAG_COLOUR_KEYS as readonly string[]).includes(colour) || HEX.test(colour)) return colour;
  throw new ValidationError("Unknown colour.", [{ path: "colour", message: `Use one of ${TAG_COLOUR_KEYS.join(", ")} or a hex colour such as #2f6f4f.` }]);
}

/** Tags are visible to anyone who can open at least one of the taggable record types. */
function requireCanSeeTags(ctx: AuthContext) {
  if (hasPermission(ctx, "tags.manage")) return;
  const some = ["leads", "contacts", "companies", "deals"].some((r) => canUseResource(ctx, r as "leads" | "contacts" | "companies" | "deals"));
  if (!some) requirePermission(ctx, "tags.manage");
}

export async function listTags(ctx: AuthContext, query?: string) {
  requireCanSeeTags(ctx);
  return listTagsWithUsage(ctx.organizationId, query?.trim() || undefined);
}

export async function createTag(ctx: AuthContext, input: { name: string; colour?: string }) {
  requirePermission(ctx, "tags.manage");
  const name = cleanName(input.name);
  const colour = cleanColour(input.colour);
  if (await findTagByName(ctx.organizationId, name)) {
    throw new ValidationError("A tag with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_TAG" }]);
  }
  const tag = await createTagRecord({ organizationId: ctx.organizationId, name, colour, createdByMembershipId: ctx.membershipId });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "tag.created",
    entityType: "Tag",
    entityId: tag.id,
    newValue: { name, colour },
  });
  return tag;
}

export async function updateTag(ctx: AuthContext, tagId: string, patch: { name?: string; colour?: string }) {
  requirePermission(ctx, "tags.manage");
  const tag = await getTag(ctx.organizationId, tagId);
  if (!tag) throw new NotFoundError("Tag", tagId);
  const data: { name?: string; colour?: string } = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    const clash = await findTagByName(ctx.organizationId, name);
    if (clash && clash.id !== tagId) {
      throw new ValidationError("A tag with this name already exists.", [{ path: "name", message: "Merge the tags instead.", code: "DUPLICATE_TAG" }]);
    }
    data.name = name;
  }
  if (patch.colour !== undefined) data.colour = cleanColour(patch.colour);
  const updated = await updateTagRecord(ctx.organizationId, tagId, data);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "tag.updated",
    entityType: "Tag",
    entityId: tagId,
    previousValue: { name: tag.name, colour: tag.colour },
    newValue: { name: updated.name, colour: updated.colour },
  });
  return updated;
}

/** Merges `fromId` into `intoId`: records tagged with the first end up tagged with the second, once. */
export async function mergeTags(ctx: AuthContext, fromId: string, intoId: string) {
  requirePermission(ctx, "tags.manage");
  if (fromId === intoId) throw new ValidationError("Cannot merge a tag into itself.");
  const [from, into] = await Promise.all([getTag(ctx.organizationId, fromId), getTag(ctx.organizationId, intoId)]);
  if (!from) throw new NotFoundError("Tag", fromId);
  if (!into) throw new NotFoundError("Tag", intoId);
  const moved = await mergeTagRecords(ctx.organizationId, fromId, intoId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "tag.merged",
    entityType: "Tag",
    entityId: intoId,
    metadata: { mergedFrom: from.name, mergedInto: into.name, recordsMoved: moved },
  });
  return { ...into, recordsMoved: moved };
}

export async function deleteTag(ctx: AuthContext, tagId: string) {
  requirePermission(ctx, "tags.manage");
  const tag = await getTag(ctx.organizationId, tagId);
  if (!tag) throw new NotFoundError("Tag", tagId);
  await deleteTagRecord(ctx.organizationId, tagId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "tag.deleted",
    entityType: "Tag",
    entityId: tagId,
    previousValue: { name: tag.name, colour: tag.colour },
  });
  return { id: tagId };
}

const AUDIT_ENTITY = { lead: "Lead", contact: "Contact", company: "Company", deal: "Deal" } as const;

/** Loads the record the caller may tag: it must be visible, editable by them, and not archived. */
async function loadForTagging(ctx: AuthContext, entity: TaggableEntity, id: string) {
  switch (entity) {
    case "lead": {
      const lead = await getLead(ctx, id);
      requireOwnedRecordPermission(ctx, "leads.edit.own", "leads.edit.all", lead.ownerMembershipId);
      assertWritable(ctx, "lead", lead, "changing its tags");
      return;
    }
    case "deal": {
      const deal = await getDeal(ctx, id);
      requireOwnedRecordPermission(ctx, "deals.edit.own", "deals.edit.all", deal.ownerMembershipId);
      assertWritable(ctx, "deal", deal, "changing its tags");
      return;
    }
    case "contact": {
      requirePermission(ctx, "contacts.edit");
      const contact = await getContact(ctx, id);
      assertWritable(ctx, "contact", contact, "changing its tags");
      return;
    }
    case "company": {
      requirePermission(ctx, "companies.edit");
      const company = await getCompany(ctx, id);
      assertWritable(ctx, "company", company, "changing its tags");
      return;
    }
  }
}

export interface TagChange {
  /** Existing tags by id. */
  addTagIds?: string[];
  /** Tags by name: an existing tag is used (any case); a missing one is created, which needs `tags.manage`. */
  addTagNames?: string[];
  removeTagIds?: string[];
}

/** Adds and removes tags on one record and returns its tags. */
export async function changeTags(ctx: AuthContext, entity: TaggableEntity, recordId: string, change: TagChange) {
  await loadForTagging(ctx, entity, recordId);
  const issues: ValidationIssue[] = [];

  const addIds = new Set(change.addTagIds ?? []);
  const wanted = await findTagsByIds(ctx.organizationId, [...addIds]);
  for (const id of addIds) {
    if (!wanted.some((t) => t.id === id)) issues.push({ path: "addTagIds", message: `Tag ${id} does not exist.`, code: "UNKNOWN_TAG" });
  }

  const created: string[] = [];
  for (const raw of change.addTagNames ?? []) {
    const name = cleanName(raw);
    const existing = await findTagByName(ctx.organizationId, name);
    if (existing) {
      addIds.add(existing.id);
    } else if (hasPermission(ctx, "tags.manage")) {
      const tag = await createTagRecord({ organizationId: ctx.organizationId, name, colour: "forest", createdByMembershipId: ctx.membershipId });
      addIds.add(tag.id);
      created.push(tag.name);
    } else {
      issues.push({ path: "addTagNames", message: `"${name}" is not an existing tag, and your role cannot create tags.`, code: "TAG_CREATE_FORBIDDEN" });
    }
  }
  if (issues.length > 0) throw new ValidationError("Some tags could not be added.", issues);

  const remove = (change.removeTagIds ?? []).filter((id) => !addIds.has(id));
  const before = await listTagsForRecord(ctx.organizationId, entity, recordId);
  const beforeIds = new Set(before.map((t) => t.id));
  const reallyAdding = [...addIds].filter((id) => !beforeIds.has(id));
  if (before.length + reallyAdding.length - remove.filter((id) => beforeIds.has(id)).length > MAX_TAGS_PER_RECORD) {
    throw new ValidationError(`A record can have at most ${MAX_TAGS_PER_RECORD} tags.`, [{ path: "addTagIds", message: `At most ${MAX_TAGS_PER_RECORD} tags.` }]);
  }

  await changeRecordTags({
    organizationId: ctx.organizationId,
    entity,
    recordId,
    addTagIds: reallyAdding,
    removeTagIds: remove,
    createdByMembershipId: ctx.membershipId,
  });
  const after = await listTagsForRecord(ctx.organizationId, entity, recordId);
  const afterIds = new Set(after.map((t) => t.id));
  const added = after.filter((t) => !beforeIds.has(t.id)).map((t) => t.name);
  const removed = before.filter((t) => !afterIds.has(t.id)).map((t) => t.name);
  if (added.length > 0 || removed.length > 0) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: `${entity}.tags_updated`,
      entityType: AUDIT_ENTITY[entity],
      entityId: recordId,
      previousValue: { tags: before.map((t) => t.name) },
      newValue: { tags: after.map((t) => t.name) },
      metadata: { added, removed, created },
    });
  }
  return after;
}

/** The tags on a record, for anyone who can open the record. */
export async function getRecordTags(ctx: AuthContext, entity: TaggableEntity, recordId: string) {
  switch (entity) {
    case "lead":
      await getLead(ctx, recordId);
      break;
    case "deal":
      await getDeal(ctx, recordId);
      break;
    case "contact":
      await getContact(ctx, recordId);
      break;
    case "company":
      await getCompany(ctx, recordId);
      break;
  }
  return listTagsForRecord(ctx.organizationId, entity, recordId);
}

export { countTagsForRecord };
