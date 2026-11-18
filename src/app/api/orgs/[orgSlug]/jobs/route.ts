import { handleRoute } from "@/app/api/_lib/handleRoute";
import { toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { ListJobsQuerySchema, ListJobsResponseSchema, toJobDto } from "@/api/dto/jobs";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { listJobs } from "@/services/jobService";

// Background job status for Management (FIG-1066, B2.18): this organisation, newest first.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListJobsQuerySchema);
    const page = await listJobs(ctx, { ...toPageRequest(query), status: query.status, type: query.type });
    return respond(ListJobsResponseSchema, { ...page, items: page.items.map(toJobDto) });
  });
}
