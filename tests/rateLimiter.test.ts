import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../src/auth/errors";
import { enforceRateLimit } from "../src/auth/rateLimiter";

function uniqueKey(): string {
  return `test-${randomUUID()}`;
}

describe("auth/rateLimiter.enforceRateLimit (FIG-784)", () => {
  it("allows attempts up to the max, then rejects the next one", async () => {
    const key = uniqueKey();
    const rules = [{ scope: "ip", key, windowMs: 60_000, max: 2 }];

    await expect(enforceRateLimit("LOGIN", rules)).resolves.toBeUndefined();
    await expect(enforceRateLimit("LOGIN", rules)).resolves.toBeUndefined();
    await expect(enforceRateLimit("LOGIN", rules)).rejects.toThrow(RateLimitedError);
  });

  it("skips a rule whose key is null instead of treating it as unlimited or always-blocked", async () => {
    const rules = [{ scope: "ip", key: null, windowMs: 60_000, max: 0 }];
    await expect(enforceRateLimit("LOGIN", rules)).resolves.toBeUndefined();
  });

  it("keeps different scopes independent -- hitting the 'ip' limit doesn't affect the 'email' counter for the same call", async () => {
    const ip = uniqueKey();
    const email = uniqueKey();
    const rules = [
      { scope: "ip", key: ip, windowMs: 60_000, max: 1 },
      { scope: "email", key: email, windowMs: 60_000, max: 1000 },
    ];

    await enforceRateLimit("LOGIN", rules);
    await expect(enforceRateLimit("LOGIN", rules)).rejects.toThrow(RateLimitedError);

    // The "email" rule alone, same key, is still untouched.
    await expect(
      enforceRateLimit("LOGIN", [{ scope: "email", key: email, windowMs: 60_000, max: 1000 }]),
    ).resolves.toBeUndefined();
  });

  it("keeps different actions independent -- a LOGIN lockout doesn't bleed into SIGNUP for the same key", async () => {
    const key = uniqueKey();
    const rules = [{ scope: "ip", key, windowMs: 60_000, max: 1 }];

    await enforceRateLimit("LOGIN", rules);
    await expect(enforceRateLimit("LOGIN", rules)).rejects.toThrow(RateLimitedError);
    await expect(enforceRateLimit("SIGNUP", rules)).resolves.toBeUndefined();
  });

  it("does not count a rejected attempt toward the window -- hammering past the limit doesn't extend the lockout indefinitely", async () => {
    const key = uniqueKey();
    const rules = [{ scope: "ip", key, windowMs: 60_000, max: 1 }];

    await enforceRateLimit("LOGIN", rules);
    // Several more calls all get rejected and should NOT each add a new
    // recorded attempt -- only the one successful call above did.
    for (let i = 0; i < 5; i++) {
      await expect(enforceRateLimit("LOGIN", rules)).rejects.toThrow(RateLimitedError);
    }

    // Confirmed indirectly: a rule with max=2 and the same key, checked
    // fresh, only sees the ONE real recorded attempt, not six.
    await expect(
      enforceRateLimit("LOGIN", [{ scope: "ip", key, windowMs: 60_000, max: 2 }]),
    ).resolves.toBeUndefined();
  });

  it("a request satisfying multiple rules records one attempt per rule", async () => {
    const ip = uniqueKey();
    const email = uniqueKey();
    const rules = [
      { scope: "ip", key: ip, windowMs: 60_000, max: 1000 },
      { scope: "email", key: email, windowMs: 60_000, max: 1 },
    ];

    await enforceRateLimit("LOGIN", rules);
    // The "ip" rule alone (max 1) should now also be at its limit, proving
    // the ip-scope row was recorded by the combined call above, not just
    // the email-scope one.
    await expect(
      enforceRateLimit("LOGIN", [{ scope: "ip", key: ip, windowMs: 60_000, max: 1 }]),
    ).rejects.toThrow(RateLimitedError);
  });
});
