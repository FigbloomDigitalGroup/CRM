import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelRequest } from "@/services/leadPoolService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return cancelRequest(ctx, requestId);
  });
}
