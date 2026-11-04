import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listConnections } from "@/services/oauthConnectionService";

// The signed-in person's email and calendar connections, each CONNECTED, NEEDS_RECONNECT or DISCONNECTED (FIG-1153). Never any token.
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listConnections(ctx);
  });
}
