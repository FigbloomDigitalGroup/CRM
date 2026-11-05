import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { parseVersionParam, QuoteContentSchema } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { getQuoteVersion, updateDraftVersion } from "@/services/quoteService";

// One version with its lines (FIG-1143, B6.11). Prices follow the deal value rule; cost and margin need `deals.margin`.
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
    return getQuoteVersion(ctx, quoteId, n);
  });
}

// Edits a draft version. A version that was submitted or sent answers 400 VERSION_LOCKED: make a new version.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await requireFeature(ctx.organizationId, "quotes.enabled"); // release gate first: before the version param and the body are checked
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    const body = await parseJsonBody(request, QuoteContentSchema);
    return updateDraftVersion(ctx, quoteId, n, body);
  });
}
