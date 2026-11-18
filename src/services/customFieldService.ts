import type { CustomFieldDefinition, CustomFieldEntity, CustomFieldSection, CustomFieldType, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { canUseResource, type ScopedResource } from "../auth/permissions";
import { adminDb } from "../db/adminClient";
import {
  FIELD_KEY_PATTERN,
  applyValues,
  filterValueFor,
  type JsonClause,
  missingRequired,
  validateDefinitionOptions,
  type FieldDefinition,
} from "../lib/customFields";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  countRecordsWithValue,
  createDefinition,
  getDefinition,
  listDefinitions,
  updateDefinition,
} from "../repositories/customFields";

/**
 * Custom fields (FIG-803) and qualification questions (FIG-1030, B2.01):
 * definitions managed by Management (`customfields.manage`), values validated
 * on every write of a lead, contact, company or deal. Qualification questions
 * are definitions with `section = QUALIFICATION` on leads, optionally tied to
 * one service; their answers live in the lead's `qualificationData`.
 */

const RESOURCE: Record<CustomFieldEntity, ScopedResource> = {
  LEAD: "leads",
  CONTACT: "contacts",
  COMPANY: "companies",
  DEAL: "deals",
};

export const MAX_DEFINITIONS_PER_ENTITY = 100;

export function toFieldDefinition(def: CustomFieldDefinition): FieldDefinition {
  return {
    key: def.key,
    label: def.label,
    fieldType: def.fieldType,
    options: def.options,
    required: def.required,
    requiredOnQualify: def.requiredOnQualify,
    section: def.section,
    serviceId: def.serviceId,
    isActive: def.isActive,
  };
}

export async function listCustomFieldDefinitions(
  ctx: AuthContext,
  filter: { entityType?: CustomFieldEntity; section?: CustomFieldSection; includeInactive?: boolean } = {},
) {
  const manager = ctx.permissionKeys.includes("customfields.manage");
  if (!manager) {
    // Anyone who can open the record type can see its fields; nothing else is exposed.
    const entities = filter.entityType ? [filter.entityType] : (Object.keys(RESOURCE) as CustomFieldEntity[]);
    const allowed = entities.filter((e) => canUseResource(ctx, RESOURCE[e]));
    if (allowed.length === 0) requirePermission(ctx, "customfields.manage");
    const rows = await Promise.all(allowed.map((entityType) => listDefinitions(ctx.organizationId, { ...filter, entityType, includeInactive: false })));
    return rows.flat();
  }
  return listDefinitions(ctx.organizationId, filter);
}

/** Active definitions of one entity, for the services that validate values. */
export async function loadActiveDefinitions(organizationId: string, entityType: CustomFieldEntity, section?: CustomFieldSection) {
  return listDefinitions(organizationId, { entityType, section, includeInactive: false });
}

export interface DefinitionInput {
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  fieldType?: CustomFieldType;
  options?: { value: string; label: string }[];
  helpText?: string | null;
  required?: boolean;
  section?: CustomFieldSection;
  requiredOnQualify?: boolean;
  serviceId?: string | null;
  sortOrder?: number;
}

function cleanLabel(label: string | undefined): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed) throw new ValidationError("A field needs a label.", [{ path: "label", message: "A label is required." }]);
  if (trimmed.length > 80) throw new ValidationError("The label is too long.", [{ path: "label", message: "At most 80 characters." }]);
  return trimmed;
}

async function assertServiceBelongs(organizationId: string, serviceId: string | null | undefined) {
  if (!serviceId) return;
  const service = await adminDb.service.findFirst({ where: { id: serviceId, organizationId }, select: { id: true } });
  if (!service) throw new ValidationError("Unknown service.", [{ path: "serviceId", message: "Choose one of this organisation's services." }]);
}

