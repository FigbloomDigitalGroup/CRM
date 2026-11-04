import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { decideApproval } from "@/services/approvalService";

const DecisionSchema = z.strictObject({
  approve: z.boolean({ error: "approve is required." }),
  /** Required when rejecting: it is what the requester reads. */
  reason: z.string().optional(),
});

// Approves or rejects a request (FIG-1145, B6.13). Nobody decides their own request. Approving resumes the blocked action
// (sends the quote, makes the move, starts the export, runs the erasure); rejecting needs a reason.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; approvalId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, approvalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return decideApproval(ctx, approvalId, await parseJsonBody(request, DecisionSchema));
  });
}
