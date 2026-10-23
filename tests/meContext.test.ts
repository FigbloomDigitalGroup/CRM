import { afterEach, describe, expect, it, vi } from "vitest";
import { MeContextSchema } from "../src/api/dto/meContext";
import type { Identity } from "../src/auth/requestContext";
import { UnauthorizedError } from "../src/auth/errors";
import { DEV_PLATFORM_COOKIE_NAME, createPlatformCookieValue } from "../src/auth/devSession";
import { createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { setOrganizationRelease } from "../src/services/featureService";
import { clearMeContextCache } from "../src/services/meContextCache";
import { WORKSPACE_LABELS } from "../src/services/meContextService";
import { changeMemberRole } from "../src/services/membershipService";
import { updateOrganizationLook } from "../src/services/organizationLookService";
import { updateMyPreferences } from "../src/services/preferenceService";
import { updateMyProfile } from "../src/services/profileService";
import { extendMySession } from "../src/services/sessionService";
import { createTestContext, createTestMembership, createTestOrganization, createTestUser } from "./helpers/fixtures";

const who: { identity: Identity | null } = { identity: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...original,
    resolveUserContext: async () => {
      if (!who.identity) throw new UnauthorizedError();
      return who.identity;
    },
  };
});
const cookieJar: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.value && name === DEV_PLATFORM_COOKIE_NAME ? { value: cookieJar.value } : undefined),
  }),
}));

import * as contextRoute from "../src/app/api/me/context/route";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Removed again: the dev-account tests assert on the dev rows that exist.
const platformIds: string[] = [];
afterEach(async () => {
  await adminDb.platformIdentity.deleteMany({ where: { id: { in: platformIds.splice(0) } } });
  vi.useRealTimers();
  vi.unstubAllEnvs();
  cookieJar.value = undefined;
  who.identity = null;
});

async function call(identity: Identity, query = "") {
  who.identity = identity;
  return contextRoute.GET(new Request(`http://x/api/me/context${query}`));
}

async function asUser(userId: string, withSession = false): Promise<Identity> {
  if (!withSession) return { userId, session: null, sessionToken: null };
  const created = await createSession(userId, { client: { userAgent: CHROME_WIN, ipAddress: "203.0.113.9", place: "Nairobi, KE" } });
  const session = await adminDb.session.findUniqueOrThrow({ where: { id: created.sessionId } });
  return { userId, session, sessionToken: created.token };
}

