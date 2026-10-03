import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { exportReportsCsv } from "@/services/exportService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const csv = await exportReportsCsv(ctx, {
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      leadSourceId: searchParams.get("leadSourceId") ?? undefined,
      pipelineStageId: searchParams.get("pipelineStageId") ?? undefined,
      serviceId: searchParams.get("serviceId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="reports.csv"',
      },
    });
  });
}
