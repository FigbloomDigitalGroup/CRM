import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { CreateApiTokenBody } from "@/api/publicApi/schemas";
import { resolveRequestContext } from "@/auth/requestContext";
import { createApiToken, listApiTokens } from "@/services/apiTokenService";

// Personal API tokens (FIG-805): a member lists and creates their own; Management sees and revokes everyone's.
// The plain token is in the create response and nowhere else.

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return listApiTokens(await resolveRequestContext(orgSlug));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return createApiToken(ctx, await parseJsonBody(request, CreateApiTokenBody));
  });
}
