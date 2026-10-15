import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getJobRunState,
  releaseJobLock,
  tryAcquireJobLock,
} from "../src/repositories/scheduledJobRuns";

/**
 * This table is global, not organization-scoped (FIG-783), so every test
 * below uses its own randomly-generated `jobKey` -- a fixed key would make
 * tests interfere with each other (and with any other test file's use of
 * the same mechanism) since there's no per-test organization to isolate
 * state by.
 */
function uniqueJobKey(): string {
  return `test-job-${randomUUID()}`;
}

describe("scheduledJobRuns (FIG-783 lock/last-run tracking)", () => {
  it("a job that has never run has no state", async () => {
    const jobKey = uniqueJobKey();
    expect(await getJobRunState(jobKey)).toBeNull();
  });

  it("acquires the lock for a brand-new job key", async () => {
    const jobKey = uniqueJobKey();
    const acquired = await tryAcquireJobLock(jobKey, 30 * 60_000);
    expect(acquired).toBe(true);

    const state = await getJobRunState(jobKey);
    expect(state?.status).toBe("RUNNING");
    expect(state?.startedAt).not.toBeNull();
  });

  it("a second acquire attempt while still RUNNING fails -- this is what stops overlapping runs from double-sending", async () => {
    const jobKey = uniqueJobKey();
    expect(await tryAcquireJobLock(jobKey, 30 * 60_000)).toBe(true);
    expect(await tryAcquireJobLock(jobKey, 30 * 60_000)).toBe(false);
  });

  it("releasing the lock as a success sets IDLE, completedAt, and clears lastError", async () => {
    const jobKey = uniqueJobKey();
    await tryAcquireJobLock(jobKey, 30 * 60_000);

    const released = await releaseJobLock(jobKey, { success: true });
    expect(released.status).toBe("IDLE");
    expect(released.completedAt).not.toBeNull();
    expect(released.lastError).toBeNull();

    // And the lock is acquirable again immediately.
    expect(await tryAcquireJobLock(jobKey, 30 * 60_000)).toBe(true);
  });

  it("releasing the lock as a failure sets IDLE and records lastError, without touching completedAt", async () => {
    const jobKey = uniqueJobKey();
    await tryAcquireJobLock(jobKey, 30 * 60_000);

    const released = await releaseJobLock(jobKey, {
      success: false,
      error: "boom",
    });
    expect(released.status).toBe("IDLE");
    expect(released.lastError).toBe("boom");
    expect(released.completedAt).toBeNull();
  });

  it("a stale RUNNING lock (older than staleAfterMs) can be reclaimed -- recovers from a crashed run instead of wedging the job forever", async () => {
    const jobKey = uniqueJobKey();
    // Acquire with an effectively-zero staleness window so it's already
    // "stale" the instant it's created.
    await tryAcquireJobLock(jobKey, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await tryAcquireJobLock(jobKey, 1)).toBe(true);
  });

  it("a RUNNING lock newer than staleAfterMs is NOT reclaimed", async () => {
    const jobKey = uniqueJobKey();
    await tryAcquireJobLock(jobKey, 30 * 60_000);
    expect(await tryAcquireJobLock(jobKey, 30 * 60_000)).toBe(false);
  });
});
