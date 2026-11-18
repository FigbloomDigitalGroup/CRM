import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { CreateWebhookBody } from "@/api/publicApi/schemas";
import { resolveRequestContext } from "@/auth/requestContext";
import { createWebhookEndpoint, listWebhookEndpoints } from "@/services/webhookService";

// Outbound webhook endpoints (FIG-804), Management only. The signing secret is in the create response and nowhere else.

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return listWebhookEndpoints(await resolveRequestContext(orgSlug));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return createWebhookEndpoint(ctx, await parseJsonBody(request, CreateWebhookBody));
  });
}
