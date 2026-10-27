import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `push_subscriptions` (FIG-1064, B4.07). Every call runs inside the organisation's RLS context. */

export interface SubscriptionInput {
  organizationId: string;
  membershipId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/** Registers a device, or re-arms one that was revoked or whose keys changed. Returns the row and whether it is new. */
export async function upsertSubscription(input: SubscriptionInput) {
  return withOrgContext(input.organizationId, async (tx) => {
    const where = { organizationId_membershipId_endpoint: { organizationId: input.organizationId, membershipId: input.membershipId, endpoint: input.endpoint } };
    const existing = await tx.pushSubscription.findUnique({ where });
    const row = await tx.pushSubscription.upsert({
      where,
      update: { p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null, revokedAt: null, failureCount: 0 },
      create: {
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
    });
    return { row, created: existing === null };
  });
}

export function listActiveSubscriptions(organizationId: string, membershipId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.pushSubscription.findMany({ where: { organizationId, membershipId, revokedAt: null }, orderBy: { createdAt: "asc" } }),
  );
}

export function getSubscription(organizationId: string, membershipId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.pushSubscription.findFirst({ where: { id, organizationId, membershipId } }),
  );
}

export function revokeSubscription(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.pushSubscription.updateMany({ where: { id, organizationId, revokedAt: null }, data: { revokedAt: new Date() } }),
  );
}

export function recordPushSuccess(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.pushSubscription.updateMany({ where: { id, organizationId }, data: { lastSuccessAt: new Date(), failureCount: 0 } }),
  );
}

/** Counts a failed send; returns the new failure count. */
export async function recordPushFailure(organizationId: string, id: string): Promise<number> {
  return withOrgContext(organizationId, async (tx) => {
    await tx.pushSubscription.updateMany({ where: { id, organizationId }, data: { lastFailureAt: new Date(), failureCount: { increment: 1 } } });
    const row = await tx.pushSubscription.findFirst({ where: { id, organizationId }, select: { failureCount: true } });
    return row?.failureCount ?? 0;
  });
}

/** Does this person have any registered device, and do they want push for this type? One query for the notify hot path. */
export function listSubscriptionsForSend(organizationId: string, membershipId: string, type: string) {
  return withOrgContext(organizationId, async (tx) => {
    const subs = await tx.pushSubscription.findMany({ where: { organizationId, membershipId, revokedAt: null } });
    if (subs.length === 0) return { subs, wantsPush: false };
    const pref = await tx.notificationPreference.findFirst({ where: { organizationId, membershipId, type: type as never }, select: { pushEnabled: true } });
    return { subs, wantsPush: pref?.pushEnabled === true };
  });
}

export function pushPreferenceMap(organizationId: string, membershipId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.notificationPreference.findMany({ where: { organizationId, membershipId }, select: { type: true, pushEnabled: true } });
    return new Map(rows.map((r) => [r.type as string, r.pushEnabled]));
  });
}
