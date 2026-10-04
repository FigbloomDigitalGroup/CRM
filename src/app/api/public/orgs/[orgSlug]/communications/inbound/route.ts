import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import {
  INBOUND_EMAIL_KEY_HEADER,
  INBOUND_EMAIL_KEY_QUERY_PARAM,
} from "@/auth/inboundEmailKey";
import { ingestInboundEmail } from "@/services/inboundEmailService";

/**
 * FIG-598's inbound-email webhook -- the "BCC-to-CRM" half of "mailbox sync
 * or BCC-to-CRM." Separate public namespace from `/api/orgs/[orgSlug]/**`,
 * same reason as the website lead-capture endpoint: no session, a
 * different trust boundary, authenticated by its own per-organization
 * token (`src/auth/inboundEmailKey.ts`) rather than the website one.
 *
 * Accepts a provider-agnostic `{from, subject?, text?, messageId?}` body --
 * wiring a real inbound-email provider (Postmark/Mailgun/SendGrid inbound
 * parse) means configuring that provider's webhook to POST here (with the
 * token in the URL) and, if its payload shape differs, adapting it to this
 * shape first. No such provider account exists for this project -- see
 * `docs/DEPLOYMENT.md`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const { searchParams } = new URL(request.url);
    const token =
      request.headers.get(INBOUND_EMAIL_KEY_HEADER) ??
      searchParams.get(INBOUND_EMAIL_KEY_QUERY_PARAM);

    const body = await request.json().catch(() => {
      throw new ValidationError("Request body must be valid JSON.");
    });
    if (typeof body !== "object" || body === null) {
      throw new ValidationError("Request body must be a JSON object.");
    }
    const { from, subject, text, messageId } = body as Record<string, unknown>;

    const result = await ingestInboundEmail(orgSlug, token, {
      from: typeof from === "string" ? from : "",
      subject: typeof subject === "string" ? subject : undefined,
      text: typeof text === "string" ? text : undefined,
      messageId: typeof messageId === "string" ? messageId : undefined,
    });

    return result;
  });
}
