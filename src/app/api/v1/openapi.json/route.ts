import { NextResponse } from "next/server";
import { buildPublicApiDocument } from "@/api/publicApi/openapi";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { authenticateApiToken, bearerTokenFrom } from "@/auth/apiToken";
import { resolveMemberUserContext } from "@/auth/requestContext";

/**
 * The OpenAPI document of the public API (FIG-805), served to authenticated users: a token holder (any scope) or a person signed in to
 * the application. Nobody anonymous reads it.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    if (bearerTokenFrom(request)) await authenticateApiToken(request, "", { skipScope: true });
    else await resolveMemberUserContext();
    return NextResponse.json(buildPublicApiDocument());
  });
}
