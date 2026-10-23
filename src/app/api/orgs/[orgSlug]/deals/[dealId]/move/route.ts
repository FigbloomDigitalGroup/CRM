import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { moveDeal } from "@/services/dealRuleService";

const MoveSchema = z.strictObject({
  pipelineStageId: z.string({ error: "pipelineStageId is required." }),
  /** Required when moving to Closed Lost. */
  lostReasonId: z.string().nullable().optional(),
  /** Moving to Closed Won: who in Delivery receives the handoff (B2.08). */
  handoff: z
    .strictObject({
      deliveryOwnerMembershipId: z.string().optional(),
      ownerLater: z.boolean().optional(),
      templateOff: z.boolean().optional(),
      lifecycleOff: z.boolean().optional(),
      startDate: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      requirements: z.string().nullable().optional(),
      deliverables: z.array(z.string()).optional(),
      teamMembershipIds: z.array(z.string()).optional(),
    })
    .optional(),
});

// Moves a deal to another stage after the rules are checked (FIG-1035, B2.06). A blocked move answers 400 with
// a code per reason (for example LOST_REASON_REQUIRED). The response includes a move id for a few minutes of undo.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MoveSchema);
    return moveDeal(ctx, dealId, body);
  });
}
