import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { toPageRequest } from "@/app/api/_lib/pageQuery";
import { TeamMembersQuerySchema } from "@/api/dto/team";
import { resolveRequestContext } from "@/auth/requestContext";
import { listTeamMembers } from "@/services/teamService";

// The team's members with per-person counts, filterable, sortable and paged (P2-15). Management only.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, TeamMembersQuerySchema);
    return listTeamMembers(ctx, query, toPageRequest(query));
  });
}
