import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tryAcquireJobLock } from "../src/repositories/scheduledJobRuns";
import { runNotificationsSweep } from "../src/services/notificationSweepService";
import { createTestOrganization } from "./helpers/fixtures";

function uniqueJobKey(): string {
  return `test-sweep-${randomUUID()}`;
}

describe("notificationSweepService.runNotificationsSweep (FIG-783)", () => {
  it("runs, sweeps the given organizations, and records a completed jobRun", async () => {
    const org = await createTestOrganization();
    const jobKey = uniqueJobKey();

    const result = await runNotificationsSweep({
      jobKey,
      organizationIds: [org.id],
    });

    expect(result.ran).toBe(true);
    expect(result.organizationsSwept).toBe(1);
    expect(result.jobRun.status).toBe("IDLE");
    expect(result.jobRun.completedAt).not.toBeNull();
  });

  it("throttles a second call that comes in before the configured interval has elapsed", async () => {
    const org = await createTestOrganization();
    const jobKey = uniqueJobKey();

    const first = await runNotificationsSweep({ jobKey, organizationIds: [org.id] });
    expect(first.ran).toBe(true);

    const second = await runNotificationsSweep({ jobKey, organizationIds: [org.id] });
    expect(second.ran).toBe(false);
    expect(second.skippedReason).toBe("throttled");
    // Same completedAt as the first run -- nothing re-ran.
    expect(second.jobRun.completedAt).toEqual(first.jobRun.completedAt);
  });

  it("skips (does not double-send) when another run already holds the lock", async () => {
    const org = await createTestOrganization();
    const jobKey = uniqueJobKey();

    // Simulate a concurrent in-flight run by acquiring the lock directly,
    // bypassing runNotificationsSweep's own acquire call.
    await tryAcquireJobLock(jobKey, 30 * 60_000);

    const result = await runNotificationsSweep({ jobKey, organizationIds: [org.id] });
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toBe("locked");
  });

  it("only sweeps the organizations it was told to, not every organization in the database", async () => {
    const included = await createTestOrganization();
    const excluded = await createTestOrganization();
    const jobKey = uniqueJobKey();

    const result = await runNotificationsSweep({
      jobKey,
      organizationIds: [included.id],
    });

    expect(result.ran).toBe(true);
    expect(result.organizationsSwept).toBe(1);
    void excluded; // only exists to prove it wasn't counted
  });
});
