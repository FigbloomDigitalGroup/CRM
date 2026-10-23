import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { takeHandoff } from "@/services/handoffService";

// Someone in Delivery takes a handoff that is awaiting an owner (FIG-1037, B2.08).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return takeHandoff(ctx, dealId);
  });
}
