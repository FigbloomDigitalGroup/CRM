import { z } from "zod";
import { customFieldFilters, pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { flattenTags } from "@/repositories/tags";
import { buildCustomFieldWhere } from "@/services/customFieldService";
import { listCompanyDirectory } from "@/services/directoryService";

const QuerySchema = z.object({
  /** ALL (archived hidden), DORMANT or ARCHIVED. */
  tab: z.string().optional(),
  q: z.string().optional(),
  /** A lifecycle state key (ACTIVE_CUSTOMER) or id. */
  lifecycle: z.string().optional(),
  serviceId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  /** Comma-separated tag ids. */
  tagId: z.string().max(400).optional(),
  ...pageQueryShape,
});

// The company list with tabs and counts (design C1, FIG-1056). Each tab's count is what that tab would list.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, QuerySchema);
    const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "COMPANY", customFieldFilters(searchParams));
    const page = await listCompanyDirectory(
      ctx,
      { tab: query.tab, query: query.q, lifecycle: query.lifecycle, serviceId: query.serviceId, ownerMembershipId: query.ownerMembershipId, tagIds: query.tagId ? query.tagId.split(",").filter(Boolean) : undefined, customFieldClauses },
      toPageRequest(query),
    );
    return { ...page, items: page.items.map(flattenTags) };
  });
}
