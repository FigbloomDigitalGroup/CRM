import { createHmac } from "node:crypto";
import { adminDb } from "../db/adminClient";
import { secretsMatch } from "./secretCompare";
import { NotFoundError } from "./errors";

/**
 * The per-organisation BCC-to-CRM address (FIG-806): `<slug>+<token>@<INBOUND_EMAIL_DOMAIN>`. The token is
 * `HMAC-SHA256(INBOUND_EMAIL_ADDRESS_SECRET, "inbound-bcc:" + organizationId)` cut to 24 hex characters, so no new column is needed,
 * it is stable, and nobody can compute another organisation's address from its slug. Mail is routed back to the organisation by
 * recomputing the token; an unknown slug, a wrong token and an inactive organisation all fail the same way.
 *
 * Changing INBOUND_EMAIL_ADDRESS_SECRET changes every address; set it once and keep it.
 */
const TOKEN_LENGTH = 24;

export function inboundEmailDomain(): string | null {
  const d = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  return d ? d : null;
}

function addressSecret(): string | null {
  const s = process.env.INBOUND_EMAIL_ADDRESS_SECRET?.trim();
  if (s) return s;
  // Local development and tests only; production without a secret has no address (the Settings card says so).
  return process.env.NODE_ENV === "production" ? null : "dev-only-inbound-address-secret";
}

function tokenFor(organizationId: string, secret: string): string {
  return createHmac("sha256", secret).update(`inbound-bcc:${organizationId}`).digest("hex").slice(0, TOKEN_LENGTH);
}

/** The organisation's BCC address, or null when the domain or secret is not configured. */
export function inboundBccAddressFor(organization: { id: string; slug: string }): string | null {
  const domain = inboundEmailDomain();
  const secret = addressSecret();
  if (!domain || !secret) return null;
  return `${organization.slug.toLowerCase()}+${tokenFor(organization.id, secret)}@${domain}`;
}

/** Finds the organisation a recipient address belongs to. Throws NotFoundError (one message) for anything else. */
export async function resolveInboundBccRecipient(recipients: string[]): Promise<{ organizationId: string }> {
  const unknown = () => new NotFoundError("Inbound recipient", "address");
  const domain = inboundEmailDomain();
  const secret = addressSecret();
  if (!domain || !secret) throw unknown();
  for (const recipient of recipients) {
    const at = recipient.lastIndexOf("@");
    if (at < 1 || recipient.slice(at + 1) !== domain) continue;
    const local = recipient.slice(0, at);
    const plus = local.lastIndexOf("+");
    if (plus < 1) continue;
    const slug = local.slice(0, plus);
    const token = local.slice(plus + 1);
    const organization = await adminDb.organization.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!organization || organization.status !== "ACTIVE") continue;
    if (secretsMatch(token, tokenFor(organization.id, secret))) return { organizationId: organization.id };
  }
  throw unknown();
}
