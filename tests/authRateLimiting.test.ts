import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password";
import { RateLimitedError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import { createTestUser } from "./helpers/fixtures";

const PASSWORD = "correct-horse-battery";

async function createUserWithPassword(password = PASSWORD) {
  const user = await createTestUser();
  const passwordHash = await hashPassword(password);
  await adminDb.user.update({ where: { id: user.id }, data: { passwordHash } });
  return user;
}

/** A fresh fake IP per test -- rate limiting is IP-scoped, and the test DB
 * persists across runs, so a literal reused IP would collide the same way
 * it does in tests/websiteAbuseProtection.test.ts. */
function uniqueIp(): string {
  return `198.51.100.${randomUUID().slice(0, 2)}-${randomUUID().slice(0, 6)}`;
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("authService.login: rate limiting (FIG-784)", () => {
  it("locks out further attempts for the same email once the per-email limit is hit -- even with the correct password", async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "3";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";

    const user = await createUserWithPassword();

    for (let i = 0; i < 3; i++) {
      await expect(
        authService.login(user.email, "wrong-password", null, uniqueIp()),
      ).rejects.toThrow(UnauthorizedError);
    }

    // The 4th attempt is locked out regardless of using the CORRECT
    // password now -- this is what makes it a lockout, not just "wrong
    // passwords keep failing."
    await expect(
      authService.login(user.email, PASSWORD, null, uniqueIp()),
    ).rejects.toThrow(RateLimitedError);
  });

  it("locks out further attempts from the same IP once the per-IP limit is hit, across different emails", async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "3";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "1000";

    const ip = uniqueIp();
    for (let i = 0; i < 3; i++) {
      await expect(
        authService.login(`nobody-${randomUUID()}@example.test`, "wrong", null, ip),
      ).rejects.toThrow(UnauthorizedError);
    }

    await expect(
      authService.login(`nobody-${randomUUID()}@example.test`, "wrong", null, ip),
    ).rejects.toThrow(RateLimitedError);
  });

  it("rate-limits a real and a nonexistent email identically -- the lockout itself doesn't reveal whether the account exists", async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "2";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";

    const realUser = await createUserWithPassword();
    const fakeEmail = `nobody-${randomUUID()}@example.test`;

    for (let i = 0; i < 2; i++) {
      await expect(
        authService.login(realUser.email, "wrong", null, uniqueIp()),
      ).rejects.toThrow(UnauthorizedError);
      await expect(
        authService.login(fakeEmail, "wrong", null, uniqueIp()),
      ).rejects.toThrow(UnauthorizedError);
    }

    let realMessage = "";
    try {
      await authService.login(realUser.email, "wrong", null, uniqueIp());
    } catch (err) {
      realMessage = (err as Error).message;
    }
    let fakeMessage = "";
    try {
      await authService.login(fakeEmail, "wrong", null, uniqueIp());
    } catch (err) {
      fakeMessage = (err as Error).message;
    }

    expect(realMessage).not.toBe("");
    expect(realMessage).toBe(fakeMessage);
  });

  it("does not rate-limit a different email/IP pair still under its own limit", async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "1";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";

    const userA = await createUserWithPassword();
    const userB = await createUserWithPassword();

    await expect(
      authService.login(userA.email, "wrong", null, uniqueIp()),
    ).rejects.toThrow(UnauthorizedError);
    // Different email, same tiny per-email limit -- must not inherit
    // userA's exhausted count.
    const { userId } = await authService.login(userB.email, PASSWORD, null, uniqueIp());
    expect(userId).toBe(userB.id);
  });
});

describe("authService.signup: rate limiting (FIG-784)", () => {
  it("locks out further signup attempts for the same email once the per-email limit is hit, even once the email is already taken", async () => {
    process.env.SIGNUP_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.SIGNUP_RATE_LIMIT_MAX_PER_EMAIL = "3";
    process.env.SIGNUP_RATE_LIMIT_MAX_PER_IP = "1000";

    const email = `signup-${randomUUID()}@example.test`;

    // 1st succeeds (creates the account); 2nd and 3rd still pass the rate
    // check but fail on "already exists" -- both count toward the limit.
    await authService.signup(email, PASSWORD, "Test User", null, uniqueIp());
    await expect(
      authService.signup(email, PASSWORD, "Test User", null, uniqueIp()),
    ).rejects.toThrow(ValidationError);
    await expect(
      authService.signup(email, PASSWORD, "Test User", null, uniqueIp()),
    ).rejects.toThrow(ValidationError);

    // 4th is rejected by the rate limit itself, not "already exists".
    await expect(
      authService.signup(email, PASSWORD, "Test User", null, uniqueIp()),
    ).rejects.toThrow(RateLimitedError);
  });

  it("locks out further signup attempts from the same IP once the per-IP limit is hit, across different emails", async () => {
    process.env.SIGNUP_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.SIGNUP_RATE_LIMIT_MAX_PER_IP = "3";
    process.env.SIGNUP_RATE_LIMIT_MAX_PER_EMAIL = "1000";

    const ip = uniqueIp();
    for (let i = 0; i < 3; i++) {
      await authService.signup(
        `signup-${randomUUID()}@example.test`,
        PASSWORD,
        "Test User",
        null,
        ip,
      );
    }

    await expect(
      authService.signup(
        `signup-${randomUUID()}@example.test`,
        PASSWORD,
        "Test User",
        null,
        ip,
      ),
    ).rejects.toThrow(RateLimitedError);
  });
});

describe("authService.requestPasswordReset: rate limiting (FIG-784)", () => {
  const buildResetUrl = (token: string) => `https://example.test/reset-password?token=${token}`;

  it("locks out further reset requests for the same email once the per-email limit is hit", async () => {
    process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_EMAIL = "2";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_IP = "1000";

    const user = await createUserWithPassword();

    for (let i = 0; i < 2; i++) {
      const result = await authService.requestPasswordReset(
        user.email,
        buildResetUrl,
        uniqueIp(),
      );
      expect(result.message).toContain("If that email has an account");
    }

    await expect(
      authService.requestPasswordReset(user.email, buildResetUrl, uniqueIp()),
    ).rejects.toThrow(RateLimitedError);
  });

  it("locks out a nonexistent email at exactly the same threshold as a real one -- reset-email flooding is throttled either way", async () => {
    process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_EMAIL = "2";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_IP = "1000";

    const fakeEmail = `nobody-${randomUUID()}@example.test`;

    for (let i = 0; i < 2; i++) {
      const result = await authService.requestPasswordReset(fakeEmail, buildResetUrl, uniqueIp());
      expect(result.message).toContain("If that email has an account");
    }

    await expect(
      authService.requestPasswordReset(fakeEmail, buildResetUrl, uniqueIp()),
    ).rejects.toThrow(RateLimitedError);
  });

  it("locks out further reset requests from the same IP once the per-IP limit is hit, across different emails", async () => {
    process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_IP = "2";
    process.env.PASSWORD_RESET_RATE_LIMIT_MAX_PER_EMAIL = "1000";

    const ip = uniqueIp();
    for (let i = 0; i < 2; i++) {
      await authService.requestPasswordReset(
        `nobody-${randomUUID()}@example.test`,
        buildResetUrl,
        ip,
      );
    }

    await expect(
      authService.requestPasswordReset(
        `nobody-${randomUUID()}@example.test`,
        buildResetUrl,
        ip,
      ),
    ).rejects.toThrow(RateLimitedError);
  });
});
