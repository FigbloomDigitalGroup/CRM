import type { CustomFieldEntity, CustomFieldSection } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import { countRecordsWithValue, getDefinition, listDefinitions, updateDefinition } from "../repositories/customFields";
import { getEmailTemplate, listEmailTemplates } from "../repositories/emailTemplates";
import {
  type UsageLine,
  catalogUsage,
  deleteCatalogEntry,
  deleteCustomFieldDefinitionRow,
  deleteTagRow,
  deleteTemplateRow,
  mergeCatalogEntries,
  setTagActive,
  templateUsage,
} from "../repositories/referenceAdmin";
import {
  CATALOG_KEYS,
  type CatalogEntry,
  type CatalogKey,
  getCatalogEntryById,
  listCatalogEntries,
} from "../repositories/referenceCatalogs";
import { getTag, listTagsWithUsage } from "../repositories/tags";
import {
  createCatalogEntry,
  reorderCatalogEntry,
  setCatalogEntryActive,
  updateCatalogEntry,
} from "./referenceCatalogService";
import { createCustomFieldDefinition, updateCustomFieldDefinition } from "./customFieldService";
import { createTag, mergeTags, updateTag } from "./tagService";
import { createTemplate, updateTemplate } from "./emailTemplateService";
import { LIFECYCLE_KEYS } from "./lifecycleService";

/**
 * Reference data admin (FIG-1063, B4.06, Settings design S5#2).
 *
 * One uniform service over everything an organisation configures as a list of values: lead sources, lead
 * statuses, pipeline stages, lost reasons, services, lifecycle states, tags, email templates and custom field
 * definitions. Each value can be created, renamed, reordered, hidden and counted; the rules are the same
 * everywhere:
 *
 *   - **Hide, don't delete, anything in use.** A value that records refer to can be hidden (it leaves the pickers
 *     and stays on the records that carry it) but not deleted. Deleting an unused value is allowed; deleting a
 *     used one is refused with the usage count and the advice to hide it.
 *   - **Merge re-points.** Merging value A into B moves every reference to B, removes A and audits the move.
 *   - **Some values are the system's.** Pipeline stages are fixed in V1 (rename only); the lifecycle states the
 *     lifecycle engine drives and the few values the code defaults to (the NEW status, the WEBSITE source) can be
 *     renamed but never hidden, deleted or merged away.
 *
 * Permissions follow the kind: configuration for the catalogs, `tags.manage`, `templates.manage`,
 * `customfields.manage`. The usual services still enforce their own rules on create, rename and hide.
 */

