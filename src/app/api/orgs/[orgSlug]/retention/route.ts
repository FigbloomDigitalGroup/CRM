import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getRenewalsAndRetention } from "@/services/retentionService";

const QuerySchema = z.object({
  /** LAPSED, DUE_30, UNANSWERED_PROPOSALS, GOING_QUIET or CROSS_SELL: one list, paged. Omit for the first page of each. */
  list: z.string().optional(),
  ...pageQueryShape,
});

// Renewals and retention (design E2): five lists, each customer in exactly one, counts that match the lists (FIG-1052).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getRenewalsAndRetention(ctx, { list: query.list, ...toPageRequest(query) });
  });
}
