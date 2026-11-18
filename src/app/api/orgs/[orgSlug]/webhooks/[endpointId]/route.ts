import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { UpdateWebhookBody } from "@/api/publicApi/schemas";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteWebhookEndpoint, getWebhookEndpoint, updateWebhookEndpoint } from "@/services/webhookService";

type RouteParams = { params: Promise<{ orgSlug: string; endpointId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    return getWebhookEndpoint(await resolveRequestContext(orgSlug), endpointId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateWebhookEndpoint(ctx, endpointId, await parseJsonBody(request, UpdateWebhookBody));
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, endpointId } = await params;
    return deleteWebhookEndpoint(await resolveRequestContext(orgSlug), endpointId);
  });
}
