import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getLead, updateLead } from "@/services/leadService";

type RouteParams = { params: Promise<{ orgSlug: string; leadId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getLead(ctx, leadId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return updateLead(ctx, leadId, body);
  });
}