export async function createCustomFieldDefinition(ctx: AuthContext, input: DefinitionInput) {
  requirePermission(ctx, "customfields.manage");
  const section = input.section ?? "GENERAL";
  const fieldType = input.fieldType ?? "TEXT";
  const issues: ValidationIssue[] = [];
  if (!FIELD_KEY_PATTERN.test(input.key)) {
    issues.push({ path: "key", message: "Use lower-case letters, digits and underscores, starting with a letter (at most 50 characters).", code: "INVALID_KEY" });
  }
  if (section === "QUALIFICATION" && input.entityType !== "LEAD") {
    issues.push({ path: "section", message: "Only leads have qualification questions." });
  }
  if (section === "GENERAL" && (input.serviceId || input.requiredOnQualify)) {
    issues.push({ path: "section", message: "Only a qualification question can be tied to a service or required before qualifying." });
  }
  issues.push(...validateDefinitionOptions(fieldType, input.options));
  if (issues.length > 0) throw new ValidationError("This field is not valid.", issues);

  const label = cleanLabel(input.label);
  await assertServiceBelongs(ctx.organizationId, input.serviceId);
  const existing = await listDefinitions(ctx.organizationId, { entityType: input.entityType, includeInactive: true });
  if (existing.length >= MAX_DEFINITIONS_PER_ENTITY) {
    throw new ValidationError(`An organisation can define at most ${MAX_DEFINITIONS_PER_ENTITY} fields per record type.`);
  }
  if (existing.some((d) => d.key === input.key)) {
    throw new ValidationError("A field with this key already exists.", [{ path: "key", message: "Pick a different key.", code: "DUPLICATE_KEY" }]);
  }

  const created = await createDefinition({
    organizationId: ctx.organizationId,
    entityType: input.entityType,
    section,
    key: input.key,
    label,
    fieldType,
    options: input.options as Prisma.InputJsonValue | undefined,
    helpText: input.helpText?.trim() || null,
    required: input.required ?? false,
    requiredOnQualify: input.requiredOnQualify ?? false,
    serviceId: input.serviceId ?? null,
    sortOrder: input.sortOrder ?? (existing.length + 1) * 10,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "custom_field.created",
    entityType: "CustomFieldDefinition",
    entityId: created.id,
    newValue: { entityType: created.entityType, key: created.key, label: created.label, fieldType: created.fieldType, section: created.section },
  });
  return created;
}

export interface DefinitionPatch {
  label?: string;
  options?: { value: string; label: string }[];
  helpText?: string | null;
  required?: boolean;
  requiredOnQualify?: boolean;
  serviceId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Editing a definition: the key and the type are fixed once created (values of that type exist); retire a field with `isActive: false` instead of deleting it. */
export async function updateCustomFieldDefinition(ctx: AuthContext, id: string, patch: DefinitionPatch) {
  requirePermission(ctx, "customfields.manage");
  const def = await getDefinition(ctx.organizationId, id);
  if (!def) throw new NotFoundError("CustomFieldDefinition", id);

  const issues: ValidationIssue[] = [];
  if (patch.options !== undefined) issues.push(...validateDefinitionOptions(def.fieldType, patch.options));
  if (patch.options !== undefined && def.fieldType !== "SELECT" && def.fieldType !== "MULTISELECT") {
    issues.push({ path: "options", message: "Only choice fields have options." });
  }
  if (def.section === "GENERAL" && (patch.serviceId || patch.requiredOnQualify)) {
    issues.push({ path: "section", message: "Only a qualification question can be tied to a service or required before qualifying." });
  }
  if (issues.length > 0) throw new ValidationError("This change is not valid.", issues);
  if (patch.serviceId) await assertServiceBelongs(ctx.organizationId, patch.serviceId);

  const data: Prisma.CustomFieldDefinitionUncheckedUpdateInput = {};
  if (patch.label !== undefined) data.label = cleanLabel(patch.label);
  if (patch.options !== undefined) data.options = patch.options as Prisma.InputJsonValue;
  if (patch.helpText !== undefined) data.helpText = patch.helpText?.trim() || null;
  if (patch.required !== undefined) data.required = patch.required;
  if (patch.requiredOnQualify !== undefined) data.requiredOnQualify = patch.requiredOnQualify;
  if (patch.serviceId !== undefined) data.serviceId = patch.serviceId;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const updated = await updateDefinition(ctx.organizationId, id, data);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: patch.isActive === false ? "custom_field.deactivated" : patch.isActive === true ? "custom_field.reactivated" : "custom_field.updated",
    entityType: "CustomFieldDefinition",
    entityId: id,
    previousValue: { label: def.label, required: def.required, requiredOnQualify: def.requiredOnQualify, serviceId: def.serviceId, isActive: def.isActive },
    newValue: { label: updated.label, required: updated.required, requiredOnQualify: updated.requiredOnQualify, serviceId: updated.serviceId, isActive: updated.isActive },
  });
  return updated;
}

