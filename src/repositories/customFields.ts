import type { CustomFieldEntity, CustomFieldSection, CustomFieldType, Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `custom_field_definitions` (FIG-803, FIG-1030). Every call runs inside the organisation's RLS context. */

export interface ListDefinitionsFilter {
  entityType?: CustomFieldEntity;
  section?: CustomFieldSection;
  includeInactive?: boolean;
}

export function listDefinitions(organizationId: string, filter: ListDefinitionsFilter = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.customFieldDefinition.findMany({
      where: {
        organizationId,
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.section ? { section: filter.section } : {}),
        ...(filter.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ entityType: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
  );
}

export function getDefinition(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.customFieldDefinition.findFirst({ where: { id, organizationId } }),
  );
}

export interface CreateDefinitionInput {
  organizationId: string;
  entityType: CustomFieldEntity;
  section: CustomFieldSection;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: Prisma.InputJsonValue;
  helpText?: string | null;
  required: boolean;
  requiredOnQualify: boolean;
  serviceId?: string | null;
  sortOrder?: number;
}

export function createDefinition(input: CreateDefinitionInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.customFieldDefinition.create({
      data: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        section: input.section,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        options: input.options,
        helpText: input.helpText,
        required: input.required,
        requiredOnQualify: input.requiredOnQualify,
        serviceId: input.serviceId,
        sortOrder: input.sortOrder,
      },
    }),
  );
}

export function updateDefinition(organizationId: string, id: string, data: Prisma.CustomFieldDefinitionUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) =>
    tx.customFieldDefinition.update({ where: { id, organizationId }, data }),
  );
}

/** Whether any record of the entity holds a value for this key (so a type change is refused). */
export function countRecordsWithValue(organizationId: string, entityType: CustomFieldEntity, section: CustomFieldSection, key: string) {
  return withOrgContext(organizationId, async (tx) => {
    const path = section === "QUALIFICATION" ? "qualification_data" : "custom_fields";
    const table = { LEAD: "leads", CONTACT: "contacts", COMPANY: "companies", DEAL: "deals" }[entityType];
    // Table and column names come from the fixed maps above, never from input; the key is a bound parameter.
    const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${table}" WHERE organization_id = $1 AND jsonb_typeof("${path}") = 'object' AND "${path}" ? $2`,
      organizationId,
      key,
    );
    return Number(rows[0]?.n ?? 0);
  });
}
