import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password";
import { RateLimitedError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { growingDelaySeconds, loginThrottleConfig } from "../src/auth/loginThrottle";
import * as authService from "../src/services/authService";
import { trustThisDevice } from "../src/services/twoStepService";
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
  vi.useRealTimers();
  process.env = { ...originalEnv };
});

const WRONG = "S3cret-wrong-guess-zz";

/** n failed sign-ins from one address. The first three go through the real path; more would be refused by the growing wait, so the rest are recorded the way a failure is. */
async function failures(email: string, ip: string, n: number) {
  for (let i = 0; i < Math.min(n, 3); i++) {
    await expect(authService.login(email, WRONG, null, ip)).rejects.toThrow(UnauthorizedError);
  }
  if (n > 3) {
    const e = email.trim().toLowerCase();
    const rows = Array.from({ length: n - 3 }, () => [
      { action: "LOGIN" as const, scope: "pair", key: `${ip}|${e}` },
      { action: "LOGIN" as const, scope: "email", key: e },
      { action: "LOGIN" as const, scope: "ip", key: ip },
    ]).flat();
    await adminDb.authRateLimitAttempt.createMany({ data: rows });
  }
}

async function advance(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe("growingDelaySeconds: the rule maths (P2-02)", () => {
  const cfg = { freeAttempts: 3, baseSeconds: 1, maxSeconds: 30 };
  it("is zero for the free attempts, then 1, 2, 4, 8, 16, capped at the maximum", () => {
    expect([0, 1, 2, 3].map((n) => growingDelaySeconds(n, cfg))).toEqual([0, 0, 0, 0]);
    expect([4, 5, 6, 7, 8, 9, 10, 500].map((n) => growingDelaySeconds(n, cfg))).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
  });
  it("reads its settings from the environment", () => {
    process.env.LOGIN_DELAY_FREE_ATTEMPTS = "1";
    process.env.LOGIN_DELAY_MAX_SECONDS = "5";
    expect([1, 2, 3, 4, 9].map((n) => growingDelaySeconds(n))).toEqual([0, 1, 2, 4, 5]);
  });
  it("has safe defaults: ceilings of 300 per address and 200 per email", () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX_PER_IP;
    delete process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL;
    expect(loginThrottleConfig()).toMatchObject({ maxPerIp: 300, maxPerEmail: 200, freeAttempts: 3, maxSeconds: 30 });
  });
});

