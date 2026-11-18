import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { retryWebhookDelivery } from "@/services/webhookService";

/** Puts a dead delivery back in the queue for another round of attempts. */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; endpointId: string; deliveryId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, endpointId, deliveryId } = await params;
    return retryWebhookDelivery(await resolveRequestContext(orgSlug), endpointId, deliveryId);
  });
}
