import { z } from "zod";
import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportCustomerReportsCsv } from "@/services/exportService";

// CSV of the three customer reports (FIG-793), same rules as the screens.
const QuerySchema = z.object({
  dormantAfterDays: z.string().regex(/^\d+$/, "dormantAfterDays must be a whole number.").optional(),
  withinDays: z.string().regex(/^\d+$/, "withinDays must be a whole number.").optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  period: z.enum(["total", "month"]).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    const csv = await exportCustomerReportsCsv(ctx, {
      dormantAfterDays: q.dormantAfterDays ? Number(q.dormantAfterDays) : undefined,
      withinDays: q.withinDays ? Number(q.withinDays) : undefined,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      period: q.period,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="customer-reports.csv"',
      },
    });
  });
}
