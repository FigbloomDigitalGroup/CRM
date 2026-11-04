import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getBoard } from "@/services/dealRuleService";

const BoardQuerySchema = z.object({
  ownerMembershipId: z.string().optional(),
  companyId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  /** One pipeline (B6.15); the default pipeline when left out. */
  pipelineId: z.string().optional(),
});

// Column counts and values for the deals board (FIG-1035, B2.06). Values are left out
// entirely for roles that may not see them; counts are always there.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, BoardQuerySchema);
    return getBoard(ctx, {
      ownerMembershipId: query.ownerMembershipId,
      companyId: query.companyId,
      includeArchived: query.includeArchived === "true",
    }, query.pipelineId);
  });
}
