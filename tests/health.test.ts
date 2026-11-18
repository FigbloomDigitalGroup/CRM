import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";
import { adminDb } from "../src/db/adminClient";
import { NOTIFICATIONS_SWEEP_JOB_TYPE } from "../src/jobs/handlers/notificationSweep";
import { createTestOrganization } from "./helpers/fixtures";

describe("GET /api/health", () => {
  it("returns 200 and status ok when the database is reachable, with the notifications sweep's status (FIG-783)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    // The application role (figbloom_app) must be able to connect too, and the answer carries a request id (FIG-1124).
    expect(body.appRole).toBe("ok");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    // Not asserting an exact status/timestamp here -- other test files in
    // the same run may have already exercised the real sweep job, which
    // shares this one global (non-org-scoped) row. Just the shape.
    expect(body.notificationsSweep).toHaveProperty("status");
    expect(body.notificationsSweep).toHaveProperty("lastCompletedAt");
    expect(body.notificationsSweep).toHaveProperty("lastError");
  });

  it("shows the time of the latest scheduled sweep job, not only the legacy sweep row (D-4)", async () => {
    const org = await createTestOrganization();
    const finishedAt = new Date(Date.now() + 60_000);
    await adminDb.backgroundJob.create({
      data: { organizationId: org.id, type: NOTIFICATIONS_SWEEP_JOB_TYPE, status: "SUCCEEDED", finishedAt, startedAt: finishedAt, attempts: 1 },
    });
    const body = await (await GET()).json();
    // Other test files may add later sweep jobs; the status can only be at or after this one.
    expect(new Date(body.notificationsSweep.lastCompletedAt).getTime()).toBeGreaterThanOrEqual(finishedAt.getTime());
  });
});