export const REFERENCE_KINDS = [...CATALOG_KEYS, "tags", "templates", "customFields"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export function isReferenceKind(value: string): value is ReferenceKind {
  return (REFERENCE_KINDS as readonly string[]).includes(value);
}

interface KindDef {
  label: string;
  permission: string;
  create: boolean;
  reorder: boolean;
  hide: boolean;
  delete: boolean;
  merge: boolean;
  /** Why the missing abilities are missing, shown to the person. */
  fixedNote?: string;
}

const KINDS: Record<ReferenceKind, KindDef> = {
  leadSources: { label: "Lead sources", permission: "configuration.manage", create: true, reorder: true, hide: true, delete: true, merge: true },
  leadStatuses: { label: "Lead statuses", permission: "configuration.manage", create: true, reorder: true, hide: true, delete: true, merge: true },
  pipelineStages: {
    label: "Pipeline stages",
    permission: "configuration.manage",
    create: false,
    reorder: false,
    hide: false,
    delete: false,
    merge: false,
    fixedNote: "The pipeline stages are fixed in V1. You can rename them.",
  },
  lostReasons: { label: "Lost reasons", permission: "configuration.manage", create: true, reorder: true, hide: true, delete: true, merge: true },
  services: { label: "Services", permission: "configuration.manage", create: true, reorder: true, hide: true, delete: true, merge: true },
  customerLifecycleStates: { label: "Lifecycle states", permission: "configuration.manage", create: true, reorder: true, hide: true, delete: true, merge: true },
  tags: { label: "Tags", permission: "tags.manage", create: true, reorder: false, hide: true, delete: true, merge: true },
  templates: { label: "Email templates", permission: "templates.manage", create: true, reorder: false, hide: true, delete: true, merge: false },
  customFields: { label: "Custom fields", permission: "customfields.manage", create: true, reorder: true, hide: true, delete: true, merge: false },
};

/** Values the system itself refers to by key: renamed freely, never hidden, deleted or merged away. */
const PROTECTED_KEYS: Partial<Record<CatalogKey, readonly string[]>> = {
  leadSources: ["WEBSITE"],
  leadStatuses: ["NEW"],
  customerLifecycleStates: Object.values(LIFECYCLE_KEYS) as string[],
};

const AUDIT_ENTITY: Record<ReferenceKind, string> = {
  leadSources: "LeadSource",
  leadStatuses: "LeadStatus",
  pipelineStages: "PipelineStage",
  lostReasons: "LostReason",
  services: "Service",
  customerLifecycleStates: "CustomerLifecycleState",
  tags: "Tag",
  templates: "EmailTemplate",
  customFields: "CustomFieldDefinition",
};

export interface ReferenceValueView {
  id: string;
  kind: ReferenceKind;
  name: string;
  key: string | null;
  hidden: boolean;
  /** Position among its siblings, or null for a kind that is listed alphabetically. */
  order: number | null;
  usageCount: number;
  protected: boolean;
  /** Where a custom field applies, and its type. Other kinds leave these null. */
  entityType: string | null;
  fieldType: string | null;
  capabilities: { rename: true; reorder: boolean; hide: boolean; delete: boolean; merge: boolean };
}

function sum(lines: UsageLine[]): number {
  return lines.reduce((n, l) => n + l.count, 0);
}

function describeUsage(lines: UsageLine[]): string {
  const used = lines.filter((l) => l.count > 0).map((l) => `${l.count} ${l.holder}`);
  if (used.length === 0) return "nothing";
  if (used.length === 1) return used[0]!;
  return `${used.slice(0, -1).join(", ")} and ${used[used.length - 1]}`;
}

function isProtected(kind: ReferenceKind, key: string | null): boolean {
  if (!key) return false;
  return (PROTECTED_KEYS[kind as CatalogKey] ?? []).includes(key);
}

function capabilitiesFor(kind: ReferenceKind, protectedValue: boolean): ReferenceValueView["capabilities"] {
  const def = KINDS[kind];
  return {
    rename: true,
    reorder: def.reorder,
    hide: def.hide && !protectedValue,
    delete: def.delete && !protectedValue,
    merge: def.merge && !protectedValue,
  };
}

function requireKind(ctx: AuthContext, kind: string): ReferenceKind {
  if (!isReferenceKind(kind)) throw new NotFoundError("Reference list", kind);
  requirePermission(ctx, KINDS[kind].permission);
  return kind;
}

/** The lists this caller may manage, with what each one allows. */
export async function listReferenceKinds(ctx: AuthContext) {
  return REFERENCE_KINDS.filter((k) => hasPermission(ctx, KINDS[k].permission)).map((k) => ({
    kind: k,
    label: KINDS[k].label,
    capabilities: { create: KINDS[k].create, reorder: KINDS[k].reorder, hide: KINDS[k].hide, delete: KINDS[k].delete, merge: KINDS[k].merge },
    note: KINDS[k].fixedNote ?? null,
  }));
}

function catalogView(kind: CatalogKey, entry: CatalogEntry, usageCount: number): ReferenceValueView {
  const protectedValue = isProtected(kind, entry.key);
  return {
    id: entry.id,
    kind,
    name: entry.name,
    key: entry.key,
    hidden: !entry.isActive,
    order: entry.sequence,
    usageCount,
    protected: protectedValue || kind === "pipelineStages",
    entityType: null,
    fieldType: null,
    capabilities: capabilitiesFor(kind, protectedValue),
  };
}

async function usageOf(ctx: AuthContext, kind: ReferenceKind, id: string): Promise<UsageLine[]> {
  const organizationId = ctx.organizationId;
  if ((CATALOG_KEYS as readonly string[]).includes(kind)) return catalogUsage(organizationId, kind as CatalogKey, id);
  if (kind === "tags") {
    const rows = await listTagsWithUsage(organizationId);
    return [{ holder: "tagged records", count: rows.find((t) => t.id === id)?.usage ?? 0 }];
  }
  if (kind === "templates") return templateUsage(organizationId, id);
  const def = await getDefinition(organizationId, id);
  if (!def) throw new NotFoundError("CustomFieldDefinition", id);
  return [{ holder: "records with a value", count: await countRecordsWithValue(organizationId, def.entityType, def.section, def.key) }];
}

/** Every value of one list, hidden ones included, with how many records use each. */
export async function listReferenceValues(ctx: AuthContext, kindParam: string): Promise<ReferenceValueView[]> {
  const kind = requireKind(ctx, kindParam);
  const organizationId = ctx.organizationId;

  if ((CATALOG_KEYS as readonly string[]).includes(kind)) {
    const entries = await listCatalogEntries(organizationId, kind as CatalogKey);
    return Promise.all(entries.map(async (e) => catalogView(kind as CatalogKey, e, sum(await catalogUsage(organizationId, kind as CatalogKey, e.id)))));
  }
  if (kind === "tags") {
    const tags = await listTagsWithUsage(organizationId);
    return tags.map((t) => ({
      id: t.id,
      kind,
      name: t.name,
      key: null,
      hidden: !t.isActive,
      order: null,
      usageCount: t.usage,
      protected: false,
      entityType: null,
      fieldType: null,
      capabilities: capabilitiesFor(kind, false),
    }));
  }
  if (kind === "templates") {
    const templates = await listEmailTemplates(organizationId, true);
    return Promise.all(
      templates.map(async (t) => ({
        id: t.id,
        kind,
        name: t.name,
        key: null,
        hidden: !t.isActive,
        order: null,
        usageCount: sum(await templateUsage(organizationId, t.id)),
        protected: false,
        entityType: null,
        fieldType: null,
        capabilities: capabilitiesFor(kind, false),
      })),
    );
  }
  const defs = await listDefinitions(organizationId, { includeInactive: true });
  return Promise.all(
    defs.map(async (d) => ({
      id: d.id,
      kind,
      name: d.label,
      key: d.key,
      hidden: !d.isActive,
      order: d.sortOrder,
      usageCount: await countRecordsWithValue(organizationId, d.entityType, d.section, d.key),
      protected: false,
      entityType: d.entityType,
      fieldType: d.fieldType,
      capabilities: capabilitiesFor(kind, false),
    })),
  );
}

async function getValue(ctx: AuthContext, kind: ReferenceKind, id: string): Promise<ReferenceValueView> {
  const found = (await listReferenceValues(ctx, kind)).find((v) => v.id === id);
  if (!found) throw new NotFoundError(AUDIT_ENTITY[kind], id);
  return found;
}

/** How many records use one value and what holds them: the "In use" state on the settings screens. */
export async function getReferenceValueUsage(ctx: AuthContext, kindParam: string, id: string) {
  const kind = requireKind(ctx, kindParam);
  await getValue(ctx, kind, id);
  const lines = await usageOf(ctx, kind, id);
  return { id, kind, usageCount: sum(lines), holders: lines.filter((l) => l.count > 0), inUse: sum(lines) > 0 };
}

export interface CreateReferenceInput {
  name: string;
  /** Kind-specific extras: description/probability/category for catalogs, colour for tags, subject/body for templates, entityType/key/fieldType/options/section for custom fields. */
  [extra: string]: unknown;
}

export async function createReferenceValue(ctx: AuthContext, kindParam: string, input: CreateReferenceInput): Promise<ReferenceValueView> {
  const kind = requireKind(ctx, kindParam);
  const def = KINDS[kind];
  if (!def.create) throw new ValidationError(def.fixedNote ?? `${def.label} cannot be added.`, [{ path: "kind", message: def.fixedNote ?? "Not allowed.", code: "FIXED_LIST" }]);

  let id: string;
  if ((CATALOG_KEYS as readonly string[]).includes(kind)) {
    const entry = await createCatalogEntry(ctx, kind as CatalogKey, {
      name: input.name,
      description: typeof input.description === "string" ? input.description : undefined,
      category: typeof input.category === "string" ? input.category : undefined,
    });
    id = entry.id;
  } else if (kind === "tags") {
    id = (await createTag(ctx, { name: input.name, colour: typeof input.colour === "string" ? input.colour : undefined })).id;
  } else if (kind === "templates") {
    if (typeof input.subject !== "string" || typeof input.body !== "string") {
      throw new ValidationError("A template needs a subject and a body.", [{ path: "subject", message: "Add the subject and the body." }]);
    }
    id = (await createTemplate(ctx, { name: input.name, subject: input.subject, body: input.body })).id;
  } else {
    if (typeof input.entityType !== "string" || typeof input.key !== "string") {
      throw new ValidationError("A custom field needs the record type it belongs to and a key.", [{ path: "entityType", message: "Say which record type and give a key." }]);
    }
    const created = await createCustomFieldDefinition(ctx, {
      entityType: input.entityType as CustomFieldEntity,
      key: input.key,
      label: input.name,
      fieldType: input.fieldType as never,
      options: input.options as never,
      section: input.section as CustomFieldSection | undefined,
      helpText: typeof input.helpText === "string" ? input.helpText : undefined,
    });
    id = created.id;
  }
  return getValue(ctx, kind, id);
}

export async function renameReferenceValue(ctx: AuthContext, kindParam: string, id: string, name: string): Promise<ReferenceValueView> {
  const kind = requireKind(ctx, kindParam);
  await getValue(ctx, kind, id);
  if ((CATALOG_KEYS as readonly string[]).includes(kind)) await updateCatalogEntry(ctx, kind as CatalogKey, id, { name });
  else if (kind === "tags") await updateTag(ctx, id, { name });
  else if (kind === "templates") await updateTemplate(ctx, id, { name });
  else await updateCustomFieldDefinition(ctx, id, { label: name });
  return getValue(ctx, kind, id);
}

export async function setReferenceValueHidden(ctx: AuthContext, kindParam: string, id: string, hidden: boolean): Promise<ReferenceValueView> {
  const kind = requireKind(ctx, kindParam);
  const value = await getValue(ctx, kind, id);
  if (hidden && !value.capabilities.hide) {
    throw new ValidationError(
      value.protected ? `"${value.name}" is used by the system itself, so it cannot be hidden.` : `${KINDS[kind].label} cannot be hidden.`,
      [{ path: "id", message: value.protected ? "The system relies on this value. You can rename it." : "Not allowed.", code: value.protected ? "SYSTEM_VALUE" : "FIXED_LIST" }],
    );
  }
  if (value.hidden === hidden) return value;

  if ((CATALOG_KEYS as readonly string[]).includes(kind)) await setCatalogEntryActive(ctx, kind as CatalogKey, id, !hidden);
  else if (kind === "tags") {
    await setTagActive(ctx.organizationId, id, !hidden);
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: hidden ? "tag.hidden" : "tag.unhidden",
      entityType: "Tag",
      entityId: id,
      metadata: { name: value.name },
    });
  } else if (kind === "templates") await updateTemplate(ctx, id, { isActive: !hidden });
  else await updateCustomFieldDefinition(ctx, id, { isActive: !hidden });
  return getValue(ctx, kind, id);
}

