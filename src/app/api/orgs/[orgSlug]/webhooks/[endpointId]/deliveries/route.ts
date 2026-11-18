import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listWebhookDeliveries } from "@/services/webhookService";

/** The delivery log of one endpoint: what was sent, when, the answer and the next retry. Newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string; endpointId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const sp = new URL(request.url).searchParams;
    const limit = sp.get("limit");
    return listWebhookDeliveries(ctx, endpointId, { status: sp.get("status") ?? undefined, limit: limit && /^\d+$/.test(limit) ? Number(limit) : undefined });
  });
}
