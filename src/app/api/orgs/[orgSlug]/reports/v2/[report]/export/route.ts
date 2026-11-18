import { z } from "zod";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportReportCsv } from "@/services/reportsV2Service";

const QuerySchema = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });

// The CSV of one report: the same table, under the bulk-export rule, audited.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; report: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug, report } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    const csv = await exportReportCsv(ctx, report, query);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report.toLowerCase()}.csv"` } });
  });
}
