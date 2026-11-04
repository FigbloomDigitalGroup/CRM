import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { sendQuote } from "@/services/quoteDocumentService";

const SendSchema = z.strictObject({
  to: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  /** An email template (FIG-797) to start the subject and body from. */
  templateId: z.string().optional(),
  linkExpiresInDays: z.number().int().optional(),
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
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    const text = await request.clone().text();
    const body = text.trim() === "" ? {} : await parseJsonBody(request, SendSchema);
    return withIdempotency(ctx, request, body, () => sendQuote(ctx, quoteId, n, body));
  });
}
