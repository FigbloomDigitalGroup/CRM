import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeDevice, describePlace, isPrivateAddress } from "../src/auth/deviceInfo";
import { ForbiddenError, SessionExpiredError, ValidationError } from "../src/auth/errors";
import { hashPassword } from "../src/auth/password";
import {
  resolveMemberUserContext,
  resolveRequestContext,
  resolveUserContext,
  type CookieReader,
} from "../src/auth/requestContext";
import {
  createSession,
  lookupSession,
  SESSION_COOKIE_NAME,
} from "../src/auth/session";
import {
  DEFAULT_SESSION_LIFETIME_HOURS,
  HOUR_MS,
  MAX_ABSOLUTE_SESSION_HOURS,
} from "../src/auth/sessionPolicy";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { buildErrorResponse } from "../src/lib/apiErrors";
import * as authService from "../src/services/authService";
import * as sessionService from "../src/services/sessionService";
import * as signInEvents from "../src/services/signInEventService";
import {
  createTestContext,
  createTestOrganization,
  createTestUser,
} from "./helpers/fixtures";

const PASSWORD = "correct-horse-battery";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function uniqueIp(): string {
  return `203.0.113.${randomUUID().slice(0, 4)}`;
}

function cookieReaderFrom(entries: Record<string, string>): CookieReader {
  return {
    get(name) {
      const value = entries[name];
      return value === undefined ? undefined : { value };
    },
  };
}

