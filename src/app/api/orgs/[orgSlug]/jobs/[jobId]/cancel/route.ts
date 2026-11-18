import { handleRoute } from "@/app/api/_lib/handleRoute";
import { JobSchema, toJobDto } from "@/api/dto/jobs";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelJob } from "@/services/jobService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; jobId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, jobId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(JobSchema, toJobDto(await cancelJob(ctx, jobId)));
  });
}
