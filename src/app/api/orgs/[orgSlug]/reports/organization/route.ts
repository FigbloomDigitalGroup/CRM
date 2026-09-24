import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getOrganizationMetrics } from "@/services/reportingService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return getOrganizationMetrics(ctx, {
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      leadSourceId: searchParams.get("leadSourceId") ?? undefined,
      pipelineStageId: searchParams.get("pipelineStageId") ?? undefined,
      serviceId: searchParams.get("serviceId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    });
  });
}
