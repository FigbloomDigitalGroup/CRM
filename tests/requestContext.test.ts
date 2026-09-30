import { afterEach, describe, expect, it } from "vitest";
import { DEV_SESSION_COOKIE_NAME, createSessionCookieValue } from "../src/auth/devSession";
import {
  getCurrentUserId,
  resolveRequestContext,
  type CookieReader,
} from "../src/auth/requestContext";
import {
  NoActiveMembershipError,
  NotFoundError,
  UnauthorizedError,
} from "../src/auth/errors";
import { hashPassword } from "../src/auth/password";
import { SESSION_COOKIE_NAME } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import {
  createTestMembership,
  createTestOrganization,
  createTestUser,
} from "./helpers/fixtures";

/**
 * Exercises `resolveRequestContext`/`getCurrentUserId` themselves -- every
 * other test in this suite goes through `createTestContext` (a fixtures.ts
 * shortcut straight to `resolveActiveMembership`), which never touches this
 * module's own job: turning a session cookie into that same context. A fake
 * `CookieReader` stands in for `next/headers`'s `cookies()`, which only
 * works inside a real Next.js request.
 */
function cookieReaderFrom(entries: Record<string, string>): CookieReader {
  return {
    get(name) {
      const value = entries[name];
      return value === undefined ? undefined : { value };
    },
  };
}

function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  setNodeEnv(originalNodeEnv);
});

async function createUserWithPassword(password: string) {
  const user = await createTestUser();
  const passwordHash = await hashPassword(password);
  await adminDb.user.update({ where: { id: user.id }, data: { passwordHash } });
  return user;
}

describe("resolveRequestContext: real session cookie", () => {
  it("resolves a logged-in user's real session cookie to their active membership", async () => {
    const org = await createTestOrganization();
    const password = "correct-horse-battery";
    const user = await createUserWithPassword(password);
    await adminDb.membership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: (await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } })).id,
        joinedAt: new Date(),
      },
    });

    const { token } = await authService.login(user.email, password);
    const ctx = await resolveRequestContext(
      org.slug,
      cookieReaderFrom({ [SESSION_COOKIE_NAME]: token }),
    );

    expect(ctx.userId).toBe(user.id);
    expect(ctx.organizationId).toBe(org.id);
  });

  it("throws UnauthorizedError when no cookie is present at all", async () => {
    const org = await createTestOrganization();
    await expect(
      resolveRequestContext(org.slug, cookieReaderFrom({})),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError for a garbage/forged session token", async () => {
    const org = await createTestOrganization();
    await expect(
      resolveRequestContext(
        org.slug,
        cookieReaderFrom({ [SESSION_COOKIE_NAME]: "not-a-real-token" }),
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError for a session that was revoked (e.g. logged out)", async () => {
    const org = await createTestOrganization();
    const password = "another-good-password";
    const user = await createUserWithPassword(password);
    await adminDb.membership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: (await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } })).id,
        joinedAt: new Date(),
      },
    });

    const { token } = await authService.login(user.email, password);
    await authService.logout(token);

    await expect(
      resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: token })),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws NotFoundError for an organization slug that doesn't exist", async () => {
    const password = "yet-another-password";
    const user = await createUserWithPassword(password);
    const { token } = await authService.login(user.email, password);

    await expect(
      resolveRequestContext(
        "no-such-org",
        cookieReaderFrom({ [SESSION_COOKIE_NAME]: token }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NoActiveMembershipError for a real, logged-in user with no membership in that org", async () => {
    const org = await createTestOrganization();
    const password = "no-membership-password";
    const user = await createUserWithPassword(password);
    const { token } = await authService.login(user.email, password);

    await expect(
      resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: token })),
    ).rejects.toThrow(NoActiveMembershipError);
  });
});

describe("resolveRequestContext / getCurrentUserId: dev-session fallback", () => {
  it("falls back to the dev-session cookie outside production when no real session cookie is present", async () => {
    setNodeEnv("test");
    const { user } = await createTestMembership(
      (await createTestOrganization()).id,
      "SALES",
    );

    const userId = await getCurrentUserId(
      cookieReaderFrom({
        [DEV_SESSION_COOKIE_NAME]: createSessionCookieValue(user.id),
      }),
    );
    expect(userId).toBe(user.id);
  });

  it("does NOT honor the dev-session cookie in production, even if present", async () => {
    setNodeEnv("production");
    const { user } = await createTestMembership(
      (await createTestOrganization()).id,
      "SALES",
    );

    const userId = await getCurrentUserId(
      cookieReaderFrom({
        [DEV_SESSION_COOKIE_NAME]: createSessionCookieValue(user.id),
      }),
    );
    expect(userId).toBeNull();
  });

  it("prefers a real session cookie over a dev-session cookie when both are present", async () => {
    setNodeEnv("test");
    const org = await createTestOrganization();
    const password = "prefers-real-session";
    const user = await createUserWithPassword(password);
    const otherUser = (await createTestMembership(org.id, "SALES")).user;
    const { token } = await authService.login(user.email, password);

    const userId = await getCurrentUserId(
      cookieReaderFrom({
        [SESSION_COOKIE_NAME]: token,
        [DEV_SESSION_COOKIE_NAME]: createSessionCookieValue(otherUser.id),
      }),
    );
    expect(userId).toBe(user.id);
  });
});
