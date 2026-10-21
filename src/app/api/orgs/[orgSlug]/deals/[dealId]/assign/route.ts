import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { assignDeal } from "@/services/dealService";

const AssignDealSchema = z.object({
  ownerMembershipId: requiredString("ownerMembershipId is required to assign a deal."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AssignDealSchema);
    return assignDeal(ctx, dealId, body.ownerMembershipId);
  });
}
