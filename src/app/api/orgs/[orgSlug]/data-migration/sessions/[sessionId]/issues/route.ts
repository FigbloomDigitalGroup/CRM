import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listMigrationIssues } from "@/services/migrationService";

const QuerySchema = z.object({ phase: z.string().optional(), severity: z.string().optional(), ...pageQueryShape });

// Per-row errors, warnings and duplicates, paged (row, field, message, the existing record a duplicate matched).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listMigrationIssues(ctx, sessionId, { phase: query.phase, severity: query.severity, paging: toPageRequest(query) });
  });
}