/** A member of `organizationId` who can sign in with a known password. */
async function memberWithPassword(organizationId: string, roleKey: string) {
  const ctx = await createTestContext(organizationId, roleKey, "sess");
  await adminDb.user.update({
    where: { id: ctx.userId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  const user = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  return { ctx, user };
}

async function signIn(
  email: string,
  userAgent: string | null = CHROME_WIN,
  place: string | null = "Nairobi, KE",
) {
  return authService.login(email, PASSWORD, userAgent, uniqueIp(), place);
}

async function sessionIdOf(token: string) {
  const found = await lookupSession(token);
  if (found.state !== "active") throw new Error(`Expected an active session, got ${found.state}`);
  return found.session.id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("device and place labels", () => {
  it("names the browser and system, and degrades gracefully", () => {
    expect(describeDevice(CHROME_WIN)).toBe("Chrome on Windows");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari on iOS");
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/127.0")).toBe(
      "Firefox on macOS",
    );
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/126 Edg/126.0")).toBe("Edge on Windows");
    expect(describeDevice("curl/8.5.0")).toBe("curl");
    expect(describeDevice("")).toBe("Unknown device");
    expect(describeDevice(null)).toBe("Unknown device");
  });

  it("takes the place from edge headers, says 'Local network' for private addresses, and never calls out", () => {
    const headers = (entries: Record<string, string>) => ({
      get: (name: string) => entries[name.toLowerCase()] ?? null,
    });
    expect(describePlace("8.8.8.8", headers({ "x-vercel-ip-city": "Nairobi", "x-vercel-ip-country": "KE" }))).toBe(
      "Nairobi, KE",
    );
    expect(describePlace("8.8.8.8", headers({ "cf-ipcountry": "KE" }))).toBe("KE");
    expect(describePlace("192.168.1.20", headers({}))).toBe("Local network");
    expect(describePlace("8.8.8.8", headers({}))).toBeNull();
    for (const ip of ["10.0.0.1", "172.16.5.4", "127.0.0.1", "::1", "::ffff:192.168.0.9", "fe80::1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

describe("session lifetime policy (B1.04)", () => {
  it("defaults to 8 hours, records device/IP/place/organisation, and reports time left with a warning five minutes before the end", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const ip = uniqueIp();
    const { token, userId } = await authService.login(user.email, PASSWORD, CHROME_WIN, ip, "Nairobi, KE");

    const found = await lookupSession(token);
    if (found.state !== "active") throw new Error("expected active");
    const s = found.session;
    expect(s.userId).toBe(userId);
    expect(s.organizationId).toBe(org.id);
    expect(s.deviceLabel).toBe("Chrome on Windows");
    expect(s.ipAddress).toBe(ip);
    expect(s.place).toBe("Nairobi, KE");
    expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(DEFAULT_SESSION_LIFETIME_HOURS * HOUR_MS);
    expect(s.absoluteExpiresAt.getTime() - s.createdAt.getTime()).toBe(MAX_ABSOLUTE_SESSION_HOURS * HOUR_MS);

    const summary = await sessionService.getSessionSummary(userId, s.id);
    expect(summary.lifetimeHours).toBe(8);
    expect(summary.secondsLeft).toBeGreaterThan(8 * 3600 - 5);
    expect(summary.warn).toBe(false);
    expect(new Date(summary.warnAt).getTime()).toBe(s.expiresAt.getTime() - 5 * 60 * 1000);
    expect(summary.warnInSeconds).toBeGreaterThan(8 * 3600 - 5 * 60 - 5);
    expect(summary.canExtend).toBe(true);
    expect(summary.current).toBe(true);
  });

  it("lets Management pick 4, 8, 12 or 24 hours, applies it to new sign-ins, audits the change, and refuses anything else", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user } = await memberWithPassword(org.id, "SALES");

    expect((await sessionService.getSessionPolicy(mgmt)).lifetimeHours).toBe(8);
    const policy = await sessionService.updateSessionPolicy(mgmt, 4);
    expect(policy.lifetimeHours).toBe(4);
    expect(policy.options).toEqual([4, 8, 12, 24]);

    const { token, userId } = await signIn(user.email);
    const id = await sessionIdOf(token);
    expect((await sessionService.getSessionSummary(userId, id)).lifetimeHours).toBe(4);
    const row = await adminDb.session.findUniqueOrThrow({ where: { id } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(4 * HOUR_MS);

    for (const bad of [0, 5, 6, 48, -8]) {
      await expect(sessionService.updateSessionPolicy(mgmt, bad)).rejects.toThrow(ValidationError);
    }
    expect((await sessionService.getSessionPolicy(mgmt)).lifetimeHours).toBe(4);

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "security.session_policy_changed" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.previousValue).toEqual({ lifetimeHours: 8 });
    expect(audit[0]!.newValue).toEqual({ lifetimeHours: 4 });
  });

  it("is a Management setting: Sales can neither read nor change it, and each organisation has its own", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const sales = await createTestContext(orgA.id, "SALES");
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");

    await expect(sessionService.getSessionPolicy(sales)).rejects.toThrow(ForbiddenError);
    await expect(sessionService.updateSessionPolicy(sales, 12)).rejects.toThrow(ForbiddenError);

    await sessionService.updateSessionPolicy(mgmtA, 24);
    expect((await sessionService.getSessionPolicy(mgmtA)).lifetimeHours).toBe(24);
    expect((await sessionService.getSessionPolicy(mgmtB)).lifetimeHours).toBe(8);
  });
});

describe("expiry, warning and Stay signed in (clock-controlled)", () => {
  it("flags the warning five minutes before the end and ends the session exactly at expiry", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const { token, userId } = await signIn(user.email);
    const id = await sessionIdOf(token);
    const row = await adminDb.session.findUniqueOrThrow({ where: { id } });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(row.expiresAt.getTime() - 5 * 60 * 1000 - 1000));
    expect((await sessionService.getSessionSummary(userId, id)).warn).toBe(false);

    vi.setSystemTime(new Date(row.expiresAt.getTime() - 5 * 60 * 1000));
    const warned = await sessionService.getSessionSummary(userId, id);
    expect(warned.warn).toBe(true);
    expect(warned.warnInSeconds).toBe(0);
    expect(warned.secondsLeft).toBe(300);

    vi.setSystemTime(new Date(row.expiresAt.getTime() - 1));
    expect((await lookupSession(token)).state).toBe("active");

    vi.setSystemTime(row.expiresAt);
    const ended = await lookupSession(token);
    expect(ended).toEqual({ state: "expired", email: user.email });
  });

  it("answers an expired session with the structured SESSION_EXPIRED 401 and the email to prefill", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const { token } = await signIn(user.email);
    const id = await sessionIdOf(token);
    const row = await adminDb.session.findUniqueOrThrow({ where: { id } });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(row.expiresAt.getTime() + 1000));

    const cookies = cookieReaderFrom({ [SESSION_COOKIE_NAME]: token });
    const err = await resolveRequestContext(org.slug, cookies).catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err.reason).toBe("expired");

    const { status, body } = await buildErrorResponse(err, "req-1");
    expect(status).toBe(401);
    expect(body.code).toBe("SESSION_EXPIRED");
    expect(body.session).toEqual({ reason: "expired", email: user.email });

    await expect(resolveUserContext(cookies)).rejects.toThrow(SessionExpiredError);
  });

  it("does not mistake a missing or unknown cookie for an ended session", async () => {
    const { buildErrorResponse: build } = await import("../src/lib/apiErrors");
    const org = await createTestOrganization();
    const none = await resolveRequestContext(org.slug, cookieReaderFrom({})).catch((e) => e);
    expect((await build(none, "r")).body.code).toBe("UNAUTHORIZED");
    const unknown = await resolveRequestContext(
      org.slug,
      cookieReaderFrom({ [SESSION_COOKIE_NAME]: "never-issued" }),
    ).catch((e) => e);
    expect((await build(unknown, "r")).body.code).toBe("UNAUTHORIZED");
  });

  it("extends by one policy period from now and never past the absolute ceiling", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user } = await memberWithPassword(org.id, "SALES");
    await sessionService.updateSessionPolicy(mgmt, 24);

    const { token, userId } = await signIn(user.email);
    const id = await sessionIdOf(token);
    const start = await adminDb.session.findUniqueOrThrow({ where: { id } });
    const ceiling = start.absoluteExpiresAt.getTime();
    expect(ceiling - start.createdAt.getTime()).toBe(MAX_ABSOLUTE_SESSION_HOURS * HOUR_MS);

    vi.useFakeTimers({ toFake: ["Date"] });

    // Twenty hours in, with four left: Stay signed in resets to a full 24 hours.
    const t1 = start.createdAt.getTime() + 20 * HOUR_MS;
    vi.setSystemTime(t1);
    const first = await sessionService.extendMySession(userId, id);
    expect(first.extended).toBe(true);
    expect(new Date(first.session.expiresAt).getTime()).toBe(t1 + 24 * HOUR_MS);
    expect(first.session.secondsLeft).toBe(24 * 3600);
    expect(first.session.warn).toBe(false);

    // Keep clicking every 20 hours: it never runs past the ceiling.
    let now = t1;
    let last = first;
    for (let i = 0; i < 12; i++) {
      now += 20 * HOUR_MS;
      if (now >= ceiling) break;
      vi.setSystemTime(now);
      last = await sessionService.extendMySession(userId, id);
      expect(new Date(last.session.expiresAt).getTime()).toBeLessThanOrEqual(ceiling);
    }
    expect(new Date(last.session.expiresAt).getTime()).toBe(ceiling);
    expect(last.session.canExtend).toBe(false);

    // At the ceiling there is nothing left to give.
    const again = await sessionService.extendMySession(userId, id);
    expect(again.extended).toBe(false);
    expect(new Date(again.session.expiresAt).getTime()).toBe(ceiling);

    vi.setSystemTime(ceiling);
    expect((await lookupSession(token)).state).toBe("expired");
  });

  it("will not extend a session that has already ended or belongs to someone else", async () => {
    const org = await createTestOrganization();
    const a = await memberWithPassword(org.id, "SALES");
    const b = await memberWithPassword(org.id, "SALES");
    const { token } = await signIn(a.user.email);
    const id = await sessionIdOf(token);

    await expect(sessionService.extendMySession(b.user.id, id)).rejects.toThrow(/not found/i);

    const row = await adminDb.session.findUniqueOrThrow({ where: { id } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(row.expiresAt.getTime() + 1));
    await expect(sessionService.extendMySession(a.user.id, id)).rejects.toThrow(/not found/i);
  });
});

