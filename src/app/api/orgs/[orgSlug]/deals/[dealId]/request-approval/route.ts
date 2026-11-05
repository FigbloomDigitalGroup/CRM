import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { requestDealMoveApproval } from "@/services/approvalService";

const RequestSchema = z.strictObject({
  /** The won stage the deal is waiting to move to. */
  pipelineStageId: z.string({ error: "pipelineStageId is required." }),
  note: z.string().optional(),
});

// Asks the approvers to let a deal above the large-deal limit be marked won (FIG-1145, B6.13). The move is made after approval.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RequestSchema);
    return withIdempotency(ctx, request, body, () => requestDealMoveApproval(ctx, dealId, body));
  });
}
