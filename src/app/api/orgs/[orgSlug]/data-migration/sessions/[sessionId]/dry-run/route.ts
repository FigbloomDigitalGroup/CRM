import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { startMigrationDryRun } from "@/services/migrationService";

// Step 5 (dry run): decides what the import would create, update and skip, and samples it. Writes nothing.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return startMigrationDryRun(ctx, sessionId);
  });
}
