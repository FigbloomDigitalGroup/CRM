import { ValidationError } from "../auth/errors";
import { resolveInboundEmailContext } from "../auth/inboundEmailKey";
import { findContactByEmail } from "../repositories/contacts";
import { createCommunication, findCommunicationByReference } from "../repositories/communications";
import { clearInboundEmailError, recordInboundEmailError } from "../repositories/inboundEmailKeys";

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
  /** The sender matched no contact, so the message waits in the Needs-linking queue (FIG-1053). */
  needsLinking?: boolean;
  /** This message id was already stored (the provider retried), so nothing new was written. */
  duplicate?: boolean;
}

/** "Jane Doe <jane@example.com>" gives "Jane Doe"; a bare address gives null. */
function extractDisplayName(raw: string): string | null {
  const name = raw.replace(/<[^<>]*>/, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return name && !/@/.test(name) ? name.slice(0, 120) : null;
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
 * route still returns 200 either way. The message is kept, unlinked, in the
 * Needs-linking queue (FIG-1053, B3.07) rather than dropped; `needsLinking:
 * true` tells the caller that is what happened.
 */
export async function ingestInboundEmail(
  orgSlug: string,
  providedKey: string | null,
  payload: InboundEmailPayload,
): Promise<IngestInboundEmailResult> {
  const { organizationId } = await resolveInboundEmailContext(orgSlug, providedKey);
  try {
    const result = await ingestForOrganization(organizationId, payload);
    await clearInboundEmailError(organizationId).catch(() => undefined);
    return result;
  } catch (err) {
    // B4.01: Settings shows the last thing that went wrong with the inbound mailbox.
    await recordInboundEmailError(organizationId, err instanceof Error ? err.message : "Unknown error.").catch(() => undefined);
    throw err;
  }
}

async function ingestForOrganization(
  organizationId: string,
  payload: InboundEmailPayload,
): Promise<IngestInboundEmailResult> {
  if (typeof payload.from !== "string" || !payload.from.trim()) {
    throw new ValidationError("`from` is required.");
  }
  const fromEmail = extractEmailAddress(payload.from);
  if (!fromEmail) {
    return { logged: false, reason: "Could not parse a sender email address." };
  }

  // A provider retries a webhook it thinks failed: the same message id is never stored twice.
  const reference = payload.messageId?.trim() || undefined;
  if (reference) {
    const already = await findCommunicationByReference(organizationId, reference);
    if (already) return { logged: true, communicationId: already.id, needsLinking: already.needsLinking, duplicate: true };
  }

  const contact = await findContactByEmail(organizationId, fromEmail);
  if (!contact) {
    // Kept, not dropped: it waits in the Needs-linking queue until a person links it, turns it into a lead, or dismisses it.
    const waiting = await createCommunication({
      organizationId,
      channel: "EMAIL",
      direction: "INBOUND",
      subject: payload.subject,
      summary: payload.text?.trim() || "(no message body)",
      externalReference: reference,
      needsLinking: true,
      counterpartyEmail: fromEmail.toLowerCase(),
      counterpartyName: extractDisplayName(payload.from) ?? undefined,
    });
    return { logged: true, needsLinking: true, communicationId: waiting.id, reason: `No contact found for ${fromEmail}; it is waiting to be linked.` };
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
