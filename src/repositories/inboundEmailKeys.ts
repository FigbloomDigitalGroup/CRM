import { withOrgContext } from "../db/orgScopedClient";

export async function getInboundEmailKeyRecord(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.inboundEmailKey.findUnique({ where: { organizationId } }),
  );
}

export interface SetInboundEmailKeyInput {
  keyHash: string;
  keyPrefix: string;
  createdByMembershipId?: string;
}

/** Same "replace outright, no overlap window" shape as `setWebsiteApiKey`. */
export async function setInboundEmailKey(
  organizationId: string,
  input: SetInboundEmailKeyInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.inboundEmailKey.upsert({
      where: { organizationId },
      update: {
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        createdByMembershipId: input.createdByMembershipId,
        lastUsedAt: null,
        revokedAt: null,
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

/** B4.01: the Settings screen shows the last message that could not be processed; a later success clears it. */
export async function recordInboundEmailError(organizationId: string, message: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.inboundEmailKey.updateMany({
      where: { organizationId },
      data: { lastErrorAt: new Date(), lastError: message.slice(0, 300) },
    }),
  );
}

export async function clearInboundEmailError(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.inboundEmailKey.updateMany({
      where: { organizationId, lastError: { not: null } },
      data: { lastErrorAt: null, lastError: null },
    }),
  );
}

export async function revokeInboundEmailKey(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.inboundEmailKey.update({
      where: { organizationId },
      data: { revokedAt: new Date() },
    }),
  );
}
