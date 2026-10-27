import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getReport } from "@/services/reportsV2Service";

const QuerySchema = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });

// One report: LEAD_SOURCES, CONVERSION_BY_SOURCE, CONVERSION_BY_STAGE, PIPELINE_BY_STAGE, LOST_REASONS, PER_PERSON, MONTH_VS_LAST, CUSTOMERS or RENEWALS.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; report: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, report } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getReport(ctx, report, query);
  });
}
