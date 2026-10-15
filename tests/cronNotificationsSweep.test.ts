import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This route's own job is authenticating the request and delegating to
 * `runNotificationsSweep` -- the sweep's actual behavior (locking,
 * throttling, per-organization logic) is already covered in
 * `tests/notificationSweepService.test.ts`. Mocking it here keeps this
 * file fast and deterministic: calling the real, unmocked function would
 * sweep every ACTIVE organization in the shared test database (every test
 * file's leftover orgs included), which is both slow and pointless for
 * what this file is actually testing.
 */
vi.mock("../src/services/notificationSweepService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/services/notificationSweepService")
  >();
  return { ...actual, runNotificationsSweep: vi.fn() };
});

import { GET } from "../src/app/api/cron/notifications-sweep/route";
import { runNotificationsSweep } from "../src/services/notificationSweepService";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/notifications-sweep", { headers });
}

describe("GET /api/cron/notifications-sweep (FIG-783)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    vi.mocked(runNotificationsSweep).mockResolvedValue({
      ran: true,
      organizationsSwept: 0,
      jobRun: {
        jobKey: "notifications-sweep",
        status: "IDLE",
        startedAt: new Date(),
        completedAt: new Date(),
        lastError: null,
      },
    });
  });

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    vi.mocked(runNotificationsSweep).mockReset();
  });

  it("rejects a request with no secret at all, without ever calling the sweep", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(runNotificationsSweep).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await GET(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
    expect(runNotificationsSweep).not.toHaveBeenCalled();
  });

  it("accepts the correct secret via the Authorization: Bearer header and runs the sweep", async () => {
    const response = await GET(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ran).toBe(true);
    expect(runNotificationsSweep).toHaveBeenCalledTimes(1);
  });

  it("also accepts the correct secret via the X-Cron-Secret header", async () => {
    const response = await GET(request({ "x-cron-secret": "test-cron-secret" }));
    expect(response.status).toBe(200);
    expect(runNotificationsSweep).toHaveBeenCalledTimes(1);
  });

  it("fails closed (does not run) when CRON_SECRET itself is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request({ authorization: "Bearer anything" }));
    expect(response.status).toBe(500);
    expect(runNotificationsSweep).not.toHaveBeenCalled();
  });
});
