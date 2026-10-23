import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { undoDealMove } from "@/services/dealRuleService";

// Puts a deal back where it was, for a few minutes after the move. A move to Closed Won cannot be undone here.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; moveId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, moveId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return undoDealMove(ctx, moveId);
  });
}
