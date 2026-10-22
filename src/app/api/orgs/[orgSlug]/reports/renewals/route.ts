import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getUpcomingRenewals } from "@/services/customerReportService";

// Upcoming renewals / service end dates (FIG-793, feeds B3.09).
const QuerySchema = z.object({
  withinDays: z.string().regex(/^\d+$/, "withinDays must be a whole number.").optional(),
  ...pageQueryShape,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getUpcomingRenewals(
      ctx,
      { withinDays: query.withinDays ? Number(query.withinDays) : undefined },
      toPageRequest(query),
    );
  });
}