export async function reorderReferenceValue(ctx: AuthContext, kindParam: string, id: string, direction: "up" | "down"): Promise<ReferenceValueView[]> {
  const kind = requireKind(ctx, kindParam);
  if (!KINDS[kind].reorder) {
    throw new ValidationError(KINDS[kind].fixedNote ?? `${KINDS[kind].label} are listed alphabetically.`, [{ path: "kind", message: "This list cannot be reordered.", code: "FIXED_LIST" }]);
  }
  const value = await getValue(ctx, kind, id);
  if ((CATALOG_KEYS as readonly string[]).includes(kind)) {
    await reorderCatalogEntry(ctx, kind as CatalogKey, id, direction);
  } else {
    // Custom fields order within their own record type and section; positions are rewritten so ties cannot form.
    const def = await getDefinition(ctx.organizationId, id);
    if (!def) throw new NotFoundError("CustomFieldDefinition", id);
    const siblings = (await listDefinitions(ctx.organizationId, { entityType: def.entityType, section: def.section, includeInactive: true })).map((s) => s.id);
    const index = siblings.indexOf(id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target >= 0 && target < siblings.length) {
      [siblings[index], siblings[target]] = [siblings[target]!, siblings[index]!];
      for (let i = 0; i < siblings.length; i += 1) await updateDefinition(ctx.organizationId, siblings[i]!, { sortOrder: i });
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "custom_field.reordered",
        entityType: "CustomFieldDefinition",
        entityId: id,
        metadata: { direction, name: value.name },
      });
    }
  }
  return listReferenceValues(ctx, kind);
}

