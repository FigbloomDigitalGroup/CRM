import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createNewVersion } from "@/services/quoteService";

const NewVersionSchema = z.strictObject({
  /** Take the current catalogue prices for catalogue lines instead of the frozen ones. */
  refreshPrices: z.boolean().optional(),
});

// Starts the next draft from the latest version; earlier versions never change (FIG-1143, B6.11).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const text = await request.clone().text();
    const body = text.trim() === "" ? {} : await parseJsonBody(request, NewVersionSchema);
    return withIdempotency(ctx, request, body, () => createNewVersion(ctx, quoteId, body));
  });
}
