import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getOrganisationExportDownload } from "@/services/platformDataRequestService";

/**
 * A short-lived signed link to the organisation's packaged export (B6.09), for its own Management, until the download window ends.
 * Reachable while the organisation is being offboarded.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug, undefined, { allowOffboarding: true });
    return getOrganisationExportDownload(ctx, requestId);
  });
}
