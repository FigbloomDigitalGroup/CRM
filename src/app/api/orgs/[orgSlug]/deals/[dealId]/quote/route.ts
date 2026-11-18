import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { Money, QuoteLineSchema } from "@/app/api/_lib/quoteSchemas";
import { withIdempotency } from "@/lib/idempotency";
import { createQuote, getQuoteForDeal } from "@/services/quoteService";


const CreateQuoteSchema = z.strictObject({
  lines: z.array(QuoteLineSchema).optional(),
  discountPercent: Money.optional(),
  validUntil: z.string().optional(),
  terms: z.string().nullable().optional(),
  currency: z.string().optional(),
});

// The deal's quote with its versions (FIG-1143, B6.11, V1.1). Prices and totals follow the deal value rule; cost and margin need `deals.margin`.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getQuoteForDeal(ctx, dealId);
  });
}

// Makes the quote with its first draft version. One quote per deal.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateQuoteSchema);
    return withIdempotency(ctx, request, body, () => createQuote(ctx, dealId, body));
  });
}
