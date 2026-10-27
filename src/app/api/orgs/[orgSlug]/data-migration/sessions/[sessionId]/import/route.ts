import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { startMigrationImport } from "@/services/migrationService";

const ImportSchema = z.strictObject({ confirm: z.boolean().optional() });

// Step 6 (import): needs a finished dry run and `confirm: true`. Runs as a background job; every row created carries the session id.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ImportSchema);
    return withIdempotency(ctx, request, { sessionId, ...body }, () => startMigrationImport(ctx, sessionId, body));
  });
}
