import type { AuthContext } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { isAllowedPushEndpoint, pushConfigured, vapidPublicKey } from "../notifications/webPush";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  getSubscription,
  listActiveSubscriptions,
  revokeSubscription,
  upsertSubscription,
} from "../repositories/pushSubscriptions";

/**
 * Push subscriptions (FIG-1064, B4.07): the devices a member has allowed to receive Web Push. Anyone signed in may register
 * their own device; a subscription belongs to one person in one organisation and can only be seen, replaced or removed by
 * that person. Sending is in `src/notifications/webPush.ts`.
 */

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_UA = 300;

export interface RegisterPushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

function present(row: { id: string; endpoint: string; userAgent: string | null; createdAt: Date; lastSuccessAt: Date | null; lastFailureAt: Date | null; failureCount: number }) {
  let host = "";
  try {
    host = new URL(row.endpoint).hostname;
  } catch {
    // keep blank
  }
  return {
    id: row.id,
    // The endpoint itself is a capability URL, so it is never shown back; the host is enough to recognise the service.
    service: host,
    userAgent: row.userAgent,
    registeredAt: row.createdAt,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    failureCount: row.failureCount,
  };
}

/** What a client needs to subscribe: whether push is on for this server, and the public key to subscribe with. */
export function getPushConfig() {
  return { configured: pushConfigured(), publicKey: vapidPublicKey() };
}

export async function registerPushSubscription(ctx: AuthContext, input: RegisterPushInput) {
  const issues: ValidationIssue[] = [];
  if (typeof input.endpoint !== "string" || !isAllowedPushEndpoint(input.endpoint)) {
    issues.push({ path: "endpoint", message: "That is not a push service address this server can use.", code: "PUSH_ENDPOINT_NOT_ALLOWED" });
  }
  const p256dh = input.keys?.p256dh;
  const auth = input.keys?.auth;
  if (typeof p256dh !== "string" || !BASE64URL.test(p256dh) || p256dh.length < 40 || p256dh.length > 200) {
    issues.push({ path: "keys.p256dh", message: "The subscription key is missing or malformed." });
  }
  if (typeof auth !== "string" || !BASE64URL.test(auth) || auth.length < 8 || auth.length > 100) {
    issues.push({ path: "keys.auth", message: "The subscription secret is missing or malformed." });
  }
  if (issues.length > 0) throw new ValidationError("This push subscription is not valid.", issues);

  const { row, created } = await upsertSubscription({
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    endpoint: input.endpoint,
    p256dh: p256dh!,
    auth: auth!,
    userAgent: input.userAgent?.slice(0, MAX_UA) ?? null,
  });
  if (created) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "push_subscription.registered",
      entityType: "PushSubscription",
      entityId: row.id,
      metadata: { service: present(row).service },
    });
  }
  return { ...present(row), created, pushConfigured: pushConfigured() };
}

/** The caller's own devices. */
export async function listMyPushSubscriptions(ctx: AuthContext) {
  const rows = await listActiveSubscriptions(ctx.organizationId, ctx.membershipId);
  return { items: rows.map(present), ...getPushConfig() };
}

export async function removeMyPushSubscription(ctx: AuthContext, id: string) {
  // Someone else's device is not found, not forbidden: it does not exist as far as this caller is concerned.
  const row = await getSubscription(ctx.organizationId, ctx.membershipId, id);
  if (!row) throw new NotFoundError("PushSubscription", id);
  await revokeSubscription(ctx.organizationId, id);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "push_subscription.removed",
    entityType: "PushSubscription",
    entityId: id,
  });
  return { id, removed: true as const };
}

export async function hasPushDevice(ctx: Pick<AuthContext, "organizationId" | "membershipId">): Promise<boolean> {
  return (await listActiveSubscriptions(ctx.organizationId, ctx.membershipId)).length > 0;
}
