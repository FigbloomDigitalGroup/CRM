import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { removeMyPushSubscription } from "@/services/pushService";

// Stop sending push to one of the caller's own devices. Someone else's device answers 404.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; subscriptionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, subscriptionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return removeMyPushSubscription(ctx, subscriptionId);
  });
}
