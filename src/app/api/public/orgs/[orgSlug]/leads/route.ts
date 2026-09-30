import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { WEBSITE_API_KEY_HEADER } from "@/auth/websiteApiKey";
import { submitWebsiteLead } from "@/services/websiteLeadService";

/**
 * FIG-442's public, session-less website lead-capture endpoint -- kept in a
 * separate namespace from `/api/orgs/[orgSlug]/**` (which always assumes a
 * resolved membership session via `resolveRequestContext`) so the two trust
 * boundaries can never accidentally share authorization logic.
 * Authenticated by a per-organization API key (see src/auth/websiteApiKey.ts),
 * sent as the `x-figbloom-api-key` header.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const apiKey = request.headers.get(WEBSITE_API_KEY_HEADER);
    const body = await request.json().catch(() => {
      throw new ValidationError("Request body must be valid JSON.");
    });
    const result = await submitWebsiteLead(orgSlug, apiKey, body);
    return { status: "created", ...result };
  });
}
