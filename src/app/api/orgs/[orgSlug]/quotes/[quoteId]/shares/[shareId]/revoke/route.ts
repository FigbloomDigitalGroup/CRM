import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { revokeQuoteShare } from "@/services/quoteDocumentService";

// Stops a share link working at once (FIG-1144, B6.12).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; shareId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, shareId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return revokeQuoteShare(ctx, quoteId, shareId);
  });
}
