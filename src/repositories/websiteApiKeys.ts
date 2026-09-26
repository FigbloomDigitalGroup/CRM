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
}

/**
 * Replaces the organization's website API key outright (one active key per
 * organization -- rotating invalidates the previous key immediately, no
 * overlap window; see the model's doc comment in prisma/schema.prisma).
 */
export async function setWebsiteApiKey(
  organizationId: string,
  input: SetWebsiteApiKeyInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteApiKey.upsert({
      where: { organizationId },
      update: {
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        createdByMembershipId: input.createdByMembershipId,
        lastUsedAt: null,
      },
      create: {
        organizationId,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        createdByMembershipId: input.createdByMembershipId,
      },
    }),
  );
}