describe("authService.login: growing wait instead of a lock (P2-02)", () => {
  it("wrong passwords for an email from address A never stop a correct sign-in from address B", async () => {
    const user = await createUserWithPassword();
    await failures(user.email, uniqueIp(), 12);
    const { userId } = await authService.login(user.email, PASSWORD, null, uniqueIp());
    expect(userId).toBe(user.id);
  });

  it("from the same address the wait is short and clear, then the correct password signs in (no hard lockout)", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    await failures(user.email, ip, 6);
    const refused = await authService.login(user.email, PASSWORD, null, ip).catch((e) => e);
    expect(refused).toBeInstanceOf(RateLimitedError);
    expect((refused as RateLimitedError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(30);
    expect((refused as Error).message).toMatch(/wait \d+ seconds? and try again/i);

    await advance(31_000);
    expect((await authService.login(user.email, PASSWORD, null, ip)).userId).toBe(user.id);
  });

  it("the wait does not grow forever: after 40 failures it is still at most the maximum", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    await adminDb.authRateLimitAttempt.createMany({
      data: Array.from({ length: 40 }, () => ({ action: "LOGIN" as const, scope: "pair", key: `${ip}|${user.email.toLowerCase()}` })),
    });
    const refused = await authService.login(user.email, PASSWORD, null, ip).catch((e) => e);
    expect((refused as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(30);
    await advance(31_000);
    expect((await authService.login(user.email, PASSWORD, null, ip)).userId).toBe(user.id);
  });

  it("a successful sign-in clears the pair counter", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    await failures(user.email, ip, 3);
    expect(await adminDb.authRateLimitAttempt.count({ where: { scope: "pair", key: `${ip}|${user.email.toLowerCase()}` } })).toBe(3);
    await authService.login(user.email, PASSWORD, null, ip);
    expect(await adminDb.authRateLimitAttempt.count({ where: { scope: "pair", key: `${ip}|${user.email.toLowerCase()}` } })).toBe(0);
  });

  it("a real and a nonexistent email get the same refusal and the same wait", async () => {
    const real = await createUserWithPassword();
    const fakeEmail = `nobody-${randomUUID()}@example.test`;
    const ip = uniqueIp();
    await failures(real.email, ip, 5);
    await failures(fakeEmail, ip, 5);
    const a = (await authService.login(real.email, "x", null, ip).catch((e) => e)) as RateLimitedError;
    const b = (await authService.login(fakeEmail, "x", null, ip).catch((e) => e)) as RateLimitedError;
    expect(a).toBeInstanceOf(RateLimitedError);
    expect(b).toBeInstanceOf(RateLimitedError);
    expect(a.message.replace(/\d+/, "N")).toBe(b.message.replace(/\d+/, "N"));
  });

  it("a trusted device of the account signs in at once, even while the pair is waiting and the email is over its ceiling", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "3";
    const user = await createUserWithPassword();
    const { token } = await trustThisDevice(user.id, { userAgent: "Vitest", ipAddress: null });
    const ip = uniqueIp();
    await failures(user.email, ip, 3);
    await expect(authService.login(user.email, PASSWORD, null, ip)).rejects.toThrow(RateLimitedError);
    expect((await authService.startSignIn(user.email, PASSWORD, null, ip, null, token)) as { userId: string }).toMatchObject({ userId: user.id });
  });

  it("per email across all addresses is a wait, never a block, and the table keeps no password or token", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "4";
    const user = await createUserWithPassword();
    const ips = [uniqueIp(), uniqueIp(), uniqueIp(), uniqueIp()];
    for (const ip of ips) await failures(user.email, ip, 1);
    const fresh = uniqueIp();
    const refused = await authService.login(user.email, PASSWORD, null, fresh).catch((e) => e);
    expect(refused).toBeInstanceOf(RateLimitedError);
    expect((refused as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(30);
    await advance(31_000);
    expect((await authService.login(user.email, PASSWORD, null, fresh)).userId).toBe(user.id);

    vi.useRealTimers();
    const rows = await adminDb.authRateLimitAttempt.findMany({ where: { action: "LOGIN", key: { contains: user.email.toLowerCase() } } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(WRONG);
      expect(JSON.stringify(row)).not.toContain(PASSWORD);
      expect(["pair", "email", "ip"]).toContain(row.scope);
    }
  });
});

describe("authService.login: scripted attacks are slowed, then blocked (P2-02)", () => {
  it("1,000 guesses at one account from one address: only a handful are ever checked, the rest are refused with a wait", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    let checked = 0;
    let refused = 0;
    for (let i = 0; i < 1000; i++) {
      try {
        await authService.login(user.email, `guess-${i}`, null, ip);
      } catch (err) {
        if (err instanceof RateLimitedError) refused++;
        else if (err instanceof UnauthorizedError) checked++;
      }
    }
    // The waits (1, 2, 4 ... s) expire while the loop runs, so a few more get through than the free three; nowhere near 1,000.
    expect(checked).toBeLessThanOrEqual(15);
    expect(refused).toBeGreaterThanOrEqual(985);
    // Even the right password is held back until the wait is over.
    await expect(authService.login(user.email, PASSWORD, null, ip)).rejects.toThrow(RateLimitedError);
  }, 180_000);

  it("1,000 guesses spread over many accounts from one address: blocked at the per-address ceiling of 300", async () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX_PER_IP;
    const ip = uniqueIp();
    let checked = 0;
    let refused = 0;
    for (let i = 0; i < 1000; i++) {
      try {
        await authService.login(`nobody-${randomUUID()}@example.test`, "guess", null, ip);
      } catch (err) {
        if (err instanceof RateLimitedError) refused++;
        else if (err instanceof UnauthorizedError) checked++;
      }
    }
    expect(checked).toBe(300);
    expect(refused).toBe(700);
    // A hard block until the window passes, even for the right password.
    const user = await createUserWithPassword();
    const blocked = await authService.login(user.email, PASSWORD, null, ip).catch((e) => e);
    expect(blocked).toBeInstanceOf(RateLimitedError);
    // ...but it does not touch anyone on another address.
    expect((await authService.login(user.email, PASSWORD, null, uniqueIp())).userId).toBe(user.id);
  }, 300_000);

  it("blocks a single address at a small configured ceiling, then lets it back in after the window", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "3";
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    const ip = uniqueIp();
    for (let i = 0; i < 3; i++) await authService.login(`nobody-${randomUUID()}@example.test`, "x", null, ip).catch(() => undefined);
    await expect(authService.login(`nobody-${randomUUID()}@example.test`, "x", null, ip)).rejects.toThrow(RateLimitedError);
    await advance(601_000);
    await expect(authService.login(`nobody-${randomUUID()}@example.test`, "x", null, ip)).rejects.toThrow(UnauthorizedError);
  });
});

describe("authService.login: only failed attempts count (D-3)", () => {
  it("does not block 20 successful sign-ins by different users from one shared IP, with the default limits", async () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX_PER_IP;
    delete process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) {
      const user = await createUserWithPassword();
      const { userId } = await authService.login(user.email, PASSWORD, null, ip);
      expect(userId).toBe(user.id);
    }
  }, 180_000);

  it("does not block one person who signs in successfully many times in a row", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    for (let i = 0; i < 8; i++) {
      const { userId } = await authService.login(user.email, PASSWORD, null, ip);
      expect(userId).toBe(user.id);
    }
  });

  it("a successful sign-in does not add to the IP's failure count", async () => {
    const user = await createUserWithPassword();
    const ip = uniqueIp();
    await authService.login(user.email, PASSWORD, null, ip);
    await authService.login(user.email, PASSWORD, null, ip);
    const recorded = await adminDb.authRateLimitAttempt.count({ where: { action: "LOGIN", scope: "ip", key: ip } });
    expect(recorded).toBe(0);
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

  it("someone else asking for resets of your email cannot stop you asking from your own address (P2-02)", async () => {
    const user = await createUserWithPassword();
    const attacker = uniqueIp();
    for (let i = 0; i < 3; i++) await authService.requestPasswordReset(user.email, buildResetUrl, attacker);
    await expect(authService.requestPasswordReset(user.email, buildResetUrl, attacker)).rejects.toThrow(RateLimitedError);
    const result = await authService.requestPasswordReset(user.email, buildResetUrl, uniqueIp());
    expect(result.message).toContain("If that email has an account");
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
