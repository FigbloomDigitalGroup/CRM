import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { logger } from "../src/lib/logger";

const ORIGINAL_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
  vi.clearAllMocks();
});

describe("logger: Sentry bridge (FIG-753)", () => {
  // Reporting is fire-and-forget behind a dynamic import (see logger.ts's
  // header comment -- a static top-level import of @sentry/nextjs
  // destabilized pino-pretty's worker-thread transport in Next.js dev
  // mode), so every assertion here waits for it rather than asserting
  // immediately after the synchronous `logger.error(...)` call returns.

  it("is a no-op with no DSN configured -- the default in dev/test/CI", async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    logger.error({ err: new Error("boom") }, "failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports the real error object and scrubbed context when a DSN is configured", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    const err = new Error("boom");

    logger.error({ err, organizationId: "org-1", email: "jane@example.com" }, "failed");

    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalled());
    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ extra: { organizationId: "org-1", email: "[redacted]" } }),
    );
  });

  it("wraps a non-Error err value in a real Error before reporting", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

    logger.error({ err: "not an Error instance" }, "failed");

    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalled());
    const [reportedError] = vi.mocked(Sentry.captureException).mock.calls[0]!;
    expect(reportedError).toBeInstanceOf(Error);
  });

  it("does not report info/warn-level logs, only error and above", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

    logger.info({ foo: "bar" }, "just info");
    logger.warn({ foo: "bar" }, "just a warning");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
