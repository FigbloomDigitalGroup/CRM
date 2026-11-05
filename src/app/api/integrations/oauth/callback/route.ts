import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { completeConnection, organizationSlugForState } from "@/services/oauthConnectionService";

// Where Google and Microsoft send the person back (FIG-1153). The one fixed redirect address registered with the providers: the
// organisation is found from the one-time `state`, the session must be the one that started the connection, then the person
// lands back on Settings. A refusal is the usual error envelope.
export async function GET(request: Request) {
  return handleRoute(async () => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const slug = await organizationSlugForState(state);
    // An unknown or used state and a provider-side denial both go through the same refusal inside the service.
    const ctx = await resolveRequestContext(slug ?? "unknown");
    if (url.searchParams.get("error")) {
      return NextResponse.redirect(new URL(`/o/${slug}/settings?tab=connect&connection=denied`, url.origin));
    }
    await completeConnection(ctx, { state, code });
    return NextResponse.redirect(new URL(`/o/${slug}/settings?tab=connect&connection=connected`, url.origin));
  });
}