describe("revoking sessions", () => {
  it("logs a revoked device out on its very next request, with a 'revoked' session error", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const laptop = await signIn(user.email, CHROME_WIN, "Nairobi, KE");
    const phone = await signIn(user.email, SAFARI_IPHONE, "Mombasa, KE");
    const laptopId = await sessionIdOf(laptop.token);
    const phoneId = await sessionIdOf(phone.token);

    const listed = await sessionService.listMySessions(user.id, laptopId);
    expect(listed.map((s) => s.deviceLabel).sort()).toEqual(["Chrome on Windows", "Safari on iOS"]);
    expect(listed[0]!.current).toBe(true);
    expect(listed.find((s) => s.id === phoneId)!.place).toBe("Mombasa, KE");

    // Signed in from the phone: it works...
    const phoneCookies = cookieReaderFrom({ [SESSION_COOKIE_NAME]: phone.token });
    expect((await resolveRequestContext(org.slug, phoneCookies)).userId).toBe(user.id);

    // ...until the laptop revokes it.
    const result = await sessionService.revokeMySession(user.id, phoneId, laptopId);
    expect(result).toEqual({ revoked: true, wasCurrent: false });

    const err = await resolveRequestContext(org.slug, phoneCookies).catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err.reason).toBe("revoked");
    expect(err.email).toBe(user.email);
    expect((await buildErrorResponse(err, "r")).body.session).toEqual({ reason: "revoked", email: user.email });

    // The laptop is untouched, and the phone is gone from the list.
    expect((await resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: laptop.token }))).userId).toBe(user.id);
    expect((await sessionService.listMySessions(user.id, laptopId)).map((s) => s.id)).toEqual([laptopId]);
    const row = await adminDb.session.findUniqueOrThrow({ where: { id: phoneId } });
    expect(row.revokedReason).toBe("REVOKED");
  });

  it("signs out every other device but keeps this one", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const keep = await signIn(user.email);
    const others = [await signIn(user.email), await signIn(user.email, SAFARI_IPHONE)];
    const keepId = await sessionIdOf(keep.token);

    expect(await sessionService.signOutOtherSessions(user.id, keepId)).toEqual({ revokedCount: 2 });
    expect((await lookupSession(keep.token)).state).toBe("active");
    for (const o of others) expect((await lookupSession(o.token)).state).toBe("revoked");
    expect(await sessionService.signOutOtherSessions(user.id, keepId)).toEqual({ revokedCount: 0 });
  });

  it("only ever touches the caller's own sessions", async () => {
    const org = await createTestOrganization();
    const a = await memberWithPassword(org.id, "SALES");
    const b = await memberWithPassword(org.id, "SALES");
    const aSession = await signIn(a.user.email);
    const bSession = await signIn(b.user.email);
    const aId = await sessionIdOf(aSession.token);
    const bId = await sessionIdOf(bSession.token);

    await expect(sessionService.revokeMySession(a.user.id, bId, aId)).rejects.toThrow(/not found/i);
    await sessionService.signOutOtherSessions(a.user.id, aId);
    expect((await lookupSession(bSession.token)).state).toBe("active");
    expect((await sessionService.listMySessions(a.user.id, aId)).every((s) => s.id === aId)).toBe(true);
  });

  it("logout and password reset end sessions with their own reasons", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const one = await signIn(user.email);
    const two = await signIn(user.email);
    await authService.logout(one.token);
    expect((await lookupSession(one.token)).state).toBe("revoked");
    expect((await adminDb.session.findUniqueOrThrow({ where: { id: await adminDb.session.findFirstOrThrow({ where: { userId: user.id, revokedReason: "SIGNED_OUT" } }).then((s) => s.id) } })).revokedReason).toBe("SIGNED_OUT");

    const { createPasswordResetToken } = await import("../src/auth/passwordResetToken");
    const { token: resetToken } = await createPasswordResetToken(user.id);
    await authService.resetPassword(resetToken, "a-brand-new-password-1");
    expect((await lookupSession(two.token)).state).toBe("revoked");
    expect(await adminDb.session.count({ where: { userId: user.id, revokedReason: "PASSWORD_RESET" } })).toBe(1);
  });

  it("an account that is no longer active cannot use a session it still holds", async () => {
    const org = await createTestOrganization();
    const { user } = await memberWithPassword(org.id, "SALES");
    const { token } = await signIn(user.email);
    await adminDb.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });
    expect((await lookupSession(token)).state).toBe("revoked");
  });
});

