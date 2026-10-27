import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { isInQuietHours, nextQuietEnd, startOfLocalDay, startOfNextLocalDay } from "../src/notifications/timeZone";
import { setOrganizationRelease } from "../src/services/featureService";
import * as notifications from "../src/services/notificationService";
import * as prefs from "../src/services/notificationPreferenceService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

vi.mock("../src/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notifications/email")>();
  return {
    ...actual,
    sendGenericNotificationEmail: vi.fn().mockResolvedValue(undefined),
    sendNotificationDigestEmail: vi.fn().mockResolvedValue(undefined),
    sendTaskOverdueEmail: vi.fn().mockResolvedValue(undefined),
    sendTaskDueEmail: vi.fn().mockResolvedValue(undefined),
    sendLeadAssignedEmail: vi.fn().mockResolvedValue(undefined),
  };
});
import * as email from "../src/notifications/email";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));
import * as v2Route from "../src/app/api/orgs/[orgSlug]/me/notification-preferences/route";
import * as legacyRoute from "../src/app/api/orgs/[orgSlug]/notification-preferences/route";

const params = { params: Promise.resolve({ orgSlug: "x" }) };
const NAIROBI = "Africa/Nairobi"; // UTC+3, no daylight saving

beforeEach(() => {
  vi.mocked(email.sendGenericNotificationEmail).mockResolvedValue(undefined);
  vi.mocked(email.sendNotificationDigestEmail).mockResolvedValue(undefined);
  vi.mocked(email.sendTaskOverdueEmail).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function setup(role = "SALES", tz: string | null = NAIROBI) {
  const org = await createTestOrganization("NotifV2");
  const ctx = await createTestContext(org.id, role, "nv2");
  if (tz) await adminDb.user.update({ where: { id: ctx.userId }, data: { timeZone: tz } });
  return { org, ctx };
}

let seq = 0;
function mention(ctx: AuthContext, label = `m${++seq}`) {
  return notifications.notifyEvent({
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    type: "MENTION",
    title: `You were mentioned in ${label}`,
    body: label,
    entityType: "Note",
    entityId: `${label}-${Math.random()}`,
    path: "/o/x/leads/1",
  });
}

function deliveriesFor(ctx: AuthContext) {
  return adminDb.notificationDelivery.findMany({
    where: { organizationId: ctx.organizationId, notification: { membershipId: ctx.membershipId } },
    orderBy: { createdAt: "asc" },
    include: { notification: true },
  });
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues ?? [];
  }
  throw new Error("Expected a validation error.");
}

describe("time zone arithmetic", () => {
  it("knows quiet hours that cross midnight and ones that do not", () => {
    const overnight = { enabled: true, start: "20:00", end: "07:00" };
    // 21:00, 02:00 and 06:59 in Nairobi are quiet; 07:00 and 12:00 are not.
    expect(isInQuietHours(new Date("2026-10-23T18:00:00Z"), overnight, NAIROBI)).toBe(true);
    expect(isInQuietHours(new Date("2026-10-23T23:00:00Z"), overnight, NAIROBI)).toBe(true);
    expect(isInQuietHours(new Date("2026-10-24T03:59:00Z"), overnight, NAIROBI)).toBe(true);
    expect(isInQuietHours(new Date("2026-10-24T04:00:00Z"), overnight, NAIROBI)).toBe(false);
    expect(isInQuietHours(new Date("2026-10-23T09:00:00Z"), overnight, NAIROBI)).toBe(false);
    const lunch = { enabled: true, start: "13:00", end: "14:00" };
    expect(isInQuietHours(new Date("2026-10-23T10:30:00Z"), lunch, NAIROBI)).toBe(true);
    expect(isInQuietHours(new Date("2026-10-23T11:00:00Z"), lunch, NAIROBI)).toBe(false);
    expect(isInQuietHours(new Date("2026-10-23T18:00:00Z"), { ...overnight, enabled: false }, NAIROBI)).toBe(false);
  });

  it("finds when quiet hours end, today or tomorrow", () => {
    const overnight = { enabled: true, start: "20:00", end: "07:00" };
    expect(nextQuietEnd(new Date("2026-10-23T18:00:00Z"), overnight, NAIROBI).toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(nextQuietEnd(new Date("2026-10-24T01:00:00Z"), overnight, NAIROBI).toISOString()).toBe("2026-10-24T04:00:00.000Z");
  });

  it("follows the person's own clock through a daylight-saving change", () => {
    const overnight = { enabled: true, start: "22:00", end: "07:00" };
    // New York leaves daylight time on 1 November 2026: 07:00 that morning is EST (UTC-5), not EDT.
    const evening = new Date("2026-11-01T03:00:00Z"); // 23:00 on 31 October, EDT
    expect(isInQuietHours(evening, overnight, "America/New_York")).toBe(true);
    expect(nextQuietEnd(evening, overnight, "America/New_York").toISOString()).toBe("2026-11-01T12:00:00.000Z");
    // The local day that contains the change is 25 hours long.
    const start = startOfLocalDay(new Date("2026-11-01T15:00:00Z"), "America/New_York");
    const next = startOfNextLocalDay(new Date("2026-11-01T15:00:00Z"), "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect((next.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("what applies to each role", () => {
  it("lists only the types a role can receive", async () => {
    const org = await createTestOrganization("NotifV2Roles");
    await setOrganizationRelease(org.id, "v1");
    const types = async (role: string) =>
      (await prefs.getMyNotificationPreferencesV2(await createTestContext(org.id, role, `nv2.${role.toLowerCase()}`))).types.map(
        (t) => t.type,
      );
    const sales = await types("SALES");
    expect(sales).toEqual(expect.arrayContaining(["LEAD_ASSIGNED", "TASK_DUE", "TASK_OVERDUE", "MENTION"]));
    const finance = await types("FINANCE");
    expect(finance).not.toContain("LEAD_ASSIGNED");
    expect(finance).toContain("MENTION");
    // Nobody is offered something they can never receive.
    for (const role of ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"]) {
      expect(await types(role), role).not.toContain("SUPPORT_ACCESS_REQUEST");
    }
    expect(await types("RESTRICTED_TECHNICAL")).not.toContain("LEAD_ASSIGNED");
  });

  it("offers support-access requests to Management once the release reaches V2", async () => {
    const org = await createTestOrganization("NotifV2Support");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "nv2.m");
    const sales = await createTestContext(org.id, "SALES", "nv2.s");
    await setOrganizationRelease(org.id, "v2");
    expect((await prefs.getMyNotificationPreferencesV2(mgmt)).types.map((t) => t.type)).toContain("SUPPORT_ACCESS_REQUEST");
    expect((await prefs.getMyNotificationPreferencesV2(sales)).types.map((t) => t.type)).not.toContain("SUPPORT_ACCESS_REQUEST");
  });

  it("rejects a type that does not apply to the role, and an unknown one", async () => {
    const { ctx } = await setup("FINANCE");
    const found = await issues(
      prefs.updateMyNotificationPreferencesV2(ctx, { types: { LEAD_ASSIGNED: { email: false }, NOPE: { email: false } } }),
    );
    expect(found.map((i) => i.code ?? i.message)).toEqual(["NOTIFICATION_NOT_FOR_ROLE", "\"NOPE\" is not a notification type."]);
  });
});

describe("presets and channels", () => {
  it("applies Everything, Important only and Off, and notices a custom mix", async () => {
    const { ctx } = await setup();
    const find = (v: Awaited<ReturnType<typeof prefs.getMyNotificationPreferencesV2>>, t: string) => v.types.find((x) => x.type === t)!;

    const important = await prefs.updateMyNotificationPreferencesV2(ctx, { preset: "IMPORTANT_ONLY" });
    expect(important.preset).toBe("IMPORTANT_ONLY");
    expect(find(important, "LEAD_ASSIGNED").channels.email.enabled).toBe(true);
    expect(find(important, "TASK_DUE").channels.email.enabled).toBe(false);
    expect(find(important, "TASK_DUE").channels.inApp.enabled).toBe(false);

    const off = await prefs.updateMyNotificationPreferencesV2(ctx, { preset: "OFF" });
    expect(off.preset).toBe("OFF");
    expect(find(off, "LEAD_ASSIGNED").channels.inApp.enabled).toBe(false);
    // Overdue stays on, even under Off.
    expect(find(off, "TASK_OVERDUE").channels.email.enabled).toBe(true);
    expect(find(off, "TASK_OVERDUE").channels.inApp).toMatchObject({ enabled: true, locked: true });

    const custom = await prefs.updateMyNotificationPreferencesV2(ctx, { types: { MENTION: { email: true } } });
    expect(custom.preset).toBe("CUSTOM");
    const everything = await prefs.updateMyNotificationPreferencesV2(ctx, { preset: "EVERYTHING" });
    expect(everything.preset).toBe("EVERYTHING");
    expect(everything.types.every((t) => t.channels.email.enabled && t.channels.inApp.enabled)).toBe(true);
  });

  it("a preset and individual choices can be sent together; the choices win", async () => {
    const { ctx } = await setup();
    const view = await prefs.updateMyNotificationPreferencesV2(ctx, {
      preset: "OFF",
      types: { MENTION: { inApp: true, email: false } },
    });
    const m = view.types.find((t) => t.type === "MENTION")!;
    expect(m.channels.inApp.enabled).toBe(true);
    expect(m.channels.email.enabled).toBe(false);
    expect(view.preset).toBe("CUSTOM");
  });

  it("overdue alerts cannot be turned off, in either endpoint, and an old 'off' row is ignored", async () => {
    const { ctx, org } = await setup();
    const found = await issues(prefs.updateMyNotificationPreferencesV2(ctx, { types: { TASK_OVERDUE: { email: false } } }));
    expect(found[0]).toMatchObject({ code: "NOTIFICATION_ALWAYS_ON", path: "types.TASK_OVERDUE" });
    const legacy = await issues(notifications.updateMyNotificationPreference(ctx, "TASK_OVERDUE", { inAppEnabled: false }));
    expect(legacy[0]!.code).toBe("NOTIFICATION_ALWAYS_ON");
    // A row written before this rule existed does not switch it off.
    await adminDb.notificationPreference.create({
      data: { organizationId: org.id, membershipId: ctx.membershipId, type: "TASK_OVERDUE", emailEnabled: false, inAppEnabled: false },
    });
    expect((await notifications.getMyNotificationPreferences(ctx)).TASK_OVERDUE).toEqual({ emailEnabled: true, inAppEnabled: true });
    // Turning overdue on explicitly is fine.
    await prefs.updateMyNotificationPreferencesV2(ctx, { types: { TASK_OVERDUE: { email: true, inApp: true } } });
  });

  it("stores push but will not turn it on yet", async () => {
    const { ctx } = await setup();
    const found = await issues(prefs.updateMyNotificationPreferencesV2(ctx, { types: { MENTION: { push: true } } }));
    expect(found[0]).toMatchObject({ code: "PUSH_NOT_AVAILABLE", path: "types.MENTION.push" });
    expect(found[0]!.message).toContain("mobile app");
    const ok = await prefs.updateMyNotificationPreferencesV2(ctx, { types: { MENTION: { push: false } } });
    expect(ok.types.find((t) => t.type === "MENTION")!.channels.push).toMatchObject({ enabled: false, available: false });
  });

  it("audits changes, and a no-op writes nothing", async () => {
    const { ctx, org } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { preset: "IMPORTANT_ONLY", dailyEmailCap: 5 });
    await prefs.updateMyNotificationPreferencesV2(ctx, {});
    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "notification_preferences.updated" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.newValue).toMatchObject({ preset: "IMPORTANT_ONLY", dailyEmailCap: 5 });
  });

  it("keeps the older endpoint working, now across all twelve types (payment overdue and dormant customer were added in Stage 3)", async () => {
    const { ctx } = await setup();
    current.ctx = ctx;
    const get = await legacyRoute.GET(new Request("http://x"), params);
    expect(Object.keys(await get.json())).toHaveLength(12);
    const post = await legacyRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ type: "MENTION", emailEnabled: false }) }),
      params,
    );
    expect(post.status).toBe(200);
    const overdue = await legacyRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ type: "TASK_OVERDUE", emailEnabled: false }) }),
      params,
    );
    expect(overdue.status).toBe(400);
  });
});

