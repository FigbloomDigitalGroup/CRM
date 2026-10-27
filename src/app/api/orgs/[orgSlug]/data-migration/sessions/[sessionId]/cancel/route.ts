import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelMigration } from "@/services/migrationService";

// Stops a waiting or running migration at the next chunk. Rows already written stay and can be rolled back.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return cancelMigration(ctx, sessionId);
  });
}
