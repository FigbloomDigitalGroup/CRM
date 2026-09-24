import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { assignLead } from "@/services/leadService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as { ownerMembershipId: string };
    return assignLead(ctx, leadId, body.ownerMembershipId);
  });
}