describe("the contract", () => {
  it("has exactly the same keys for all six roles, and each one validates", async () => {
    const org = await createTestOrganization("Ctx");
    const keySets = new Set<string>();
    for (const role of Object.keys(WORKSPACE_LABELS)) {
      const ctx = await createTestContext(org.id, role, `ctx.${role.toLowerCase()}`);
      const res = await call(await asUser(ctx.userId, true));
      expect(res.status, role).toBe(200);
      const body = await res.json();
      expect(MeContextSchema.safeParse(body).success, role).toBe(true);
      expect(body.kind).toBe("member");
      expect(body.role.key).toBe(role);
      expect(body.role.workspaceLabel).toBe(WORKSPACE_LABELS[role]);
      expect(body.organisation.id).toBe(org.id);
      expect(body.permissions).toEqual([...ctx.permissionKeys].sort());
      expect(body.supportView).toBeNull();
      keySets.add(JSON.stringify(Object.keys(body)));
      keySets.add(JSON.stringify(Object.keys(body.timeZone)));
    }
    // One key list for the top level, one for the time zone block: no role has a different shape.
    expect(keySets.size).toBe(2);
  });

  it("describes the shell: organisation, look, preferences, features, session and sign-in", async () => {
    const org = await createTestOrganization("Ctx");
    await setOrganizationRelease(org.id, "v1.1");
    const sales = await createTestContext(org.id, "SALES", "ctx.shape");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "ctx.mgmt");
    await updateOrganizationLook(mgmt, { displayName: "Figbloom Kenya", defaultTheme: "OCEAN" });
    await updateMyPreferences(sales, { startPage: "leads", hourFormat: "H24", density: "COMPACT" });

    const body = await (await call(await asUser(sales.userId, true))).json();
    expect(body.organisation).toMatchObject({ slug: org.slug, shownName: "Figbloom Kenya", allowPersonalisation: true });
    expect(body.look).toMatchObject({ source: "organisation", theme: "OCEAN", locked: false });
    expect(body.preferences).toMatchObject({
      startPage: { key: "leads", path: "/leads" },
      hourFormat: "H24",
      density: "COMPACT",
    });
    expect(body.features.release).toBe("v1.1");
    expect(body.features.flags["personalisation.allowed"]).toBe(true);
    expect(body.signedIn).toMatchObject({ device: "Chrome on Windows", place: "Nairobi, KE" });
    expect(body.signedIn.local).toMatch(/\d{2}:\d{2}/);
    expect(body.session.secondsLeft).toBeGreaterThan(7 * 3600);
    expect(body.session.warn).toBe(false);
    expect(body.membership.avatar).toMatchObject({ url: null });
    expect(body.organisations).toEqual([{ id: org.id, slug: org.slug, name: org.name, current: true }]);
  });

  it("shows the session running out: warns in the last five minutes, and Stay signed in resets it", async () => {
    const org = await createTestOrganization("Ctx");
    const ctx = await createTestContext(org.id, "SALES", "ctx.sess");
    const identity = await asUser(ctx.userId, true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(identity.session!.createdAt);
    vi.setSystemTime(new Date(identity.session!.expiresAt.getTime() - 4 * 60 * 1000));
    const near = await (await call(identity)).json();
    expect(near.session).toMatchObject({ warn: true, canExtend: true });
    expect(near.session.secondsLeft).toBeLessThanOrEqual(240);

    await extendMySession(ctx.userId, identity.session!.id);
    const refreshed = await adminDb.session.findUniqueOrThrow({ where: { id: identity.session!.id } });
    const after = await (await call({ ...identity, session: refreshed })).json();
    expect(after.session.warn).toBe(false);
    expect(after.session.secondsLeft).toBeGreaterThan(7 * 3600);
  });

  it("flags a personal time zone that differs from the organisation's", async () => {
    const org = await createTestOrganization("Ctx");
    const ctx = await createTestContext(org.id, "SALES", "ctx.tz");
    const before = await (await call(await asUser(ctx.userId))).json();
    expect(before.timeZone).toMatchObject({ user: null, organisation: org.timezone, effective: org.timezone, differsFromOrganisation: false });
    await updateMyProfile(ctx, { timeZone: "Europe/London" });
    const after = await (await call(await asUser(ctx.userId))).json();
    expect(after.timeZone).toMatchObject({ user: "Europe/London", effective: "Europe/London", differsFromOrganisation: true });
    await updateMyProfile(ctx, { timeZone: org.timezone });
    expect((await (await call(await asUser(ctx.userId))).json()).timeZone.differsFromOrganisation).toBe(false);
  });

  it("counts unread notifications", async () => {
    const org = await createTestOrganization("Ctx");
    const ctx = await createTestContext(org.id, "SALES", "ctx.unread");
    expect((await (await call(await asUser(ctx.userId))).json()).notifications.unread).toBe(0);
    await adminDb.notification.create({
      data: { organizationId: org.id, membershipId: ctx.membershipId, type: "MENTION", title: "Hi", body: "You were mentioned" },
    });
    expect((await (await call(await asUser(ctx.userId))).json()).notifications.unread).toBe(1);
  });
});

