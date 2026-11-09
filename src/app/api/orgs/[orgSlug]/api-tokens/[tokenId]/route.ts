import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { revokeApiToken } from "@/services/apiTokenService";

type RouteParams = { params: Promise<{ orgSlug: string; tokenId: string }> };

/** Revokes a token (the owner's own, or any for Management). It stops working at once. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, tokenId } = await params;
    return revokeApiToken(await resolveRequestContext(orgSlug), tokenId);
  });
}
