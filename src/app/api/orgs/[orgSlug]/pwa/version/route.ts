import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPwaVersion } from "@/services/pwaService";

// The cache version an installed app compares with its own: a different number means refresh (FIG-1064, M4).
// Also says what may be queued offline and what the server always decides.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getPwaVersion(ctx);
  });
}
