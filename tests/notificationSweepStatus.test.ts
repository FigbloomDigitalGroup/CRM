import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import {
  getNotificationsSweepStatus,
  SWEEP_JOB_FAILED_MESSAGE,
} from "../src/services/notificationSweepService";
import { releaseJobLock, tryAcquireJobLock } from "../src/repositories/scheduledJobRuns";
import { createTestOrganization } from "./helpers/fixtures";

/**
 * D-4 (MVP-16): `/api/health` showed the sweep's last time from the legacy `scheduled_job_runs` row, which only moves when
 * the throttled route runs. The job framework runs the sweep as `notifications.sweep` background jobs every 15 minutes,
 * so the status must follow those. Disposable job key and job type keep these tests apart from every other test file
 * that exercises the real sweep in the shared database.
 */
const unique = () => `d4-${randomUUID()}`;

async function addJob(organizationId: string, type: string, status: "SUCCEEDED" | "DEAD", finishedAt: Date, lastError?: string) {
  await adminDb.backgroundJob.create({
    data: { organizationId, type, status, finishedAt, startedAt: finishedAt, attempts: 1, lastError: lastError ?? null },
  });
}

describe("getNotificationsSweepStatus (D-4)", () => {
  it("is null when nothing has ever run", async () => {
    expect(await getNotificationsSweepStatus(unique(), { jobType: unique() })).toBeNull();
  });

  it("follows the newest SUCCEEDED job across organisations when the legacy row has never run", async () => {
    const [a, b] = await Promise.all([createTestOrganization(), createTestOrganization()]);
    const type = unique();
    const older = new Date(Date.now() - 20 * 60_000);
    const newer = new Date(Date.now() - 5 * 60_000);
    await addJob(a.id, type, "SUCCEEDED", older);
    await addJob(b.id, type, "SUCCEEDED", newer);

    const status = await getNotificationsSweepStatus(unique(), { jobType: type });
    expect(status?.completedAt?.getTime()).toBe(newer.getTime());
    expect(status?.status).toBe("IDLE");
    expect(status?.lastError).toBeNull();
  });

  it("takes the later of the legacy row and the jobs", async () => {
    const org = await createTestOrganization();
    const type = unique();
    const jobKey = unique();
    await tryAcquireJobLock(jobKey, 60_000);
    const legacy = await releaseJobLock(jobKey, { success: true });
    await addJob(org.id, type, "SUCCEEDED", new Date(legacy.completedAt!.getTime() - 60 * 60_000));

    const legacyWins = await getNotificationsSweepStatus(jobKey, { jobType: type });
    expect(legacyWins?.completedAt?.getTime()).toBe(legacy.completedAt!.getTime());

    const newer = new Date(legacy.completedAt!.getTime() + 10 * 60_000);
    await addJob(org.id, type, "SUCCEEDED", newer);
    const jobWins = await getNotificationsSweepStatus(jobKey, { jobType: type });
    expect(jobWins?.completedAt?.getTime()).toBe(newer.getTime());
  });

  it("reports a generic error, never the job's own text, when the newest job died after the last success", async () => {
    const org = await createTestOrganization();
    const type = unique();
    await addJob(org.id, type, "SUCCEEDED", new Date(Date.now() - 30 * 60_000));
    await addJob(org.id, type, "DEAD", new Date(Date.now() - 5 * 60_000), 'relation "secret_table" does not exist at db.internal:5432');

    const status = await getNotificationsSweepStatus(unique(), { jobType: type });
    expect(status?.lastError).toBe(SWEEP_JOB_FAILED_MESSAGE);
    expect(JSON.stringify(status)).not.toContain("secret_table");
    expect(JSON.stringify(status)).not.toContain("db.internal");
  });

  it("does not report an error once a later job has succeeded", async () => {
    const org = await createTestOrganization();
    const type = unique();
    await addJob(org.id, type, "DEAD", new Date(Date.now() - 30 * 60_000), "boom");
    await addJob(org.id, type, "SUCCEEDED", new Date(Date.now() - 5 * 60_000));

    const status = await getNotificationsSweepStatus(unique(), { jobType: type });
    expect(status?.lastError).toBeNull();
  });

  it("reads only the legacy row for a custom key without a job type (existing tests' seam)", async () => {
    const jobKey = unique();
    await tryAcquireJobLock(jobKey, 60_000);
    await releaseJobLock(jobKey, { success: true });
    const status = await getNotificationsSweepStatus(jobKey);
    expect(status?.jobKey).toBe(jobKey);
    expect(status?.completedAt).not.toBeNull();
  });
});
