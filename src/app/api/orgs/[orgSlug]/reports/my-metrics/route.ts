import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMyMetrics } from "@/services/reportingService";

/** Personal report figures for roles with `reporting.view.own` (scoped to what the caller may already see). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return getMyMetrics(ctx, {
      leadSourceId: searchParams.get("leadSourceId") ?? undefined,
      pipelineStageId: searchParams.get("pipelineStageId") ?? undefined,
      serviceId: searchParams.get("serviceId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    });
  });
}
