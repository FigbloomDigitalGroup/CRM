import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { rotateWebhookSecret } from "@/services/webhookService";

/** A new signing secret, shown once. The old secret stops working at once. */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; endpointId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    return rotateWebhookSecret(await resolveRequestContext(orgSlug), endpointId);
  });
}
