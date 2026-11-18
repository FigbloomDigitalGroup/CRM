import { z } from "zod";
import { customFieldFilters, pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { flattenTags } from "@/repositories/tags";
import { buildCustomFieldWhere } from "@/services/customFieldService";
import { listContactDirectory } from "@/services/directoryService";

const flag = z.enum(["true", "false"]).optional();
const QuerySchema = z.object({
  q: z.string().optional(),
  companyId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  /** Only contacts with no company. */
  standalone: flag,
  missingEmail: flag,
  missingPhone: flag,
  /** The archived tab. */
  archived: flag,
  tagId: z.string().max(400).optional(),
  ...pageQueryShape,
});

// The contact list with quality filters and counts for each (design C3, FIG-1056). Archived contacts are hidden unless asked for.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, QuerySchema);
    const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "CONTACT", customFieldFilters(searchParams));
    const page = await listContactDirectory(
      ctx,
      {
        query: query.q,
        companyId: query.companyId,
        ownerMembershipId: query.ownerMembershipId,
        standalone: query.standalone === "true",
        missingEmail: query.missingEmail === "true",
        missingPhone: query.missingPhone === "true",
        archived: query.archived === "true",
        tagIds: query.tagId ? query.tagId.split(",").filter(Boolean) : undefined,
        customFieldClauses,
      },
      toPageRequest(query),
    );
    return { ...page, items: page.items.map(flattenTags) };
  });
}
