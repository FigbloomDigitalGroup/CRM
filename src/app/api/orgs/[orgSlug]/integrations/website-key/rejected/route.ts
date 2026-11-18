import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listRejectedWebsiteSubmissions } from "@/services/integrationService";

const QuerySchema = z.object({
  /** One reason, for example RATE_LIMITED or ORIGIN_NOT_ALLOWED. */
  outcome: z.string().optional(),
  ...pageQueryShape,
});

// Submissions the website form endpoint turned away, with the reason (FIG-1058, B4.01). Management only.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listRejectedWebsiteSubmissions(ctx, { outcome: query.outcome, paging: toPageRequest(query) });
  });
}