describe("sign-in events (B1.04)", () => {
  it("records success with device and place, and a new-device event only for a device never seen before", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, ctx } = await memberWithPassword(org.id, "SALES");

    await signIn(user.email, CHROME_WIN, "Nairobi, KE");
    await signIn(user.email, CHROME_WIN, "Nairobi, KE");
    await signIn(user.email, SAFARI_IPHONE, "Mombasa, KE");

    const page = await signInEvents.listSignInEvents(mgmt, { membershipId: ctx.membershipId });
    const outcomes = page.items.map((e) => `${e.outcome}:${e.deviceLabel}`).sort();
    expect(outcomes).toEqual([
      "NEW_DEVICE:Safari on iOS",
      "SUCCESS:Chrome on Windows",
      "SUCCESS:Chrome on Windows",
      "SUCCESS:Safari on iOS",
    ]);
    const first = page.items.find((e) => e.outcome === "SUCCESS" && e.place === "Mombasa, KE")!;
    expect(first.userName).toBe("Test User");
    expect(first.email).toBe(user.email.toLowerCase());
    expect(first.ipAddress).toMatch(/^203\.0\.113\./);
    expect(page.total).toBe(4);
  });

  it("records failures, and does not log attempts at an email that has no account", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, ctx } = await memberWithPassword(org.id, "SALES");

    await expect(authService.login(user.email, "nope", CHROME_WIN, uniqueIp(), null)).rejects.toThrow();
    await expect(authService.login(`ghost-${randomUUID()}@example.test`, "nope", CHROME_WIN, uniqueIp())).rejects.toThrow();

    const failures = await signInEvents.listSignInEvents(mgmt, { outcome: "FAILURE" });
    expect(failures.items).toHaveLength(1);
    expect(failures.items[0]!.membershipId).toBe(ctx.membershipId);
    expect(failures.items[0]!.reason).toBe("WRONG_PASSWORD");
    expect(await adminDb.signInEvent.count({ where: { organizationId: null, email: { startsWith: "ghost-" } } })).toBe(0);
  });

  it("filters by user, outcome and date, and pages", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const a = await memberWithPassword(org.id, "SALES");
    const b = await memberWithPassword(org.id, "SALES");
    await signIn(a.user.email);
    await signIn(b.user.email);
    await signIn(b.user.email, SAFARI_IPHONE);
    await expect(authService.login(b.user.email, "wrong", CHROME_WIN, uniqueIp())).rejects.toThrow();

    expect((await signInEvents.listSignInEvents(mgmt, { membershipId: a.ctx.membershipId })).total).toBe(1);
    expect((await signInEvents.listSignInEvents(mgmt, { membershipId: b.ctx.membershipId })).total).toBe(4);
    expect((await signInEvents.listSignInEvents(mgmt, { outcome: "NEW_DEVICE" })).total).toBe(1);
    expect((await signInEvents.listSignInEvents(mgmt, { outcome: "SUCCESS" })).total).toBe(3);

    const tomorrow = new Date(Date.now() + 24 * HOUR_MS).toISOString();
    const yesterday = new Date(Date.now() - 24 * HOUR_MS).toISOString();
    expect((await signInEvents.listSignInEvents(mgmt, { from: tomorrow })).total).toBe(0);
    expect((await signInEvents.listSignInEvents(mgmt, { to: yesterday })).total).toBe(0);
    expect((await signInEvents.listSignInEvents(mgmt, { from: yesterday, to: tomorrow })).total).toBe(5);
    await expect(signInEvents.listSignInEvents(mgmt, { from: "not-a-date" })).rejects.toThrow(ValidationError);

    const first = await signInEvents.listSignInEvents(mgmt, {}, { page: 1, pageSize: 2 });
    const second = await signInEvents.listSignInEvents(mgmt, {}, { cursor: first.nextCursor ?? undefined, pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect(second.page).toBe(2);
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(4);
    // Newest first.
    expect(first.items[0]!.createdAt >= first.items[1]!.createdAt).toBe(true);
  });

  it("is visible to the owner and to Management only", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const sales = await memberWithPassword(org.id, "SALES");
    const peer = await memberWithPassword(org.id, "SALES");
    await signIn(sales.user.email);
    await signIn(peer.user.email);

    // Another member of the organisation cannot read the organisation's log...
    await expect(signInEvents.listSignInEvents(sales.ctx)).rejects.toThrow(ForbiddenError);
    // ...Management can...
    expect((await signInEvents.listSignInEvents(mgmt)).total).toBe(2);
    // ...and each person sees their own, and only their own.
    const mine = await signInEvents.listMySignInEvents(sales.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.userId).toBe(sales.user.id);
    expect(mine[0]!.email).toBe(sales.user.email.toLowerCase());
  });

  it("is tenant-scoped: another organisation's Management cannot see these events, and row-level security backs that up", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");
    const a = await memberWithPassword(orgA.id, "SALES");
    await signIn(a.user.email);

    expect((await signInEvents.listSignInEvents(mgmtA)).total).toBe(1);
    expect((await signInEvents.listSignInEvents(mgmtB)).total).toBe(0);
    // Pointing at A's member from B is a not-found, not a leak.
    await expect(
      signInEvents.listSignInEvents(mgmtB, { membershipId: a.ctx.membershipId }),
    ).rejects.toThrow(/not found/i);

    const fromB = await withOrgContext(orgB.id, (tx) =>
      tx.signInEvent.findMany({ where: { organizationId: orgA.id } }),
    );
    expect(fromB).toEqual([]);
    const noContext = await getUnscopedAppClientForTests().signInEvent.findMany({
      where: { organizationId: orgA.id },
    });
    expect(noContext).toEqual([]);
    expect(await withOrgContext(orgA.id, (tx) => tx.signInEvent.count())).toBe(1);
    // A cross-tenant write is refused too.
    await expect(
      withOrgContext(orgB.id, (tx) =>
        tx.signInEvent.create({ data: { organizationId: orgA.id, email: "x@example.test", outcome: "SUCCESS" } }),
      ),
    ).rejects.toThrow();
  });

  it("writes one copy per organisation for a person in two, each visible only to its own Management", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");
    const { user } = await memberWithPassword(orgA.id, "SALES");
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: user.id, roleId: role.id, joinedAt: new Date() },
    });

    await signIn(user.email);
    expect((await signInEvents.listSignInEvents(mgmtA)).total).toBe(1);
    expect((await signInEvents.listSignInEvents(mgmtB)).total).toBe(1);
    // The person themselves sees one sign-in, not two.
    expect(await signInEvents.listMySignInEvents(user.id)).toHaveLength(1);
  });
});

