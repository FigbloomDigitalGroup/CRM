import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { startMigrationValidation } from "@/services/migrationService";

// Step 4 (validate): reads every row and records per-row errors and warnings. Runs as a background job; poll the session.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return startMigrationValidation(ctx, sessionId);
  });
}
