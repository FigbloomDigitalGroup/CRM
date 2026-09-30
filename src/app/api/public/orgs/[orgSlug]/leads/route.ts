import { getClientIp, getRequestOrigin } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { WEBSITE_API_KEY_HEADER } from "@/auth/websiteApiKey";
import { submitWebsiteLead } from "@/services/websiteLeadService";

/**
 * FIG-442's public, session-less website lead-capture endpoint -- kept in a
 * separate namespace from `/api/orgs/[orgSlug]/**` (which always assumes a
 * resolved membership session via `resolveRequestContext`) so the two trust
 * boundaries can never accidentally share authorization logic.
 * Authenticated by a per-organization API key (see src/auth/websiteApiKey.ts),
 * sent as the `x-figbloom-api-key` header. Rate limiting, payload/field
 * caps, and optional honeypot/captcha/allowed-origins are FIG-594, all
 * enforced inside `submitWebsiteLead` -- this route only gathers the raw
 * request details that check needs (body text, not yet JSON-parsed, so an
 * oversized payload can be rejected before parsing it; IP; Origin).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const apiKey = request.headers.get(WEBSITE_API_KEY_HEADER);
    const rawBodyText = await request.text();

    const result = await submitWebsiteLead(orgSlug, apiKey, rawBodyText, {
      ipAddress: getClientIp(request),
      origin: getRequestOrigin(request),
    });

    return result ? { status: "created", ...result } : { status: "created" };
  });
}