/** Delete an unused value. A used one is refused with how many records use it, and the advice to hide it. */
export async function deleteReferenceValue(ctx: AuthContext, kindParam: string, id: string) {
  const kind = requireKind(ctx, kindParam);
  const value = await getValue(ctx, kind, id);
  if (!value.capabilities.delete) {
    throw new ValidationError(
      value.protected ? `"${value.name}" is used by the system itself, so it cannot be deleted.` : (KINDS[kind].fixedNote ?? `${KINDS[kind].label} cannot be deleted.`),
      [{ path: "id", message: value.protected ? "The system relies on this value. You can rename it." : "Not allowed.", code: value.protected ? "SYSTEM_VALUE" : "FIXED_LIST" }],
    );
  }
  const lines = await usageOf(ctx, kind, id);
  const used = sum(lines);
  if (used > 0) {
    const message = `"${value.name}" is in use (${describeUsage(lines)}), so it cannot be deleted. Hide it instead: it stays on those records and leaves the pickers.`;
    throw new ValidationError(message, [{ path: "id", message, code: "IN_USE" }]);
  }

  if ((CATALOG_KEYS as readonly string[]).includes(kind)) await deleteCatalogEntry(ctx.organizationId, kind as CatalogKey, id);
  else if (kind === "tags") await deleteTagRow(ctx.organizationId, id);
  else if (kind === "templates") await deleteTemplateRow(ctx.organizationId, id);
  else await deleteCustomFieldDefinitionRow(ctx.organizationId, id);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reference_value.deleted",
    entityType: AUDIT_ENTITY[kind],
    entityId: id,
    previousValue: { name: value.name, key: value.key },
    metadata: { kind },
  });
  return { id, deleted: true as const };
}

