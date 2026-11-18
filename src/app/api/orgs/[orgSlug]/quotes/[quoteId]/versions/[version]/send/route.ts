import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";
import { withIdempotency } from "@/lib/idempotency";
import { sendQuote } from "@/services/quoteDocumentService";

const SendSchema = z.strictObject({
  to: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  /** An email template (FIG-797) to start the subject and body from. */
  templateId: z.string().optional(),
  linkExpiresInDays: z.number().int().optional(),
  /** FIG-1189: the language of the document, the email and the signing page (en or sw). */
  language: z.string().optional(),
  /** FIG-1186: also create an online signing link (V2). */
  allowSigning: z.boolean().optional(),
});

// Emails the quote with a secure link and locks the version (FIG-1144, B6.12). The link is in the response once; only its hash is kept.
// A discount above the approval limit answers 400 APPROVAL_REQUIRED until it is approved (B6.13).
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
    const body = text.trim() === "" ? {} : await parseJsonBody(request, SendSchema);
    return withIdempotency(ctx, request, body, () => sendQuote(ctx, quoteId, n, body));
  });
}
