import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { fulfilAccessRequest } from "@/services/privacyService";

// Collect everything held about the person into one CSV, complete the request and answer with a short-lived download link.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return fulfilAccessRequest(ctx, requestId);
  });
}
