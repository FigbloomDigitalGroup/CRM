import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getRun } from "@/services/dataRunService";

// Progress, counts and state of one import or export (FIG-1034).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; runId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, runId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getRun(ctx, runId);
  });
}
