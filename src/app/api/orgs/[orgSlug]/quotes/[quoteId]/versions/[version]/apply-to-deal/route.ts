import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { applyQuoteTotalToDeal } from "@/services/quoteService";

// Copies the version total to the deal value ("Use the quote total"). Needs the right to see and edit the deal value.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    return applyQuoteTotalToDeal(ctx, quoteId, n);
  });
}
