import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { globalSearch } from "@/services/searchService";

const SearchQuerySchema = z.object({
  q: z.string().optional(),
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
    return globalSearch(ctx, query.q ?? "");
  });
}