/** Merge one value into another: everything that pointed at `fromId` points at `intoId`, and `fromId` is removed. */
export async function mergeReferenceValues(ctx: AuthContext, kindParam: string, fromId: string, intoId: string) {
  const kind = requireKind(ctx, kindParam);
  if (!KINDS[kind].merge) {
    throw new ValidationError(KINDS[kind].fixedNote ?? `${KINDS[kind].label} cannot be merged.`, [{ path: "kind", message: "This list cannot be merged.", code: "FIXED_LIST" }]);
  }
  if (fromId === intoId) throw new ValidationError("Choose two different values to merge.", [{ path: "intoId", message: "Pick a different value to merge into." }]);
  const [from, into] = await Promise.all([getValue(ctx, kind, fromId), getValue(ctx, kind, intoId)]);
  if (!from.capabilities.merge) {
    throw new ValidationError(`"${from.name}" is used by the system itself, so it cannot be merged away. Merge into it instead.`, [{ path: "fromId", message: "The system relies on this value.", code: "SYSTEM_VALUE" }]);
  }
  if (into.hidden) {
    throw new ValidationError(`"${into.name}" is hidden. Merge into a visible value, or unhide it first.`, [{ path: "intoId", message: "Merging into a hidden value would hide the merged records' value from pickers.", code: "TARGET_HIDDEN" }]);
  }

  let moved: UsageLine[];
  if (kind === "tags") {
    const result = await mergeTags(ctx, fromId, intoId);
    moved = [{ holder: "tagged records", count: result.recordsMoved }];
  } else {
    moved = await mergeCatalogEntries(ctx.organizationId, kind as CatalogKey, fromId, intoId);
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "reference_value.merged",
      entityType: AUDIT_ENTITY[kind],
      entityId: intoId,
      metadata: { kind, mergedFrom: from.name, mergedInto: into.name, moved: Object.fromEntries(moved.filter((m) => m.count > 0).map((m) => [m.holder, m.count])) },
    });
  }
  return { into: await getValue(ctx, kind, intoId), moved: moved.filter((m) => m.count > 0), removed: { id: fromId, name: from.name } };
}

// Kept for callers that only need to know a value exists and is visible to pickers.
export async function isVisibleInPickers(organizationId: string, kind: ReferenceKind, id: string): Promise<boolean> {
  if ((CATALOG_KEYS as readonly string[]).includes(kind)) return (await getCatalogEntryById(organizationId, kind as CatalogKey, id))?.isActive ?? false;
  if (kind === "tags") return (await getTag(organizationId, id))?.isActive ?? false;
  if (kind === "templates") return (await getEmailTemplate(organizationId, id))?.isActive ?? false;
  return (await getDefinition(organizationId, id))?.isActive ?? false;
}
