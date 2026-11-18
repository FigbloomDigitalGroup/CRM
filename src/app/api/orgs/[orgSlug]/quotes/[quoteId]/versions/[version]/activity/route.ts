import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { getQuoteActivity } from "@/services/quoteDocumentService";

// The share links of a version and what happened to them: sent, viewed, revoked (FIG-1144, B6.12). Tokens are never returned.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await requireFeature(ctx.organizationId, "quotes.enabled"); // release gate first: before the version param and the body are checked
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    return getQuoteActivity(ctx, quoteId, n);
  });
}