/** How many records hold a value for this field: shown before retiring it. */
export async function countFieldUsage(ctx: AuthContext, id: string) {
  requirePermission(ctx, "customfields.manage");
  const def = await getDefinition(ctx.organizationId, id);
  if (!def) throw new NotFoundError("CustomFieldDefinition", id);
  return { records: await countRecordsWithValue(ctx.organizationId, def.entityType, def.section, def.key) };
}

export interface WriteResult {
  values: Record<string, unknown>;
  changes: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Validates the general custom fields of a record being created or updated.
 * On create every required field must have a value; on update only the fields
 * in the payload are checked (an older record is never blocked from an edit
 * because a field was made required after it was created, but a required
 * field cannot be cleared).
 */
export async function prepareCustomFields(
  organizationId: string,
  entityType: CustomFieldEntity,
  input: { existing?: Record<string, unknown> | null; incoming: Record<string, unknown> | undefined; mode: "create" | "update" },
): Promise<WriteResult | null> {
  if (input.incoming === undefined && input.mode === "update") return null;
  const rows = await loadActiveDefinitions(organizationId, entityType, "GENERAL");
  const defs = rows.map(toFieldDefinition);
  const incoming = input.incoming ?? {};
  const result = applyValues(defs, incoming, { existing: input.existing, unknownKeys: "reject" });
  const issues = [...result.issues];
  if (input.mode === "create") {
    issues.push(...missingRequired(defs, result.values, "save"));
  } else {
    const touched = defs.filter((d) => d.key in incoming);
    issues.push(...missingRequired(touched, result.values, "save"));
  }
  if (issues.length > 0) throw new ValidationError("Some custom fields are not valid.", issues);
  return { values: result.values, changes: result.changes };
}

/** Records the change of custom field values on a record's history. */
export async function auditCustomFieldChanges(
  ctx: AuthContext,
  entityType: "Lead" | "Contact" | "Company" | "Deal",
  entityId: string,
  changes: Record<string, { before: unknown; after: unknown }>,
  action = `${entityType.toLowerCase()}.custom_fields_updated`,
) {
  const keys = Object.keys(changes);
  if (keys.length === 0) return;
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action,
    entityType,
    entityId,
    previousValue: Object.fromEntries(keys.map((k) => [k, changes[k]!.before])) as Prisma.InputJsonValue,
    newValue: Object.fromEntries(keys.map((k) => [k, changes[k]!.after])) as Prisma.InputJsonValue,
  });
}

/**
 * Turns `customField[key]=value` list filters into a Prisma JSON filter,
 * checking each key against the definitions so a filter on an unknown or
 * retired field is a clear 400 rather than a silent empty list.
 */
export async function buildCustomFieldWhere(
  organizationId: string,
  entityType: CustomFieldEntity,
  filters: Record<string, string> | undefined,
): Promise<JsonClause[] | undefined> {
  if (!filters || Object.keys(filters).length === 0) return undefined;
  const defs = await loadActiveDefinitions(organizationId, entityType, "GENERAL");
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const issues: ValidationIssue[] = [];
  const clauses: JsonClause[] = [];
  for (const [key, raw] of Object.entries(filters)) {
    const def = byKey.get(key);
    if (!def) {
      issues.push({ path: `customField.${key}`, message: `"${key}" is not a filterable field.` });
      continue;
    }
    const value = filterValueFor(toFieldDefinition(def), raw);
    if (value === null) {
      issues.push({ path: `customField.${key}`, message: `"${raw}" is not a valid ${def.fieldType.toLowerCase()} value.` });
      continue;
    }
    clauses.push(
      def.fieldType === "MULTISELECT"
        ? { path: [key], array_contains: value }
        : { path: [key], equals: value },
    );
  }
  if (issues.length > 0) throw new ValidationError("Some custom field filters are not valid.", issues);
  return clauses;
}
