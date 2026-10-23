import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { globalSearch, searchAll, SEARCH_GROUP_TYPES } from "@/services/searchService";

// Global search (FIG-787, v2 in FIG-1041). Results are grouped by type with a total per group and
// paged per group (`type` + `page`); archived records are left out unless `archived=include|only`.
// The old per-type arrays stay in the response for existing callers.
const SearchQuerySchema = z.object({
  q: z.string().optional(),
  type: z.enum(SEARCH_GROUP_TYPES as [string, ...string[]]).optional(),
  archived: z.enum(["exclude", "include", "only"]).optional(),
  ...pageQueryShape,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, SearchQuerySchema);
    const v2 = await searchAll(ctx, {
      q: query.q ?? "",
      type: query.type as never,
      archived: query.archived,
      paging: toPageRequest(query),
    });
    const legacy = await globalSearch(ctx, query.q ?? "");
    return { ...legacy, ...v2 };
  });
}
