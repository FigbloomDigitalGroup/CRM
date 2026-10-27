import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMyMetricsV2 } from "@/services/reportsV2Service";

const QuerySchema = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });

// My metrics (design R2, FIG-1055): the caller's own figures only, as cards and the same numbers as a table.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getMyMetricsV2(ctx, query);
  });
}
