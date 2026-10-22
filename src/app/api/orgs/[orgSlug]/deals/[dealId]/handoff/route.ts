import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { findDealHandoff } from "@/repositories/dealHandoffs";
import { getDeal } from "@/services/dealService";

/**
 * The handoff recorded when this deal was won (FIG-792), or `{ handoff: null }`
 * if it has not been won yet. Visibility follows the deal itself: anyone who
 * cannot open the deal gets the same refusal they get from the deal route.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await getDeal(ctx, dealId);
    return { handoff: await findDealHandoff(ctx.organizationId, dealId) };
  });
}
