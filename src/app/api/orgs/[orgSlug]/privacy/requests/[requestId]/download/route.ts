import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getAccessDownload } from "@/services/privacyService";

// A fresh download link for a completed access request. Audited.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getAccessDownload(ctx, requestId);
  });
}
