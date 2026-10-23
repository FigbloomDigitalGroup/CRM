import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createCustomFieldDefinition, listCustomFieldDefinitions } from "@/services/customFieldService";

const EntitySchema = z.enum(["LEAD", "CONTACT", "COMPANY", "DEAL"]);
const SectionSchema = z.enum(["GENERAL", "QUALIFICATION"]);
const TypeSchema = z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "MULTISELECT", "BOOLEAN"]);

const ListQuerySchema = z.object({
  entityType: EntitySchema.optional(),
  section: SectionSchema.optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

const CreateSchema = z.strictObject({
  entityType: EntitySchema,
  key: z.string({ error: "key is required." }),
  label: z.string({ error: "label is required." }),
  fieldType: TypeSchema.optional(),
  options: z.array(z.strictObject({ value: z.string(), label: z.string() })).optional(),
  helpText: z.string().max(300).nullish(),
  required: z.boolean().optional(),
  section: SectionSchema.optional(),
  requiredOnQualify: z.boolean().optional(),
  serviceId: z.string().nullish(),
  sortOrder: z.number().int().optional(),
});

// Custom field definitions and per-service qualification questions (FIG-803, FIG-1030).
// Anyone who can open the record type can read its fields; creating them needs customfields.manage.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return {
      items: await listCustomFieldDefinitions(ctx, {
        entityType: query.entityType,
        section: query.section,
        includeInactive: query.includeInactive === "true",
      }),
    };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return createCustomFieldDefinition(ctx, body);
  });
}
