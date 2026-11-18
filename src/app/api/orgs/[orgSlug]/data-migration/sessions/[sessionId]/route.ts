import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMigrationSession } from "@/services/migrationService";

// One migration session: status, step, counts, progress, the dry run, the rollback window. Poll this while a job runs.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMigrationSession(ctx, sessionId);
  });
}
