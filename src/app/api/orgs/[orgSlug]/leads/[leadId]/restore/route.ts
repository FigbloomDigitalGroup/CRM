import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { restoreLead } from "@/services/leadService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return restoreLead(ctx, leadId);
  });
}
