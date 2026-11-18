import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { rollbackMigration } from "@/services/migrationService";

// Undoes the whole session within its window. Records changed or relied on since the import are kept, with the reason.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return rollbackMigration(ctx, sessionId);
  });
}
