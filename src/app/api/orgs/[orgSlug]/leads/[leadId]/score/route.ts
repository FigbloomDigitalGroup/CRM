import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ScoreViewSchema } from "@/api/dto/common";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { getLeadScore } from "@/services/scoreService";

// The lead score and why: signed points per factor (FIG-1032, B2.03). It only informs; it never moves anything.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(ScoreViewSchema, await getLeadScore(ctx, leadId));
  });
}
