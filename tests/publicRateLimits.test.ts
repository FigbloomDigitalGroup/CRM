import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { limitInboundEmail } from "../src/auth/publicLimits";
import { adminDb } from "../src/db/adminClient";
import { POST as acceptInvite } from "../src/app/api/auth/accept-invite/route";
import { POST as confirmReset } from "../src/app/api/auth/password-reset/confirm/route";
import { POST as inboundEmail } from "../src/app/api/public/orgs/[orgSlug]/communications/inbound/route";

/** G1.05: the public endpoints that take a token (invite, reset confirmation, inbound email) are rate limited like login and sign-up. */

const post = (ip: string, body: unknown = {}) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const ctx = (orgSlug = "nobody") => ({ params: Promise.resolve({ orgSlug }) });

describe("public token endpoints are rate limited (G1.05)", () => {
  it("stops a flood of invite acceptances from one address with the standard 429 envelope, and leaves other addresses alone", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}-${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 30; i++) {
      const res = await acceptInvite(post(ip, { token: `bad-token-${i}` }));
      expect(res.status).not.toBe(429);
    }
    const blocked = await acceptInvite(post(ip, { token: "bad-token-31" }));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.requestId).toBeTruthy();
    const other = await acceptInvite(post(`198.51.100.${randomUUID().slice(0, 6)}`, { token: "bad-token" }));
    expect(other.status).not.toBe(429);
  });

  it("stops a flood of password reset confirmations from one address", async () => {
    const ip = `192.0.2.${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 30; i++) {
      const res = await confirmReset(post(ip, { token: `bad-${i}`, newPassword: "a-long-enough-password-1" }));
      expect(res.status).not.toBe(429);
    }
    expect((await confirmReset(post(ip, { token: "bad-31", newPassword: "a-long-enough-password-1" }))).status).toBe(429);
  });

  it("limits the inbound-email webhook per address and per organisation, generously", async () => {
    const ip = `203.0.113.${randomUUID().slice(0, 8)}`;
    const slug = `limit-${randomUUID().slice(0, 8)}`;
    // One call is recorded against both buckets, and a real provider's volume is nowhere near the ceiling.
    await limitInboundEmail(ip, slug);
    const rows = await adminDb.authRateLimitAttempt.findMany({ where: { action: "INBOUND_EMAIL", key: { in: [ip, slug] } } });
    expect(rows.map((r) => r.scope).sort()).toEqual(["ip", "org"]);
    // And the route answers its usual way (a wrong token is a 401, never a 429) well inside the limit.
    const res = await inboundEmail(post(ip, { from: "a@example.test" }), ctx(slug));
    expect(res.status).toBe(401);
  });

  it("does not limit a request with no usable address by address (it cannot), and never throws for it", async () => {
    await expect(limitInboundEmail(null, `limit-${randomUUID().slice(0, 8)}`)).resolves.toBeUndefined();
  });
});
