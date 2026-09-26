import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { generateWebsiteApiKey } from "../auth/websiteApiKey";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  getWebsiteApiKeyRecord,
  setWebsiteApiKey,
} from "../repositories/websiteApiKeys";

/**
 * Reuses `configuration.manage` (Management-only in the FIG-438 seed)
 * rather than inventing a new permission -- FIG-436 section 8 already lists
 * the website integration's assignment rules alongside pipeline
 * stages/lead sources as organization-configurable data, and this is the
 * same kind of "who's allowed to change how this organization is set up"
 * decision (same reasoning FIG-440 used to reuse the Deal ownership gate
 * for Proposal References rather than adding proposals.view.own/.all).
 */
const PERMISSION = "configuration.manage";

export async function getWebsiteIntegrationStatus(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const record = await getWebsiteApiKeyRecord(ctx.organizationId);
  if (!record) {
    return { configured: false as const };
  }
  return {
    configured: true as const,
    keyPrefix: record.keyPrefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

/**
 * Returns the new key's plaintext exactly once -- it is never retrievable
 * again, only its hash is stored (see src/auth/websiteApiKey.ts). Rotating
 * replaces the previous key immediately; there is no overlap window (see
 * the WebsiteApiKey model's doc comment in prisma/schema.prisma for why).
 */
export async function regenerateWebsiteApiKey(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);

  const { plaintext, keyHash, keyPrefix } = generateWebsiteApiKey();
  await setWebsiteApiKey(ctx.organizationId, {
    keyHash,
    keyPrefix,
    createdByMembershipId: ctx.membershipId,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_api_key.regenerated",
    entityType: "WebsiteApiKey",
    entityId: ctx.organizationId,
    metadata: { keyPrefix },
  });

  return { apiKey: plaintext, keyPrefix };
}
