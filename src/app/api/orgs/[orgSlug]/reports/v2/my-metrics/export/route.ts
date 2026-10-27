import { z } from "zod";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportReportCsv } from "@/services/reportsV2Service";

const QuerySchema = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    const csv = await exportReportCsv(ctx, "MY_METRICS", query);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="my-metrics.csv"' } });
  });
}
