import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secretsMatch } from "../src/auth/secretCompare";
import { REDACTED_PATHS } from "../src/lib/logger";
import { GET as jobsGet } from "../src/app/api/cron/jobs/route";
import { GET as sweepGet } from "../src/app/api/cron/notifications-sweep/route";

/** G1.05: shared secrets are compared in constant time, and a secret that reaches a log line is not written. */
describe("secret handling", () => {
  it("matches only the exact secret, whatever its length, and never a missing one", () => {
    expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true);
    expect(secretsMatch("s3cret-valuf", "s3cret-value")).toBe(false);
    expect(secretsMatch("s3cret", "s3cret-value")).toBe(false);
    expect(secretsMatch("s3cret-value-and-more", "s3cret-value")).toBe(false);
    expect(secretsMatch("", "s3cret-value")).toBe(false);
    expect(secretsMatch(null, "s3cret-value")).toBe(false);
    expect(secretsMatch(undefined, "s3cret-value")).toBe(false);
  });

  describe("the scheduler hooks", () => {
    const original = process.env.CRON_SECRET;
    beforeEach(() => {
      process.env.CRON_SECRET = "cron-secret-for-tests";
    });
    afterEach(() => {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    });

    for (const [name, handler] of [["jobs", jobsGet], ["notifications sweep", sweepGet]] as const) {
      it(`refuse a wrong or missing secret with 401 (${name})`, async () => {
        for (const headers of <Record<string, string>[]>[{}, { authorization: "Bearer wrong" }, { "x-cron-secret": "wrong" }, { authorization: "Bearer cron-secret-for-tests-and-more" }]) {
          const res = await handler(new Request("http://localhost/api/cron/x", { headers }));
          expect(res.status, JSON.stringify(headers)).toBe(401);
          expect((await res.json()).code).toBe("UNAUTHORIZED");
        }
      });
    }
  });

  it("redacts secrets in what the logger writes: bodies, nested objects and request headers", () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACTED_PATHS, censor: "[redacted]" } }, { write: (line: string) => void lines.push(line) });
    log.info(
      {
        password: "hunter2-pass",
        body: { newPassword: "hunter3-pass", token: "tok-123-secret", note: "visible" },
        headers: { authorization: "Bearer abc-secret", cookie: "figbloom_session=ses-secret", "x-figbloom-api-key": "key-secret", accept: "json" },
        captchaSecret: "captcha-secret",
      },
      "request",
    );
    const text = lines.join("");
    for (const secret of ["hunter2-pass", "hunter3-pass", "tok-123-secret", "abc-secret", "ses-secret", "key-secret", "captcha-secret"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("visible");
    expect(text).toContain("[redacted]");
  });
});
