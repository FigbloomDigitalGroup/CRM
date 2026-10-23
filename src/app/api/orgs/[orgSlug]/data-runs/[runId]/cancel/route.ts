import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelRun } from "@/services/dataRunService";

// Stops a running import or export at its next check; rows already imported stay (FIG-1034).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; runId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, runId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return cancelRun(ctx, runId);
  });
}
