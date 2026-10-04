import { ValidationError } from "../auth/errors";
import { resolveInboundEmailContext } from "../auth/inboundEmailKey";
import { findContactByEmail } from "../repositories/contacts";
import { createCommunication } from "../repositories/communications";

/**
 * Public entry point for the inbound-email webhook (FIG-598) -- no
 * `AuthContext`, same reason `websiteLeadService.submitWebsiteLead` has
 * none: there's no CRM session, the caller is a third-party inbound-email
 * provider (Postmark/Mailgun/SendGrid inbound parse, or a BCC address
 * routed through one), authenticated by the per-organization token instead
 * (`src/auth/inboundEmailKey.ts`).
 *
 * Deliberately provider-agnostic: this is the shape the webhook route
 * normalizes a real provider's own payload into, not any one vendor's
 * exact field names -- see `docs/DEPLOYMENT.md` for why no real provider
 * is wired up yet.
 */
export interface InboundEmailPayload {
  from: string;
  subject?: string;
  text?: string;
  messageId?: string;
}

export interface IngestInboundEmailResult {
  logged: boolean;
  reason?: string;
  communicationId?: string;
}

/** Tolerates a raw "Display Name <addr@example.com>" From header, not just a bare address. */
function extractEmailAddress(raw: string): string | null {
  const match = raw.match(/<([^<>]+)>/);
  const candidate = (match ? match[1] : raw).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/**
 * Matches the sender against an existing Contact by email and logs the
 * message as an inbound Communication, linked to that contact (and its
 * company, if it has one). There is no CRM user to attribute this to
 * (`authorMembershipId` stays null -- see the model's doc comment in
 * schema.prisma), and no attempt to guess a specific Lead/Deal to also
 * link -- a contact can have several, and guessing wrong would be worse
 * than leaving it off; logged against the contact is already enough for it
 * to show up on that contact's timeline (FIG-598 AC).
 *
 * A sender that doesn't match any contact is NOT an error -- this is a
 * webhook a real provider will retry on a non-2xx response, and "we don't
 * recognize this sender" isn't a delivery failure worth retrying. The
 * route still returns 200 either way; `logged: false` is how the caller
 * (visible in the organization's own integration activity, if surfaced)
 * finds out nothing was recorded.
 */
export async function ingestInboundEmail(
  orgSlug: string,
  providedKey: string | null,
  payload: InboundEmailPayload,
): Promise<IngestInboundEmailResult> {
  const { organizationId } = await resolveInboundEmailContext(orgSlug, providedKey);

  if (typeof payload.from !== "string" || !payload.from.trim()) {
    throw new ValidationError("`from` is required.");
  }
  const fromEmail = extractEmailAddress(payload.from);
  if (!fromEmail) {
    return { logged: false, reason: "Could not parse a sender email address." };
  }

  const contact = await findContactByEmail(organizationId, fromEmail);
  if (!contact) {
    return { logged: false, reason: `No contact found for ${fromEmail}.` };
  }

  const communication = await createCommunication({
    organizationId,
    channel: "EMAIL",
    direction: "INBOUND",
    subject: payload.subject,
    summary: payload.text?.trim() || "(no message body)",
    externalReference: payload.messageId,
    contactId: contact.id,
    companyId: contact.companyId ?? undefined,
  });

  return { logged: true, communicationId: communication.id };
}
