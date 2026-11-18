import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listRuns } from "@/services/dataRunService";

// Imports and exports: your own, or everyone's for Management (FIG-1034).
const QuerySchema = z.object({ kind: z.enum(["IMPORT", "EXPORT"]).optional(), ...pageQueryShape });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listRuns(ctx, { kind: query.kind, paging: toPageRequest(query) });
  });
}
