import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { checkDealMove } from "@/services/dealRuleService";

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

// What would block this move and what the Move to dialog must ask for (lost reason, handoff). Changes nothing.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MoveSchema);
    return checkDealMove(ctx, dealId, body);
  });
}
