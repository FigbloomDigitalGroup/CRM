import { adminDb } from "@/db/adminClient";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { limitInboundEmail } from "@/auth/publicLimits";
import { UnauthorizedError, ValidationError } from "@/auth/errors";
import { resolveInboundBccRecipient } from "@/auth/inboundBccAddress";
import { mapMailgunPayload, mailgunRecipients, verifyMailgunSignature, MAILGUN_MAX_AGE_SECONDS } from "@/integrations/inbound/mailgun";
import { ingestInboundEmailForOrganization } from "@/services/inboundEmailService";

/**
 * FIG-806: the Mailgun route target for the BCC-to-CRM address. Mailgun's "forward" action POSTs the parsed message as a form; this
 * handler verifies Mailgun's signature, refuses a replayed token, finds the organisation from the recipient address and hands the
 * neutral payload to the same ingestion as FIG-598's webhook. No session: the signature is the credential.
 */
const REPLAY_SCOPE = "mailgun-token";

export async function POST(request: Request) {
  return handleRoute(async () => {
    await limitInboundEmail(getClientIp(request), "mailgun");
    const form = await request.formData().catch(() => {
      throw new ValidationError("Request body must be a form.");
    });

    const { token } = verifyMailgunSignature(form);

    // The signature does not cover the body, so a token is accepted once. It is recorded only after success, so Mailgun's retry of a failed delivery still works.
    const since = new Date(Date.now() - 2 * MAILGUN_MAX_AGE_SECONDS * 1000);
    const seen = await adminDb.authRateLimitAttempt.count({
      where: { action: "INBOUND_EMAIL", scope: REPLAY_SCOPE, key: token, createdAt: { gte: since } },
    });
    if (seen > 0) throw new UnauthorizedError("Invalid or missing inbound email signature.");

    const { organizationId } = await resolveInboundBccRecipient(mailgunRecipients(form));
    const result = await ingestInboundEmailForOrganization(organizationId, mapMailgunPayload(form));
    await adminDb.authRateLimitAttempt.create({ data: { action: "INBOUND_EMAIL", scope: REPLAY_SCOPE, key: token } });
    return result;
  });
}
