import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getQuote } from "@/services/quoteService";

// A quote with its version summaries (FIG-1143, B6.11).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getQuote(ctx, quoteId);
  });
}