describe("quiet hours", () => {
  it("validates the settings and defaults to off", async () => {
    const { ctx } = await setup();
    const fresh = await prefs.getMyNotificationPreferencesV2(ctx);
    expect(fresh.quietHours).toEqual({ enabled: false, start: "20:00", end: "07:00", timeZone: NAIROBI });
    expect(fresh.dailyEmailCap).toBe(20);
    const bad = await issues(prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { start: "25:00", end: "7am" } }));
    expect(bad.map((i) => i.path).sort()).toEqual(["quietHours.end", "quietHours.start"]);
    const same = await issues(prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true, start: "08:00", end: "08:00" } }));
    expect(same[0]!.path).toBe("quietHours");
    const ok = await prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true, start: "21:30", end: "06:00" } });
    expect(ok.quietHours).toMatchObject({ enabled: true, start: "21:30", end: "06:00" });
  });

  it("holds the email until quiet hours end, while the in-app notification is immediate", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T18:00:00Z")); // 21:00 in Nairobi

    await mention(ctx);
    const [delivery] = await deliveriesFor(ctx);
    expect(delivery!.notification!.readAt).toBeNull(); // the in-app row exists at once
    expect(delivery!.status).toBe("PENDING");
    expect(delivery!.nextAttemptAt.toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(email.sendGenericNotificationEmail).not.toHaveBeenCalled();

    // The sweep before the window ends does nothing; after it, the email goes out.
    vi.setSystemTime(new Date("2026-10-24T03:00:00Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendGenericNotificationEmail).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-24T04:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(1);
    expect((await deliveriesFor(ctx))[0]!.status).toBe("SENT");
    // Sweeping again sends nothing twice.
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("sends at once outside quiet hours", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z")); // noon in Nairobi
    await mention(ctx);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("uses the organisation's time zone when the person has none", async () => {
    const { ctx, org } = await setup("SALES", null);
    await adminDb.organization.update({ where: { id: org.id }, data: { timezone: NAIROBI } });
    await prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T18:00:00Z"));
    await mention(ctx);
    expect(email.sendGenericNotificationEmail).not.toHaveBeenCalled();
  });

  it("defers an overdue email too: it is never silenced, but it does not wake you", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { quietHours: { enabled: true } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T18:00:00Z"));
    await notifications.notifyTaskOverdue(ctx.organizationId, ctx.membershipId, { id: "t-1", title: "Call Acme" });
    expect(email.sendTaskOverdueEmail).not.toHaveBeenCalled();
    expect(await adminDb.notification.count({ where: { membershipId: ctx.membershipId, type: "TASK_OVERDUE" } })).toBe(1);
    vi.setSystemTime(new Date("2026-10-24T04:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendTaskOverdueEmail).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the person has the channel off, quiet hours or not", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { types: { MENTION: { email: false } } });
    await mention(ctx);
    expect(await deliveriesFor(ctx)).toHaveLength(0);
    expect(await adminDb.notification.count({ where: { membershipId: ctx.membershipId, type: "MENTION" } })).toBe(1);
  });
});

describe("daily email cap and digest", () => {
  it("validates the limit", async () => {
    const { ctx } = await setup();
    for (const bad of [0, 201, 2.5, -1]) {
      expect((await issues(prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: bad })))[0]!.path).toBe("dailyEmailCap");
    }
    expect((await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 1 })).dailyEmailCap).toBe(1);
    expect((await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 200 })).dailyEmailCap).toBe(200);
  });

  it("holds emails past the cap and sends them as one digest the next day", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 2 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
    for (let i = 0; i < 5; i++) await mention(ctx, `item-${i}`);

    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(2);
    const held = (await deliveriesFor(ctx)).filter((d) => d.digestPending);
    expect(held).toHaveLength(3);
    // Held until the start of the next day in Nairobi: midnight is 21:00 UTC.
    expect(held[0]!.nextAttemptAt.toISOString()).toBe("2026-10-23T21:00:00.000Z");
    expect((await prefs.getMyNotificationPreferencesV2(ctx)).heldForDigest).toBe(3);
    expect((await prefs.getMyNotificationPreferencesV2(ctx)).emailsToday).toBe(2);

    // Nothing more goes out the same day.
    vi.setSystemTime(new Date("2026-10-23T20:00:00Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-10-23T21:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).toHaveBeenCalledTimes(1);
    const [, args] = vi.mocked(email.sendNotificationDigestEmail).mock.calls[0]!;
    expect(args.items.map((i) => i.body).sort()).toEqual(["item-2", "item-3", "item-4"]);
    expect((await deliveriesFor(ctx)).every((d) => d.status === "SENT")).toBe(true);

    // Once only.
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).toHaveBeenCalledTimes(1);
    expect((await prefs.getMyNotificationPreferencesV2(ctx)).heldForDigest).toBe(0);
  });

  it("does not hold overdue emails: they are exempt from the cap", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
    await mention(ctx);
    await mention(ctx); // held
    await notifications.notifyTaskOverdue(ctx.organizationId, ctx.membershipId, { id: "t-2", title: "Send invoice" });
    expect(email.sendTaskOverdueEmail).toHaveBeenCalledTimes(1);
    expect((await deliveriesFor(ctx)).filter((d) => d.digestPending)).toHaveLength(1);
  });

  it("counts the person's own day: a new local day starts a fresh allowance", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T20:50:00Z")); // 23:50 in Nairobi
    await mention(ctx);
    await mention(ctx);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-23T21:10:00Z")); // 00:10 next day
    await mention(ctx);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(2);
  });

  it("an overnight backlog released in the morning still respects the cap", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 2, quietHours: { enabled: true } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T19:00:00Z"));
    for (let i = 0; i < 5; i++) await mention(ctx, `night-${i}`);
    expect(email.sendGenericNotificationEmail).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-10-24T04:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendGenericNotificationEmail).toHaveBeenCalledTimes(2);
    expect((await deliveriesFor(ctx)).filter((d) => d.digestPending)).toHaveLength(3);

    // The digest is due at the next local midnight, which is inside quiet hours, so it waits for 07:00.
    vi.setSystemTime(new Date("2026-10-24T21:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-25T04:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps two people's digests apart", async () => {
    const org = await createTestOrganization("NotifV2Two");
    const a = await createTestContext(org.id, "SALES", "nv2.a");
    const b = await createTestContext(org.id, "SALES", "nv2.b");
    for (const c of [a, b]) {
      await adminDb.user.update({ where: { id: c.userId }, data: { timeZone: NAIROBI } });
      await prefs.updateMyNotificationPreferencesV2(c, { dailyEmailCap: 1 });
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
    await mention(a);
    await mention(a);
    await mention(b);
    await mention(b);
    await mention(b);
    vi.setSystemTime(new Date("2026-10-23T21:00:01Z"));
    await notifications.retryDueDeliveries(org.id);
    expect(email.sendNotificationDigestEmail).toHaveBeenCalledTimes(2);
    const sizes = vi.mocked(email.sendNotificationDigestEmail).mock.calls.map(([, args]) => args.items.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("a failing digest is retried, not lost", async () => {
    const { ctx } = await setup();
    await prefs.updateMyNotificationPreferencesV2(ctx, { dailyEmailCap: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
    await mention(ctx);
    await mention(ctx);
    vi.mocked(email.sendNotificationDigestEmail).mockRejectedValueOnce(new Error("SMTP down"));
    vi.setSystemTime(new Date("2026-10-23T21:00:01Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    const held = (await deliveriesFor(ctx)).filter((d) => d.digestPending);
    expect(held[0]).toMatchObject({ status: "FAILED", attempts: 1 });
    // Backoff of a minute, then the next sweep succeeds.
    vi.setSystemTime(new Date("2026-10-23T21:10:00Z"));
    await notifications.retryDueDeliveries(ctx.organizationId);
    expect(email.sendNotificationDigestEmail).toHaveBeenCalledTimes(2);
    expect((await deliveriesFor(ctx)).filter((d) => d.digestPending)[0]!.status).toBe("SENT");
  });
});

describe("routes and isolation", () => {
  it("serves and updates through the route, with field errors", async () => {
    const { ctx } = await setup();
    current.ctx = ctx;
    const get = await v2Route.GET(new Request("http://x"), params);
    expect(get.status).toBe(200);
    expect(Object.keys(await get.json()).sort()).toEqual(
      ["dailyEmailCap", "dailyEmailCapRange", "emailsToday", "heldForDigest", "preset", "presets", "quietHours", "types"].sort(),
    );
    const bad = await v2Route.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ types: { TASK_OVERDUE: { inApp: false } } }) }),
      params,
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).fieldErrors[0].code).toBe("NOTIFICATION_ALWAYS_ON");
    const unknown = await v2Route.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ colour: 1 }) }), params);
    expect(unknown.status).toBe(400);
  });

  it("settings are tenant-isolated and the cap is bounded in the database", async () => {
    const a = await setup();
    const b = await setup();
    await prefs.updateMyNotificationPreferencesV2(a.ctx, { dailyEmailCap: 7 });
    expect(await withOrgContext(b.org.id, (tx) => tx.notificationSetting.findMany({ where: { membershipId: a.ctx.membershipId } }))).toEqual([]);
    expect(await getUnscopedAppClientForTests().notificationSetting.findMany()).toEqual([]);
    await expect(
      adminDb.notificationSetting.create({ data: { organizationId: b.org.id, membershipId: b.ctx.membershipId, dailyEmailCap: 0 } }),
    ).rejects.toThrow();
    await expect(
      withOrgContext(b.org.id, (tx) => tx.notificationSetting.create({ data: { organizationId: b.org.id, membershipId: a.ctx.membershipId } })),
    ).rejects.toThrow();
  });
});