describe("row-level security on sessions", () => {
  it("hides one organisation's sessions from another's context and from no context at all", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const a = await memberWithPassword(orgA.id, "SALES");
    await signIn(a.user.email);

    expect(await withOrgContext(orgA.id, (tx) => tx.session.count({ where: { userId: a.user.id } }))).toBe(1);
    expect(await withOrgContext(orgB.id, (tx) => tx.session.count({ where: { userId: a.user.id } }))).toBe(0);
    expect(await getUnscopedAppClientForTests().session.count({ where: { userId: a.user.id } })).toBe(0);
    await expect(
      withOrgContext(orgB.id, (tx) => tx.session.updateMany({ where: { userId: a.user.id }, data: { revokedAt: new Date() } })),
    ).resolves.toMatchObject({ count: 0 });
    expect((await lookupSession((await signIn(a.user.email)).token)).state).toBe("active");
  });
});

describe("awaiting access (B1.12) and the personal endpoints", () => {
  it("lets a signed-up user with no membership sign out and reach their profile, but nothing member-only", async () => {
    const email = `new-${randomUUID()}@example.test`;
    const signup = await authService.signup(email, PASSWORD, "New Person", CHROME_WIN, uniqueIp(), "Nairobi, KE");
    expect(signup.access).toMatchObject({
      state: "awaitingAccess",
      awaitingAccess: true,
      reason: "NO_MEMBERSHIP",
      organizations: [],
    });
    const session = await lookupSession(signup.token);
    if (session.state !== "active") throw new Error("expected active");
    expect(session.session.organizationId).toBeNull();
    expect(session.session.expiresAt.getTime() - session.session.createdAt.getTime()).toBe(8 * HOUR_MS);

    const cookies = cookieReaderFrom({ [SESSION_COOKIE_NAME]: signup.token });
    // Identity-only calls work: profile, sessions, sign-out.
    expect((await resolveUserContext(cookies)).userId).toBe(signup.userId);
    expect((await sessionService.listMySessions(signup.userId, session.session.id)).length).toBe(1);
    // Anything that needs a membership says why.
    const blocked = await resolveMemberUserContext(cookies).catch((e) => e);
    expect((await buildErrorResponse(blocked, "r")).body.code).toBe("AWAITING_ACCESS");
    expect((await buildErrorResponse(blocked, "r")).status).toBe(403);
    // And any organisation's data is out of reach.
    const org = await createTestOrganization();
    await expect(resolveRequestContext(org.slug, cookies)).rejects.toThrow(/No active membership/);
    await authService.logout(signup.token);
    expect((await lookupSession(signup.token)).state).toBe("revoked");
  });

  it("returns the access state from login too, and creates a session without an organisation for them", async () => {
    const user = await createTestUser("awaiting");
    await adminDb.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const result = await signIn(user.email);
    expect(result.organizationSlug).toBeNull();
    expect(result.access.awaitingAccess).toBe(true);
  });

  it("createSession with a bare user agent string still works (older callers)", async () => {
    const user = await createTestUser("legacy");
    const created = await createSession(user.id, CHROME_WIN);
    expect(created.deviceLabel).toBe("Chrome on Windows");
    expect(created.isNewDevice).toBe(false);
    expect((await lookupSession(created.token)).state).toBe("active");
  });
});
