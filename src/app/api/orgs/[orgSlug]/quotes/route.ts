import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listQuotesPage } from "@/services/quoteService";

const ListQuerySchema = z.object({
  dealId: z.string().optional(),
  /** DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SENT, ACCEPTED or DECLINED (the latest version). */
  status: z.string().optional(),
  /** UC-R3 (additive): text in the quote number, the customer name or the deal notes. */
  q: z.string().max(100).optional(),
  /** UC-R3: the deal owner (a membership id). */
  owner: z.string().max(64).optional(),
  companyId: z.string().max(64).optional(),
  /** UC-R3: the latest version's validity date range, YYYY-MM-DD, inclusive. */
  validFrom: z.string().max(10).optional(),
  validTo: z.string().max(10).optional(),
  /** UC-R3: "only" is the derived Expired state (sent or approved, past its date); "exclude" is all the others. */
  expired: z.string().max(10).optional(),
  /** UC-R3: also return `statusCounts` (the chips) and, per row, `activity` (links, views, revocations). */
  counts: z.enum(["true", "false"]).optional(),
  activity: z.enum(["true", "false"]).optional(),
  ...pageQueryShape,
});

// Quotes on the deals the caller can open (FIG-1143, B6.11, V1.1), each with its latest version summary.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listQuotesPage(
      ctx,
      {
        dealId: query.dealId,
        status: query.status,
        q: query.q,
        owner: query.owner,
        companyId: query.companyId,
        validFrom: query.validFrom,
        validTo: query.validTo,
        expired: query.expired,
        counts: query.counts === "true",
        activity: query.activity === "true",
      },
      toPageRequest(query),
    );
  });
}
