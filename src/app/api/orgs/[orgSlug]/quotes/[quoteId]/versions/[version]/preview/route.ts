import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { previewQuote } from "@/services/quoteDocumentService";

// The document as the client sees it: `{ source, html, sha256 }` (FIG-1144, B6.12). A sent version returns the stored sent document.
// `?language=sw` previews the Swahili document (FIG-1189). Needs the right to see the deal value; the document never carries cost or margin.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await requireFeature(ctx.organizationId, "quotes.enabled"); // release gate first: before the version param and the body are checked
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    return previewQuote(ctx, quoteId, n, new Date(), new URL(request.url).searchParams.get("language") ?? undefined);
  });
}
