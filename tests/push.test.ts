import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { MAX_PUSH_FAILURES, isAllowedPushEndpoint, pushConfigured, setPushTransport, type PushTransport } from "../src/notifications/webPush";
import { getMyNotificationPreferencesV2, updateMyNotificationPreferencesV2 } from "../src/services/notificationPreferenceService";
import { notifyEvent } from "../src/services/notificationService";
import { getPushConfig, listMyPushSubscriptions, registerPushSubscription, removeMyPushSubscription } from "../src/services/pushService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const endpoint = (n = "a") => `https://fcm.googleapis.com/fcm/send/${n}-${Math.random().toString(36).slice(2)}`;

interface Sent {
  endpoint: string;
  payload: { title: string; body: string; link: string; notificationId: string; type: string };
}
function fakeTransport(behaviour: (sub: { endpoint: string }) => number | "ok" = () => "ok") {
  const sent: Sent[] = [];
  const transport: PushTransport = {
    async send(subscription, payload) {
      const result = behaviour(subscription);
      if (result !== "ok") throw Object.assign(new Error(`push service said ${result}`), { statusCode: result });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    },
  };
  return { transport, sent };
}

async function setup() {
  const org = await createTestOrganization("Push");
  const sales = await createTestContext(org.id, "SALES", "push.sales");
  return { org, sales };
}

const mention = (orgId: string, membershipId: string, entityId = `c-${Math.random()}`, title = "You were mentioned", body = "Someone mentioned you.") =>
  notifyEvent({ organizationId: orgId, membershipId, type: "MENTION", title, body, entityType: "Comment", entityId, path: "/o/x/leads/1" });

beforeEach(() => setPushTransport(null));
afterEach(() => setPushTransport(null));

describe("registering a device (FIG-1064)", () => {
  it("stores the caller's own subscription, once, and never shows the endpoint back", async () => {
    const { org, sales } = await setup();
    const url = endpoint();
    const first = await registerPushSubscription(sales, { endpoint: url, keys: KEYS, userAgent: "Mozilla/5.0 (Android 14)" });
    expect(first).toMatchObject({ created: true, service: "fcm.googleapis.com", userAgent: "Mozilla/5.0 (Android 14)" });
    expect(JSON.stringify(first)).not.toContain(url);
    const again = await registerPushSubscription(sales, { endpoint: url, keys: KEYS });
    expect(again).toMatchObject({ created: false, id: first.id });
    expect(await adminDb.pushSubscription.count({ where: { organizationId: org.id } })).toBe(1);
    const listed = await listMyPushSubscriptions(sales);
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(url);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "push_subscription.registered" } })).toBe(1);
  });

  it("only accepts addresses on a real push service, over https, and well-formed keys", async () => {
    const { sales } = await setup();
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/hook",
      "https://internal.example.com/push",
      "https://fcm.googleapis.com.evil.test/push",
      "https://user:pass@fcm.googleapis.com/push",
      "https://fcm.googleapis.com:8443/push",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
      await expect(registerPushSubscription(sales, { endpoint: bad, keys: KEYS })).rejects.toThrow(ValidationError);
    }
    for (const good of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/x"]) {
      expect(isAllowedPushEndpoint(good), good).toBe(true);
    }
    await expect(registerPushSubscription(sales, { endpoint: endpoint(), keys: { p256dh: "short", auth: KEYS.auth } })).rejects.toThrow(ValidationError);
    await expect(registerPushSubscription(sales, { endpoint: endpoint(), keys: { p256dh: KEYS.p256dh, auth: "not base64!" } })).rejects.toThrow(ValidationError);
  });

  it("a device belongs to one person: others cannot see or remove it, the owner can", async () => {
    const { org, sales } = await setup();
    const other = await createTestContext(org.id, "SALES", "push.other");
    const mine = await registerPushSubscription(sales, { endpoint: endpoint(), keys: KEYS });
    expect((await listMyPushSubscriptions(other)).items).toHaveLength(0);
    await expect(removeMyPushSubscription(other, mine.id)).rejects.toThrow(NotFoundError);
    expect((await listMyPushSubscriptions(sales)).items).toHaveLength(1);
    await expect(removeMyPushSubscription(sales, mine.id)).resolves.toEqual({ id: mine.id, removed: true });
    expect((await listMyPushSubscriptions(sales)).items).toHaveLength(0);
    // Registering the same device again re-arms it.
    const rearmed = await registerPushSubscription(sales, { endpoint: (await adminDb.pushSubscription.findUniqueOrThrow({ where: { id: mine.id } })).endpoint, keys: KEYS });
    expect(rearmed.created).toBe(false);
    expect((await listMyPushSubscriptions(sales)).items).toHaveLength(1);
  });

  it("is per organisation: the same browser in two organisations is two subscriptions", async () => {
    const a = await setup();
    const b = await setup();
    const url = endpoint();
    await registerPushSubscription(a.sales, { endpoint: url, keys: KEYS });
    await registerPushSubscription(b.sales, { endpoint: url, keys: KEYS });
    expect(await adminDb.pushSubscription.count({ where: { organizationId: a.org.id } })).toBe(1);
    expect(await adminDb.pushSubscription.count({ where: { organizationId: b.org.id } })).toBe(1);
    expect((await listMyPushSubscriptions(a.sales)).items).toHaveLength(1);
  });

  it("says whether push is configured on this server", () => {
    expect(getPushConfig()).toEqual({ configured: false, publicKey: null });
    setPushTransport(fakeTransport().transport);
    expect(pushConfigured()).toBe(true);
  });
});

