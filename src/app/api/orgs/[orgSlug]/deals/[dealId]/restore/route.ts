import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { restoreDeal } from "@/services/dealService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return restoreDeal(ctx, dealId);
  });
}
