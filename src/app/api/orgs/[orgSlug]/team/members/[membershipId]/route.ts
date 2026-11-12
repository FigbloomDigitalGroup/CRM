import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { TeamRangeQuerySchema } from "@/api/dto/team";
import { resolveRequestContext } from "@/auth/requestContext";
import { getTeamMember } from "@/services/teamService";

// One member's detail for the drawer: recent sales activity, open leads, deals and tasks, 30-day trend (P2-15). Management only.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; membershipId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, TeamRangeQuerySchema);
    return getTeamMember(ctx, membershipId, query);
  });
}
