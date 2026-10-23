import { handleRoute } from "@/app/api/_lib/handleRoute";
import { JobSchema, toJobDto } from "@/api/dto/jobs";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { retryDeadJob } from "@/services/jobService";

// Back to the queue from the dead-letter list, with a fresh attempt budget.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; jobId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, jobId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(JobSchema, toJobDto(await retryDeadJob(ctx, jobId)));
  });
}
