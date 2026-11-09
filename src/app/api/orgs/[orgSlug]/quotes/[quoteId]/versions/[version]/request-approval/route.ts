import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { withIdempotency } from "@/lib/idempotency";
import { requestDiscountApproval } from "@/services/approvalService";

const RequestSchema = z.strictObject({
  note: z.string().optional(),
  /** Send the quote to the client by itself once it is approved. */
  sendOnApproval: z
    .strictObject({
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      templateId: z.string().optional(),
      linkExpiresInDays: z.number().int().optional(),
      language: z.string().optional(),
      allowSigning: z.boolean().optional(),
    })
    .optional(),
});

// Locks a draft whose discount is above the limit and asks the approvers (FIG-1145, B6.13). 400 APPROVAL_NOT_NEEDED when it is within the limit.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    await requireFeature(ctx.organizationId, "quotes.enabled"); // release gate first: before the version param and the body are checked
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    const text = await request.clone().text();
    const body = text.trim() === "" ? {} : await parseJsonBody(request, RequestSchema);
    return withIdempotency(ctx, request, body, () => requestDiscountApproval(ctx, quoteId, n, body));
  });
}
