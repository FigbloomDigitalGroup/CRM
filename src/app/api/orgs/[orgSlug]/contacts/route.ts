import { flattenTags } from "@/repositories/tags";
import { customFieldFilters } from "@/app/api/_lib/pageQuery";
import { buildCustomFieldWhere } from "@/services/customFieldService";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createContact, listContactsPage } from "@/services/contactService";

const ListContactsQuerySchema = z.object({
  /** Records carrying any of these tags (comma-separated tag ids). */
  tagId: z.string().max(400).optional(),
  q: z.string().optional(),
  companyId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  /** The archived tab: only archived records. */
  archivedOnly: z.enum(["true", "false"]).optional(),
  ...pageQueryShape,
});

const CreateContactSchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  firstName: requiredString("firstName is required."),
  lastName: z.string().optional(),
  companyId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
  ownerMembershipId: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "CONTACT", customFieldFilters(searchParams));
    const query = parseQueryParams(searchParams, ListContactsQuerySchema);
    const page = await listContactsPage(
      ctx,
      {
        query: query.q,
        companyId: query.companyId,
        ownerMembershipId: query.ownerMembershipId,
        includeArchived: query.includeArchived === "true",
        archivedOnly: query.archivedOnly === "true",
        customFieldClauses,
        tagIds: query.tagId ? query.tagId.split(",").filter(Boolean) : undefined,
      },
      toPageRequest(query),
    );
    return { ...page, items: page.items.map(flattenTags) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateContactSchema);
    return createContact(ctx, body);
  });
}
