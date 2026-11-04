import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listQuotesPage } from "@/services/quoteService";

const ListQuerySchema = z.object({
  dealId: z.string().optional(),
  /** DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SENT, ACCEPTED or DECLINED (the latest version). */
  status: z.string().optional(),
  ...pageQueryShape,
});

// Quotes on the deals the caller can open (FIG-1143, B6.11, V1.1), each with its latest version summary.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listQuotesPage(ctx, { dealId: query.dealId, status: query.status }, toPageRequest(query));
  });
}
