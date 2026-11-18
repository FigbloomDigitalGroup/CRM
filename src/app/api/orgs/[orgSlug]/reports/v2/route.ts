import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getReports } from "@/services/reportsV2Service";

const QuerySchema = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });

// Reports v2 for Management (design R1, FIG-1055): every report as a table, chart series from the same rows, and its definition.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getReports(ctx, query);
  });
}
