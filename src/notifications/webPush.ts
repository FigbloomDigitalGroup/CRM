import webpush from "web-push";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { textForViewer } from "../auth/masking";
import {
  listSubscriptionsForSend,
  recordPushFailure,
  recordPushSuccess,
  revokeSubscription,
} from "../repositories/pushSubscriptions";
import { getNotificationSettings } from "../repositories/notificationSettings";
import { memberTimeZone } from "../services/notificationDeliveryPolicy";
import { isInQuietHours } from "./timeZone";

/**
 * Web Push sending (FIG-1064, B4.07). Browsers and phones register a subscription; this sends one notification to every
 * device a member has registered, when the member wants push for that type and it is not their quiet time.
 *
 * Configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: or https: contact). Without them
 * push is "not configured": registering devices still works, nothing is sent, and the preferences screen says so.
 * A transport can be injected (tests, or a different provider) with `setPushTransport`.
 *
 * What is sent: the notification text with money redacted for the recipient's role (the same rule as the notification
 * centre), a deep link and the notification id. A subscription the push service reports gone (404 or 410) is revoked at
 * once; five failures in a row revoke it too. Sending never throws into the caller: a notification is secondary to the
 * action that raised it.
 */

export interface PushSubscriptionTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushTransport {
  send(subscription: PushSubscriptionTarget, payload: string): Promise<{ statusCode: number }>;
}

let injected: PushTransport | null = null;
export function setPushTransport(transport: PushTransport | null): void {
  injected = transport;
}

export const MAX_PUSH_FAILURES = 5;

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function pushConfigured(): boolean {
  return injected !== null || vapid() !== null;
}

/** The public key a browser needs to subscribe, or null when push is not configured. */
export function vapidPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

function transport(): PushTransport | null {
  if (injected) return injected;
  const keys = vapid();
  if (!keys) return null;
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  return {
    async send(subscription, payload) {
      const res = await webpush.sendNotification(subscription, payload, { TTL: 24 * 60 * 60, urgency: "normal" });
      return { statusCode: res.statusCode };
    },
  };
}

/** Hosts a browser's push service lives on. A subscription endpoint is a URL the server will call, so it must be one of these. */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  const extra = (process.env.PUSH_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const suffixes = [...PUSH_HOST_SUFFIXES, ...extra, ...(process.env.NODE_ENV === "production" ? [] : ["example.test"])];
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

export interface PushNotificationInput {
  organizationId: string;
  membershipId: string;
  notificationId: string;
  type: string;
  title: string;
  body: string;
  link: string;
}

export type PushResult = { sent: number; revoked: number; skipped?: "NO_DEVICE" | "NOT_WANTED" | "QUIET_HOURS" | "NOT_CONFIGURED" };

/** Sends one notification to the member's devices. `wantsPush` and `subs` come from one query in the caller. */
export async function pushToMember(input: PushNotificationInput, now = new Date()): Promise<PushResult> {
  try {
    const t = transport();
    if (!t) return { sent: 0, revoked: 0, skipped: "NOT_CONFIGURED" };
    const found = await listSubscriptionsForSend(input.organizationId, input.membershipId, input.type);
    if (found.subs.length === 0) return { sent: 0, revoked: 0, skipped: "NO_DEVICE" };
    if (!found.wantsPush) return { sent: 0, revoked: 0, skipped: "NOT_WANTED" };

    // Quiet hours mean the person's own wall clock; the in-app notification is already waiting for them.
    const [settings, timeZone] = await Promise.all([
      getNotificationSettings(input.organizationId, input.membershipId),
      memberTimeZone(input.organizationId, input.membershipId),
    ]);
    if (isInQuietHours(now, settings.quietHours, timeZone)) return { sent: 0, revoked: 0, skipped: "QUIET_HOURS" };

    // Money is redacted for the recipient's role, as in the notification centre.
    const membership = await adminDb.membership.findFirst({
      where: { id: input.membershipId, organizationId: input.organizationId },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const viewer = { permissionKeys: membership?.role.rolePermissions.map((rp) => rp.permission.key) ?? [] };
    const payload = JSON.stringify({
      title: textForViewer(viewer, input.title),
      body: textForViewer(viewer, input.body),
      link: input.link,
      notificationId: input.notificationId,
      type: input.type,
    });

    let sent = 0;
    let revoked = 0;
    for (const sub of found.subs) {
      try {
        await t.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        await recordPushSuccess(input.organizationId, sub.id);
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await revokeSubscription(input.organizationId, sub.id);
          revoked += 1;
          continue;
        }
        const failures = await recordPushFailure(input.organizationId, sub.id);
        if (failures >= MAX_PUSH_FAILURES) {
          await revokeSubscription(input.organizationId, sub.id);
          revoked += 1;
        }
        logger.warn({ subscriptionId: sub.id, status }, "Web Push send failed");
      }
    }
    return { sent, revoked };
  } catch (err) {
    logger.error({ err }, "Web Push failed");
    return { sent: 0, revoked: 0 };
  }
}
