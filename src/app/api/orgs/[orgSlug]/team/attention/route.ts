import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getTeamAttention } from "@/services/teamService";

// What needs attention across the team: quiet leads, overdue tasks, stuck deals (P2-15). Management only.
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getTeamAttention(ctx);
  });
}
