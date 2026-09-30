import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { adminDb } from "../db/adminClient";
import { UnauthorizedError } from "./errors";

/**
 * Authenticates the public, session-less website lead-capture endpoint
 * (FIG-442) — see IMPLEMENTATION_NOTES.md "FIG-442: choosing the website
 * integration's authentication mechanism" for why a static per-organization
 * API key was chosen over a signed webhook.
 *
 * The key is high-entropy (32 random bytes), so a fast hash (SHA-256) is the
 * right tool here, unlike a human-chosen password — this mirrors how most
 * API-key providers (e.g. Stripe) store keys. Only the hash is ever
 * persisted; the plaintext is shown to the caller exactly once, at
 * generation time (`src/services/integrationService.ts`).
 */

const KEY_PREFIX = "wlk_live_";
const HEADER_NAME = "x-figbloom-api-key";

export function generateWebsiteApiKey(): {
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
} {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    keyHash: hashWebsiteApiKey(plaintext),
    // First 12 chars only, for masked display in the settings UI (e.g.
    // "wlk_live_AbC..."); never enough to reconstruct or narrow-search the
    // full key.
    keyPrefix: plaintext.slice(0, 12),
  };
}

export function hashWebsiteApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface WebsitePublicContext {
  organizationId: string;
  allowedOrigins: string[];
  honeypotFieldName: string | null;
  captchaSecret: string | null;
}

/**
 * Resolves which organization a public website submission belongs to,
 * verifying the caller-supplied API key against that organization's stored
 * hash, and returns its optional abuse-protection settings (FIG-594) so
 * the caller doesn't need a second query for them. This is the exception
 * to "ordinary CRM access goes through withOrgContext" (see
 * src/db/adminClient.ts) -- there's no org context to set yet, so
 * resolving it is this function's job, much like `resolveRequestContext`
 * looking up the Organization row by slug before any membership/session
 * exists.
 *
 * Every failure mode (unknown slug, no key configured, revoked key, wrong
 * key, inactive org) throws the same generic message so a prober can't
 * distinguish a missing org from a wrong key -- that would leak which org
 * slugs are valid to an unauthenticated caller.
 */
export async function resolveWebsitePublicContext(
  orgSlug: string,
  providedKey: string | null,
): Promise<WebsitePublicContext> {
  const invalid = () =>
    new UnauthorizedError("Invalid or missing API key.");

  if (!providedKey) {
    throw invalid();
  }

  const organization = await adminDb.organization.findUnique({
    where: { slug: orgSlug },
    include: { websiteApiKey: true },
  });

  if (
    !organization ||
    organization.status !== "ACTIVE" ||
    !organization.websiteApiKey ||
    organization.websiteApiKey.revokedAt
  ) {
    throw invalid();
  }

  const providedHash = Buffer.from(hashWebsiteApiKey(providedKey));
  const storedHash = Buffer.from(organization.websiteApiKey.keyHash);
  if (
    providedHash.length !== storedHash.length ||
    !timingSafeEqual(providedHash, storedHash)
  ) {
    throw invalid();
  }

  await adminDb.websiteApiKey.update({
    where: { organizationId: organization.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    organizationId: organization.id,
    allowedOrigins: organization.websiteApiKey.allowedOrigins,
    honeypotFieldName: organization.websiteApiKey.honeypotFieldName,
    captchaSecret: organization.websiteApiKey.captchaSecret,
  };
}

export { HEADER_NAME as WEBSITE_API_KEY_HEADER };
