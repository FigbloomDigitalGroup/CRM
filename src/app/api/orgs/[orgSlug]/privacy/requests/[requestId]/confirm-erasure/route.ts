import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { confirmErasure } from "@/services/privacyService";

// Two different Management members confirm: the first parks the request, the second erases. A legal hold stops it.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return confirmErasure(ctx, requestId);
  });
}
