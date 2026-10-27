import { withOrgContext } from "../db/orgScopedClient";

export async function getWebsiteApiKeyRecord(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteApiKey.findUnique({ where: { organizationId } }),
  );
}

export interface SetWebsiteApiKeyInput {
  keyHash: string;
  keyPrefix: string;
  createdByMembershipId?: string;
  /** B4.01: how long the key being replaced keeps working. 0 (the default) ends it at once. */
  graceMs?: number;
}

/**
 * Replaces the organization's website API key outright (one active key per
 * organization -- rotating invalidates the previous key immediately, no
 * overlap window; see the model's doc comment in prisma/schema.prisma).
 * Also clears `revokedAt` -- generating a new key is an explicit request
 * for a working integration again, even if the previous one was revoked.
 */
export async function setWebsiteApiKey(
  organizationId: string,
  input: SetWebsiteApiKeyInput,
) {
  return withOrgContext(organizationId, async (tx) => {
    const now = new Date();
    const existing = await tx.websiteApiKey.findUnique({ where: { organizationId } });
    // The key being replaced is kept as the "previous" key for the grace window, unless it was already revoked.
    const keepPrevious = existing !== null && existing.revokedAt === null && (input.graceMs ?? 0) > 0;
    const previous = keepPrevious
      ? {
          previousKeyHash: existing.keyHash,
          previousKeyPrefix: existing.keyPrefix,
          previousKeyExpiresAt: new Date(now.getTime() + (input.graceMs ?? 0)),
        }
      : { previousKeyHash: null, previousKeyPrefix: null, previousKeyExpiresAt: null };

    return tx.websiteApiKey.upsert({
      where: { organizationId },
      update: {
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        createdByMembershipId: input.createdByMembershipId,
        lastUsedAt: null,
        revokedAt: null,
        rotatedAt: now,
        ...previous,
      },
      create: {
        organizationId,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        createdByMembershipId: input.createdByMembershipId,
      },
    });
  });
}

/**
 * Disables the integration outright without issuing a replacement (FIG-594)
 * -- distinct from rotation, above, which always leaves a new working key
 * behind. `resolveWebsitePublicContext` treats a revoked key the same as a
 * wrong one.
 */
export async function revokeWebsiteApiKey(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteApiKey.update({
      where: { organizationId },
      // Revoking switches the integration off outright, so a key still inside its grace window stops too.
      data: { revokedAt: new Date(), previousKeyHash: null, previousKeyPrefix: null, previousKeyExpiresAt: null },
    }),
  );
}

export interface WebsiteApiKeySecuritySettings {
  allowedOrigins?: string[];
  honeypotFieldName?: string | null;
  captchaSecret?: string | null;
}

/** Updates the optional abuse-protection settings on an existing key (FIG-594). */
export async function updateWebsiteApiKeySecurity(
  organizationId: string,
  input: WebsiteApiKeySecuritySettings,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteApiKey.update({
      where: { organizationId },
      data: {
        ...(input.allowedOrigins !== undefined && {
          allowedOrigins: input.allowedOrigins,
        }),
        ...(input.honeypotFieldName !== undefined && {
          honeypotFieldName: input.honeypotFieldName,
        }),
        ...(input.captchaSecret !== undefined && {
          captchaSecret: input.captchaSecret,
        }),
      },
    }),
  );
}