describe("the preference respects what is possible (B1.11)", () => {
  it("cannot be turned on without a configured server and a registered device, and then can", async () => {
    const { sales } = await setup();
    const ask = () => updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } }).catch((e) => e);
    // No server support yet.
    let err = await ask();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0]).toMatchObject({ code: "PUSH_NOT_AVAILABLE", path: "types.MENTION.push" });
    // Server ready, no device.
    setPushTransport(fakeTransport().transport);
    err = await ask();
    expect(err.issues[0].message).toMatch(/Allow notifications on this phone/);
    expect((await getMyNotificationPreferencesV2(sales)).types.find((t) => t.type === "MENTION")!.channels.push).toMatchObject({ enabled: false, available: false });
    // Both.
    await registerPushSubscription(sales, { endpoint: endpoint(), keys: KEYS });
    const on = await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    expect(on.types.find((t) => t.type === "MENTION")!.channels.push).toMatchObject({ enabled: true, available: true });
    expect(on.types.find((t) => t.type === "TASK_OVERDUE")?.channels.push).toMatchObject({ enabled: false, available: true });
    const off = await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: false } } });
    expect(off.types.find((t) => t.type === "MENTION")!.channels.push.enabled).toBe(false);
  });
});

describe("sending (FIG-1064: Web Push respecting preferences)", () => {
  async function ready(wantPush = true) {
    const { org, sales } = await setup();
    const { transport, sent } = fakeTransport();
    setPushTransport(transport);
    const device = await registerPushSubscription(sales, { endpoint: endpoint("phone"), keys: KEYS });
    if (wantPush) await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    return { org, sales, sent, device };
  }

  it("pushes a notification to each of the person's devices when they want push for that type", async () => {
    const { org, sales, sent } = await ready();
    await registerPushSubscription(sales, { endpoint: endpoint("tablet"), keys: KEYS });
    await mention(org.id, sales.membershipId, "m1");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.payload).toMatchObject({ title: "You were mentioned", body: "Someone mentioned you.", type: "MENTION", link: expect.stringContaining("/o/x/leads/1") });
    const note = await adminDb.notification.findFirstOrThrow({ where: { organizationId: org.id, membershipId: sales.membershipId } });
    expect(sent[0]!.payload.notificationId).toBe(note.id);
    expect((await adminDb.pushSubscription.findMany({ where: { organizationId: org.id } })).every((s) => s.lastSuccessAt !== null)).toBe(true);
  });

  it("does not push when the person did not ask for it, for another type, or has no device", async () => {
    const { org, sales, sent } = await ready(false);
    await mention(org.id, sales.membershipId, "m1");
    expect(sent).toHaveLength(0); // push not turned on for MENTION

    await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    await notifyEvent({ organizationId: org.id, membershipId: sales.membershipId, type: "RENEWAL_DUE", title: "r", body: "b", entityType: "RecurringService", entityId: "r1", path: "/o/x" });
    expect(sent).toHaveLength(0); // only MENTION is on

    const noDevice = await createTestContext(org.id, "SALES", "push.nodevice");
    await mention(org.id, noDevice.membershipId, "m2");
    expect(sent).toHaveLength(0);
    // The in-app notification is there regardless.
    expect(await adminDb.notification.count({ where: { organizationId: org.id, membershipId: noDevice.membershipId } })).toBe(1);
  });

  it("sends a notification once when the event repeats and the notification is the same one", async () => {
    const { org, sales, sent } = await ready();
    await updateMyNotificationPreferencesV2(sales, { types: { RENEWAL_DUE: { push: true } } });
    const renewal = () => notifyEvent({ organizationId: org.id, membershipId: sales.membershipId, type: "RENEWAL_DUE", title: "Renewal coming up", body: "It renews in 10 days.", entityType: "RecurringService", entityId: "svc-1:2026-12-01", path: "/o/x/companies/1" });
    await renewal();
    await renewal();
    expect(sent.filter((s) => s.payload.type === "RENEWAL_DUE")).toHaveLength(1);
  });

  it("stays quiet during the person's quiet hours, but the notification is still in the app", async () => {
    const { org, sales, sent } = await ready();
    await updateMyNotificationPreferencesV2(sales, { quietHours: { enabled: true, start: "00:00", end: "23:59" } });
    await mention(org.id, sales.membershipId, "quiet");
    expect(sent).toHaveLength(0);
    expect(await adminDb.notification.count({ where: { organizationId: org.id, membershipId: sales.membershipId } })).toBe(1);
  });

  it("redacts money for a role that may not see it, as the notification centre does", async () => {
    const { org, sales, sent } = await ready();
    await mention(org.id, sales.membershipId, "money", "Deal update", "The deal is now worth KES 1,250,000.");
    expect(sent[0]!.payload.body).not.toContain("1,250,000");
    expect(sent[0]!.payload.body).not.toContain("KES");
  });

  it("revokes a device the push service says is gone, and keeps the others", async () => {
    const { org, sales } = await setup();
    const gone = endpoint("gone");
    const { transport, sent } = fakeTransport((sub) => (sub.endpoint === gone ? 410 : "ok"));
    setPushTransport(transport);
    await registerPushSubscription(sales, { endpoint: gone, keys: KEYS });
    await registerPushSubscription(sales, { endpoint: endpoint("alive"), keys: KEYS });
    await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    await mention(org.id, sales.membershipId, "x1");
    expect(sent).toHaveLength(1);
    const rows = await adminDb.pushSubscription.findMany({ where: { organizationId: org.id } });
    expect(rows.filter((r) => r.revokedAt !== null)).toHaveLength(1);
    expect((await listMyPushSubscriptions(sales)).items).toHaveLength(1);
  });

  it(`revokes a device after ${MAX_PUSH_FAILURES} failures in a row, and a success resets the count`, async () => {
    const { org, sales } = await setup();
    let failing = true;
    setPushTransport({
      async send() {
        if (failing) throw Object.assign(new Error("temporarily unavailable"), { statusCode: 503 });
        return { statusCode: 201 };
      },
    });
    await registerPushSubscription(sales, { endpoint: endpoint("flaky"), keys: KEYS });
    await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    const row = () => adminDb.pushSubscription.findFirstOrThrow({ where: { organizationId: org.id } });
    for (let i = 0; i < MAX_PUSH_FAILURES - 1; i += 1) await mention(org.id, sales.membershipId, `fail-${i}`);
    expect(await row()).toMatchObject({ failureCount: MAX_PUSH_FAILURES - 1, revokedAt: null });
    failing = false;
    await mention(org.id, sales.membershipId, "recovered");
    expect(await row()).toMatchObject({ failureCount: 0, revokedAt: null });
    failing = true;
    for (let i = 0; i < MAX_PUSH_FAILURES; i += 1) await mention(org.id, sales.membershipId, `again-${i}`);
    expect((await row()).revokedAt).not.toBeNull();
  });

  it("a failing push service never breaks the notification or the action that raised it", async () => {
    const { org, sales } = await setup();
    setPushTransport({
      async send() {
        throw new Error("boom");
      },
    });
    await registerPushSubscription(sales, { endpoint: endpoint("broken"), keys: KEYS });
    await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    await expect(mention(org.id, sales.membershipId, "safe")).resolves.toBeUndefined();
    expect(await adminDb.notification.count({ where: { organizationId: org.id, membershipId: sales.membershipId } })).toBe(1);
  });

  it("never sends one organisation's notification to another organisation's device", async () => {
    const a = await setup();
    const b = await setup();
    const { transport, sent } = fakeTransport();
    setPushTransport(transport);
    const url = endpoint("shared");
    await registerPushSubscription(b.sales, { endpoint: url, keys: KEYS });
    await updateMyNotificationPreferencesV2(b.sales, { types: { MENTION: { push: true } } });
    await registerPushSubscription(a.sales, { endpoint: endpoint("a-own"), keys: KEYS });
    await updateMyNotificationPreferencesV2(a.sales, { types: { MENTION: { push: true } } });
    await mention(a.org.id, a.sales.membershipId, "a-only");
    expect(sent).toHaveLength(1);
    expect(sent.every((s) => s.endpoint !== url)).toBe(true);
  });

  it("the subscriptions table is protected by row-level security", async () => {
    const a = await setup();
    const b = await setup();
    await registerPushSubscription(a.sales, { endpoint: endpoint("rls"), keys: KEYS });
    const { withOrgContext } = await import("../src/db/orgScopedClient");
    expect(await withOrgContext(b.org.id, (tx) => tx.pushSubscription.findMany({}))).toHaveLength(0);
    await expect(
      withOrgContext(b.org.id, (tx) => tx.pushSubscription.create({ data: { organizationId: a.org.id, membershipId: a.sales.membershipId, endpoint: endpoint("smuggle"), p256dh: KEYS.p256dh, auth: KEYS.auth } })),
    ).rejects.toThrow();
  });
});
