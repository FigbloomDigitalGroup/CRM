import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateProposalReferenceStatus } from "@/services/proposalService";

type RouteParams = {
  params: Promise<{ orgSlug: string; dealId: string; proposalId: string }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId, proposalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as {
      status: "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
    };
    return updateProposalReferenceStatus(ctx, dealId, proposalId, body.status);
  });
}
