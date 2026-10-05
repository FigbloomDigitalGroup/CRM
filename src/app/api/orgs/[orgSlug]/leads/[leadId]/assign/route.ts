import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { assignLead } from "@/services/leadService";

const AssignLeadSchema = z.object({
  ownerMembershipId: requiredString("ownerMembershipId is required to assign a lead."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AssignLeadSchema);
    return assignLead(ctx, leadId, body.ownerMembershipId);
  });
}
