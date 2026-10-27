import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPushConfig } from "@/services/pushService";

// Whether Web Push is switched on for this server, and the public key a browser subscribes with (FIG-1064).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    await resolveRequestContext(orgSlug);
    return getPushConfig();
  });
}
