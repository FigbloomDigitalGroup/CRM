import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { reorderAssignmentRule } from "@/services/websiteLeadAssignmentRuleService";

const MoveRuleSchema = z.object({
  direction: z.enum(["up", "down"], {
    message: 'direction must be "up" or "down".',
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; ruleId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, ruleId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MoveRuleSchema);
    await reorderAssignmentRule(ctx, ruleId, body.direction);
    return { ok: true };
  });
}
