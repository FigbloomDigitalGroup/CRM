import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { TeamRangeQuerySchema } from "@/api/dto/team";
import { resolveRequestContext } from "@/auth/requestContext";
import { getTeamSummary } from "@/services/teamService";

// The Team page's summary strip and workload balance (P2-15). Management only; the service refuses everyone else with the explained 403.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, TeamRangeQuerySchema);
    return getTeamSummary(ctx, query);
  });
}
