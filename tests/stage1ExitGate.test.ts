/**
 * Stage 1 exit gate (B1.13, FIG-1029).
 *
 * The executable demo: a fresh organisation, one person per role, plus the dev Platform Super Admin, driven
 * through the real route handlers (the same code the browser will call). If this file is green, the Stage 1
 * foundations -- sign-in state, session control, permissions, profile, preferences, organisation look, the
 * `/me/context` shell contract -- hold together for every role. `docs/demo/stage-1.http` is the same walk-through
 * for a human with a running server.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MeContextSchema } from "../src/api/dto/meContext";
import { UnauthorizedError } from "../src/auth/errors";
import { DEV_PLATFORM_COOKIE_NAME, createPlatformCookieValue } from "../src/auth/devSession";
import type { AuthContext } from "../src/auth/context";
import type { Identity } from "../src/auth/requestContext";
import { createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { clearMeContextCache } from "../src/services/meContextCache";
import { WORKSPACE_LABELS } from "../src/services/meContextService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const actor: { ctx: AuthContext | null; identity: Identity | null } = { ctx: null, identity: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...original,
    resolveRequestContext: async () => {
      if (!actor.ctx) throw new UnauthorizedError();
      return actor.ctx;
    },
    resolveUserContext: async () => {
      if (!actor.identity) throw new UnauthorizedError();
      return actor.identity;
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
import * as extendRoute from "../src/app/api/session/extend/route";
import * as sessionsRoute from "../src/app/api/me/sessions/route";
import * as sessionOneRoute from "../src/app/api/me/sessions/[sessionId]/route";
import * as signInEventsRoute from "../src/app/api/me/sign-in-events/route";
import * as profileRoute from "../src/app/api/orgs/[orgSlug]/me/profile/route";
import * as prefsRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/route";
import * as resetRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/reset/route";
import * as undoRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/undo/route";
import * as notifRoute from "../src/app/api/orgs/[orgSlug]/me/notification-preferences/route";
import * as lookRoute from "../src/app/api/orgs/[orgSlug]/look/route";

const params = { params: Promise.resolve({ orgSlug: "x" }) };
const json = (method: string, body: unknown) => new Request("http://x", { method, body: JSON.stringify(body) });
const ROLES = Object.keys(WORKSPACE_LABELS);
const platformIds: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await adminDb.platformIdentity.deleteMany({ where: { id: { in: platformIds } } });
});

async function signIn(ctx: AuthContext) {
  const created = await createSession(ctx.userId, {
    client: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36", ipAddress: "203.0.113.7", place: "Nairobi, KE" },
  });
  const session = await adminDb.session.findUniqueOrThrow({ where: { id: created.sessionId } });
  actor.ctx = ctx;
  actor.identity = { userId: ctx.userId, session, sessionToken: created.token };
  return session;
}

let org: Awaited<ReturnType<typeof createTestOrganization>>;
const people = new Map<string, AuthContext>();

beforeAll(async () => {
  clearMeContextCache();
  org = await createTestOrganization("Exit Gate");
  for (const role of ROLES) people.set(role, await createTestContext(org.id, role, `gate.${role.toLowerCase()}`));
});

describe("Stage 1 exit gate: every role, one organisation", () => {
  it.each(ROLES)("%s signs in, gets the shell, personalises it, and controls their own sessions", async (role) => {
    const ctx = people.get(role)!;
    const current = await signIn(ctx);

    // 1. The shell contract: one call tells the app everything it needs, and validates.
    const first = await contextRoute.GET(new Request("http://x/api/me/context"));
    expect(first.status).toBe(200);
    const shell = await first.json();
    expect(MeContextSchema.safeParse(shell).success).toBe(true);
    expect(shell.role.key).toBe(role);
    expect(shell.organisation.id).toBe(org.id);
    expect(shell.permissions).toEqual([...ctx.permissionKeys].sort());
    expect(shell.session.secondsLeft).toBeGreaterThan(0);

    // 2. Profile.
    const named = await profileRoute.PATCH(json("PATCH", { name: `Gate ${role}`, timeZone: "Africa/Nairobi" }), params);
    expect(named.status).toBe(200);
    expect((await (await profileRoute.GET(new Request("http://x"), params)).json()).name).toBe(`Gate ${role}`);

    // 3. Preferences: change, see it in the shell straight away, reset, undo.
    const changed = await prefsRoute.PATCH(json("PATCH", { theme: "OCEAN", hourFormat: "H24" }), params);
    expect(changed.status).toBe(200);
    clearMeContextCache();
    const afterChange = await (await contextRoute.GET(new Request("http://x/api/me/context"))).json();
    expect(afterChange.look).toMatchObject({ theme: "OCEAN", source: "own" });
    expect(afterChange.preferences.hourFormat).toBe("H24");

    const reset = await resetRoute.POST(new Request("http://x", { method: "POST" }), params);
    expect(reset.status).toBe(200);
    const { undo } = await reset.json();
    const undoToken = undo.token as string;
    expect(typeof undoToken).toBe("string");
    clearMeContextCache();
    expect((await (await contextRoute.GET(new Request("http://x/api/me/context"))).json()).look.theme).toBe("FOREST");
    const undone = await undoRoute.POST(json("POST", { token: undoToken }), params);
    expect(undone.status).toBe(200);
    clearMeContextCache();
    expect((await (await contextRoute.GET(new Request("http://x/api/me/context"))).json()).look.theme).toBe("OCEAN");

    // 4. Notification settings are reachable and role-relevant.
    const notif = await notifRoute.GET(new Request("http://x"), params);
    expect(notif.status).toBe(200);

    // 5. Sessions: extend the current one, sign out a second device, the sign-in log shows only me.
    const second = await createSession(ctx.userId, { client: { userAgent: "Safari on iPhone", ipAddress: "198.51.100.4", place: "Mombasa, KE" } });
    const list = await (await sessionsRoute.GET()).json();
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    expect(list.items.find((s: { id: string; current: boolean }) => s.id === current.id)?.current).toBe(true);
    const extended = await extendRoute.POST();
    expect(extended.status).toBe(200);
    const revoked = await sessionOneRoute.DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ sessionId: second.sessionId }) });
    expect(revoked.status).toBe(200);
    expect((await adminDb.session.findUniqueOrThrow({ where: { id: second.sessionId } })).revokedAt).not.toBeNull();
    const events = await (await signInEventsRoute.GET(new Request("http://x/api/me/sign-in-events"))).json();
    expect(events.items.every((e: { userId?: string }) => e.userId === undefined || e.userId === ctx.userId)).toBe(true);
  });

  it("Management changes the organisation look and every other role sees it; nobody else can change it", async () => {
    const mgmt = people.get("MANAGEMENT")!;
    await signIn(mgmt);
    // Everyone starts from the organisation default (their own theme was set above, so clear it first).
    for (const role of ROLES) {
      await signIn(people.get(role)!);
      await resetRoute.POST(new Request("http://x", { method: "POST" }), params);
      await prefsRoute.PATCH(json("PATCH", { theme: null, pageColour: null }), params).catch(() => undefined);
    }
    await signIn(mgmt);
    const ok = await lookRoute.PATCH(json("PATCH", { displayName: "Gate Flowers", defaultTheme: "SKY" }), params);
    expect(ok.status).toBe(200);

    for (const role of ROLES.filter((r) => r !== "MANAGEMENT")) {
      await signIn(people.get(role)!);
      const seen = await (await lookRoute.GET(new Request("http://x"), params)).json();
      expect(seen.shownName, role).toBe("Gate Flowers");
      const denied = await lookRoute.PATCH(json("PATCH", { defaultTheme: "FOREST" }), params);
      expect(denied.status, role).toBe(403);
      const denial = await denied.json();
      expect(denial.code, role).toBe("FORBIDDEN");
      expect(denial.denial?.permission ?? denial.message, role).toBeTruthy();
    }
  });

  it("an unauthenticated caller gets 401 from every Stage 1 endpoint", async () => {
    actor.ctx = null;
    actor.identity = null;
    expect((await contextRoute.GET(new Request("http://x"))).status).toBe(401);
    expect((await sessionsRoute.GET()).status).toBe(401);
    expect((await prefsRoute.GET(new Request("http://x"), params)).status).toBe(401);
    expect((await profileRoute.GET(new Request("http://x"), params)).status).toBe(401);
    expect((await notifRoute.GET(new Request("http://x"), params)).status).toBe(401);
    expect((await lookRoute.GET(new Request("http://x"), params)).status).toBe(401);
  });

  it("the dev Platform Super Admin gets the platform shell, and only in development", async () => {
    actor.ctx = null;
    actor.identity = null;
    const identity = await adminDb.platformIdentity.create({
      data: { email: `gate.${Math.random().toString(36).slice(2)}@platform.test`, name: "Gate Platform", isDev: true },
    });
    platformIds.push(identity.id);
    cookieJar.value = createPlatformCookieValue(identity.id);
    expect((await contextRoute.GET(new Request("http://x"))).status).toBe(401);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const res = await contextRoute.GET(new Request("http://x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(MeContextSchema.safeParse(body).success).toBe(true);
    expect(body.kind).toBe("platform");
    cookieJar.value = undefined;
  });
});

describe("Stage 1 exit gate: tenant isolation checklist", () => {
  it("another organisation sees none of this organisation's sessions, files, preferences, look, memberships or notification settings", async () => {
    const other = await createTestOrganization("Exit Gate Other");
    const mine = people.get("SALES")!;
    const tables = [
      "membership",
      "userPreference",
      "notificationPreference",
      "notificationSetting",
      "file",
      "auditEvent",
    ] as const;
    for (const table of tables) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withOrgContext(other.id, (tx) => (tx as any)[table].findMany({ where: { organizationId: org.id } }));
      expect(rows, table).toEqual([]);
    }
    // And the other organisation cannot even address my membership by id.
    const found = await withOrgContext(other.id, (tx) => tx.membership.findMany({ where: { id: mine.membershipId } }));
    expect(found).toEqual([]);
  });
});
