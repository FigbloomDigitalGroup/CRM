import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 and status ok when the database is reachable, with the notifications sweep's status (FIG-783)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    // Not asserting an exact status/timestamp here -- other test files in
    // the same run may have already exercised the real sweep job, which
    // shares this one global (non-org-scoped) row. Just the shape.
    expect(body.notificationsSweep).toHaveProperty("status");
    expect(body.notificationsSweep).toHaveProperty("lastCompletedAt");
    expect(body.notificationsSweep).toHaveProperty("lastError");
  });
});
