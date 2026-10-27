import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSyncStatus } from "@/services/syncService";

// The caller's own queue as the server sees it: last sync, the last seven days, and what needs their attention (FIG-1064).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getSyncStatus(ctx);
  });
}
