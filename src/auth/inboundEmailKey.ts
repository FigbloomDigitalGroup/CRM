import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { adminDb } from "../db/adminClient";
import { UnauthorizedError } from "./errors";

/**
 * Authenticates the public, session-less inbound-email webhook (FIG-598) --
 * same generate/hash/compare/revoke shape as `websiteApiKey.ts` (FIG-442),
 * but a distinct credential and model: this is a different trust boundary
 * (a real inbound-email provider's webhook call -- Postmark/Mailgun/
 * SendGrid inbound parse, not the public website lead form), so it gets its
 * own key rather than overloading the website one.
 *
 * Delivered via a `token` query param (set once in the provider's webhook
 * URL config) rather than a request header, since most inbound-email-parse
 * providers let you configure an arbitrary destination URL but not always
 * custom headers -- `x-figbloom-inbound-key` is still accepted too, for a
 * provider that does support it.
 */

const KEY_PREFIX = "iek_live_";
export const INBOUND_EMAIL_KEY_HEADER = "x-figbloom-inbound-key";
export const INBOUND_EMAIL_KEY_QUERY_PARAM = "token";

export function generateInboundEmailKey(): {
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
} {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    keyHash: hashInboundEmailKey(plaintext),
    keyPrefix: plaintext.slice(0, 12),
  };
}

export function hashInboundEmailKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface InboundEmailContext {
  organizationId: string;
}

/**
 * Same generic-failure-message contract as `resolveWebsitePublicContext`:
 * unknown slug, no key configured, revoked key, and wrong key all throw the
 * identical message, so a prober can't distinguish them.
 */
export async function resolveInboundEmailContext(
  orgSlug: string,
  providedKey: string | null,
): Promise<InboundEmailContext> {
  const invalid = () => new UnauthorizedError("Invalid or missing inbound email token.");

  if (!providedKey) {
    throw invalid();
  }

  const organization = await adminDb.organization.findUnique({
    where: { slug: orgSlug },
    include: { inboundEmailKey: true },
  });

  if (
    !organization ||
    organization.status !== "ACTIVE" ||
    !organization.inboundEmailKey ||
    organization.inboundEmailKey.revokedAt
  ) {
    throw invalid();
  }

  const providedHash = Buffer.from(hashInboundEmailKey(providedKey));
  const storedHash = Buffer.from(organization.inboundEmailKey.keyHash);
  if (
    providedHash.length !== storedHash.length ||
    !timingSafeEqual(providedHash, storedHash)
  ) {
    throw invalid();
  }

  await adminDb.inboundEmailKey.update({
    where: { organizationId: organization.id },
    data: { lastUsedAt: new Date() },
  });

  return { organizationId: organization.id };
}
