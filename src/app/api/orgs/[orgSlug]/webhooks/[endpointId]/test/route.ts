import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { sendWebhookTest } from "@/services/webhookService";

/** Queues a signed `webhook.ping` to the endpoint so the receiver and its signature check can be tried. */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; endpointId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    return sendWebhookTest(await resolveRequestContext(orgSlug), endpointId);
  });
}