describe("accounts without access", () => {
  it("an account with no organisation gets the same shape, with the organisation sections empty", async () => {
    const user = await createTestUser("ctx.lonely");
    const res = await call(await asUser(user.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MeContextSchema.safeParse(body).success).toBe(true);
    expect(body.access).toMatchObject({ state: "awaitingAccess", awaitingAccess: true, reason: "NO_MEMBERSHIP" });
    for (const k of ["organisation", "membership", "role", "look", "preferences", "features", "signedIn", "session"]) {
      expect(body[k], k).toBeNull();
    }
    expect(body.permissions).toEqual([]);
    expect(body.organisations).toEqual([]);

    // Same keys as a full member.
    const org = await createTestOrganization("Ctx");
    const ctx = await createTestContext(org.id, "SALES", "ctx.full");
    const full = await (await call(await asUser(ctx.userId))).json();
    expect(Object.keys(body)).toEqual(Object.keys(full));
  });

  it("explains a pending invite", async () => {
    const org = await createTestOrganization("Ctx");
    const user = await createTestUser("ctx.invited");
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: role.id,
        status: "PENDING",
        invitedAt: new Date(),
        inviteTokenHash: `h-${user.id}`,
        inviteTokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const body = await (await call(await asUser(user.id))).json();
    expect(body.access).toMatchObject({ awaitingAccess: true, reason: "INVITE_PENDING" });
    expect(body.access.pendingInvites).toHaveLength(1);
    expect(body.access.pendingInvites[0]).toMatchObject({ organizationName: org.name, expired: false });
  });
});

describe("organisations", () => {
  it("lists every organisation, opens another with ?org=, and treats non-membership as not found", async () => {
    const a = await createTestOrganization("CtxA");
    const b = await createTestOrganization("CtxB");
    const other = await createTestOrganization("CtxC");
    const user = await createTestUser("ctx.multi");
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    for (const [i, org] of [a, b].entries()) {
      await adminDb.membership.create({
        data: { organizationId: org.id, userId: user.id, roleId: role.id, joinedAt: new Date(Date.now() + i) },
      });
    }
    const first = await (await call(await asUser(user.id))).json();
    expect(first.organisations.map((o: { slug: string; current: boolean }) => [o.slug, o.current])).toEqual([
      [a.slug, true],
      [b.slug, false],
    ]);
    const second = await (await call(await asUser(user.id), `?org=${b.slug}`)).json();
    expect(second.organisation.slug).toBe(b.slug);
    expect(second.organisations.find((o: { current: boolean }) => o.current).slug).toBe(b.slug);

    expect((await call(await asUser(user.id), `?org=${other.slug}`)).status).toBe(404);
    expect((await call(await asUser(user.id), `?org=nope`)).status).toBe(404);
  });
});

describe("cache", () => {
  it("serves the slow half from cache until something changes it", async () => {
    clearMeContextCache();
    const org = await createTestOrganization("Ctx");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "ctx.cm");
    const sales = await createTestContext(org.id, "SALES", "ctx.cs");
    const read = async () => (await (await call(await asUser(sales.userId))).json());

    expect((await read()).organisation.shownName).toBe(org.name);
    // A change that bypasses the services is not seen while the cache is warm...
    await adminDb.organization.update({ where: { id: org.id }, data: { displayName: "Hidden Change" } });
    expect((await read()).organisation.shownName).toBe(org.name);
    // ...but anything that goes through the service invalidates the organisation at once.
    await updateOrganizationLook(mgmt, { defaultTheme: "TEAL" });
    const afterLook = await read();
    expect(afterLook.look.theme).toBe("TEAL");
    expect(afterLook.organisation.shownName).toBe("Hidden Change");
  });

  it("is invalidated by preference, profile and role changes", async () => {
    clearMeContextCache();
    const org = await createTestOrganization("Ctx");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "ctx.im");
    const sales = await createTestContext(org.id, "SALES", "ctx.is");
    const read = async () => (await (await call(await asUser(sales.userId))).json());
    await read();

    await updateMyPreferences(sales, { density: "COMPACT" });
    expect((await read()).preferences.density).toBe("COMPACT");
    await updateMyProfile(sales, { name: "Renamed Person" });
    expect((await read()).user.name).toBe("Renamed Person");
    await changeMemberRole(mgmt, sales.membershipId, "FINANCE");
    const afterRole = await read();
    expect(afterRole.role.key).toBe("FINANCE");
    expect(afterRole.role.workspaceLabel).toBe("Finance workspace");
  });

  it("expires on its own, and can be switched off", async () => {
    clearMeContextCache();
    const org = await createTestOrganization("Ctx");
    const sales = await createTestContext(org.id, "SALES", "ctx.ttl");
    const read = async () => (await (await call(await asUser(sales.userId))).json());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));
    await read();
    await adminDb.organization.update({ where: { id: org.id }, data: { displayName: "Changed Elsewhere" } });
    vi.setSystemTime(new Date("2026-10-23T09:00:10Z"));
    expect((await read()).organisation.shownName).toBe(org.name);
    vi.setSystemTime(new Date("2026-10-23T09:00:16Z"));
    expect((await read()).organisation.shownName).toBe("Changed Elsewhere");

    vi.stubEnv("ME_CONTEXT_CACHE_MS", "0");
    await adminDb.organization.update({ where: { id: org.id }, data: { displayName: "Instant" } });
    expect((await read()).organisation.shownName).toBe("Instant");
  });
});

describe("Platform Super Admin variant", () => {
  it("is returned for the dev platform session, and nothing else sees it", async () => {
    const none = await contextRoute.GET(new Request("http://x/api/me/context"));
    expect(none.status).toBe(401);

    const identity = await adminDb.platformIdentity.create({
      data: { email: `ctx.${Math.random().toString(36).slice(2)}@platform.test`, name: "Platform Dev", isDev: true },
    });
    platformIds.push(identity.id);
    cookieJar.value = createPlatformCookieValue(identity.id);
    // Outside development the cookie is ignored.
    expect((await contextRoute.GET(new Request("http://x/api/me/context"))).status).toBe(401);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const res = await contextRoute.GET(new Request("http://x/api/me/context"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MeContextSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ kind: "platform", identity: { email: identity.email, dev: true }, uiMode: "LIGHT" });
    expect(Object.keys(body)).not.toContain("permissions");
    expect(Object.keys(body)).not.toContain("organisation");
  });
});

describe("isolation", () => {
  it("never mixes two people's contexts, even in the same organisation", async () => {
    clearMeContextCache();
    const org = await createTestOrganization("Ctx");
    const { user: u1 } = await createTestMembership(org.id, "SALES", "ctx.p1");
    const { user: u2 } = await createTestMembership(org.id, "FINANCE", "ctx.p2");
    const [a, b] = await Promise.all([call(await asUser(u1.id)), call(await asUser(u2.id))]);
    const [ba, bb] = [await a.json(), await b.json()];
    expect(ba.user.id).toBe(u1.id);
    expect(bb.user.id).toBe(u2.id);
    expect(ba.role.key).toBe("SALES");
    expect(bb.role.key).toBe("FINANCE");
  });
});
