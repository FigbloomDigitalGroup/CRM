import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateProposalReferenceStatus } from "@/services/proposalService";

const UpdateProposalStatusSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"]),
});

type RouteParams = {
  params: Promise<{ orgSlug: string; dealId: string; proposalId: string }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId, proposalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateProposalStatusSchema);
    return updateProposalReferenceStatus(ctx, dealId, proposalId, body.status);
  });
}
