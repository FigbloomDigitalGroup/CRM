import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { registerJob, unregisterJob, backoffMs, type JobDefinition } from "../src/jobs/registry";
import {
  checkMissedRuns,
  enqueueAndRunNow,
  enqueueJobFor,
  runDueJobs,
  slotFor,
  tickSchedules,
} from "../src/jobs/runner";
import { claimJob, completeJob, listJobsForOrganization } from "../src/repositories/backgroundJobs";
import { cancelJob, getJob, listJobs, retryDeadJob } from "../src/services/jobService";
import { runNotificationsSweep } from "../src/services/notificationSweepService";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const registered: string[] = [];

function defineJob(partial: Partial<JobDefinition> & { handler: JobDefinition["handler"] }): string {
  const type = `test.job.${randomUUID().slice(0, 8)}`;
  registerJob({ type, baseBackoffMs: 1, maxBackoffMs: 5, ...partial });
  registered.push(type);
  return type;
}

afterEach(() => {
  for (const type of registered.splice(0)) unregisterJob(type);
});

describe("background job framework (FIG-1066, B2.18)", () => {
  it("runs a queued job once, records its result, and keeps the organisation and request id on it", async () => {
    const org = await createTestOrganization();
    const calls: unknown[] = [];
    const type = defineJob({
      handler: async (ctx) => {
        calls.push({ org: ctx.organizationId, request: ctx.requestId, attempt: ctx.attempt, payload: ctx.payload });
        return { done: true };
      },
    });

    const job = await enqueueJobFor({ organizationId: org.id, type, payload: { n: 1 }, requestId: "req-123" });
    const { results } = await runDueJobs({ types: [type], organizationIds: [org.id] });

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("succeeded");
    expect(calls).toEqual([{ org: org.id, request: "req-123", attempt: 1, payload: { n: 1 } }]);
    const stored = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("SUCCEEDED");
    expect(stored.result).toEqual({ done: true });
    expect(stored.requestId).toBe("req-123");
    expect(stored.lockedBy).toBeNull();
  });

  it("retries with backoff and moves a job that keeps failing to the dead-letter list", async () => {
    const org = await createTestOrganization();
    let runs = 0;
    const type = defineJob({
      maxAttempts: 3,
      handler: async () => {
        runs += 1;
        throw new Error("boom");
      },
    });
    const job = await enqueueJobFor({ organizationId: org.id, type });

    const states: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await runDueJobs({ types: [type], organizationIds: [org.id] });
      const row = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
      states.push(row.status);
      if (row.status === "DEAD") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(runs).toBe(3);
    expect(states.at(-1)).toBe("DEAD");
    const dead = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(dead.attempts).toBe(3);
    expect(dead.lastError).toContain("boom");
  });

  it("backoff doubles per attempt and is capped", () => {
    const d = { baseBackoffMs: 1000, maxBackoffMs: 5000 };
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(d, n))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it("fails an attempt that exceeds the per-job timeout", async () => {
    const org = await createTestOrganization();
    const type = defineJob({
      maxAttempts: 1,
      timeoutMs: 40,
      handler: () => new Promise(() => undefined),
    });
    const job = await enqueueJobFor({ organizationId: org.id, type });
    // The definition's timeout is copied onto the row when it is queued.
    expect(job.timeoutMs).toBe(40);
    await runDueJobs({ types: [type], organizationIds: [org.id] });
    const row = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("DEAD");
    expect(row.lastError).toContain("did not finish within 40 ms");
  });

  it("dead-letters a job whose type nobody handles", async () => {
    const org = await createTestOrganization();
    const result = await enqueueAndRunNow({ organizationId: org.id, type: "no.such.type" });
    expect(result.outcome).toBe("unknown-type");
    expect(result.job?.status).toBe("DEAD");
  });

  it("never loses a job when its worker crashes, and never runs it twice", async () => {
    const org = await createTestOrganization();
    let runs = 0;
    const type = defineJob({
      baseBackoffMs: 0,
      maxBackoffMs: 0,
      handler: async () => {
        runs += 1;
      },
    });
    const job = await enqueueJobFor({ organizationId: org.id, type });

    // A worker claims it, then dies: nothing settles it and its lease runs out.
    const crashed = await claimJob({ workerId: "crashed-worker", type });
    expect(crashed?.id).toBe(job.id);
    expect(runs).toBe(0);
    await adminDb.backgroundJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    // The next worker pass recovers it and runs it exactly once.
    const pass = await runDueJobs({ types: [type], organizationIds: [org.id] });
    expect(pass.reclaimed).toBe(1);
    expect(pass.results.map((r) => r.outcome)).toEqual(["succeeded"]);
    expect(runs).toBe(1);

    // The dead worker waking up late cannot settle the job a second time.
    expect(await completeJob({ id: job.id, lockedBy: "crashed-worker", attempts: 1 }, { late: true })).toBe(false);
    const row = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.attempts).toBe(2);
    expect(row.result).toBeNull();
  });

  it("a job that keeps killing its worker ends up dead instead of looping", async () => {
    const org = await createTestOrganization();
    const type = defineJob({ maxAttempts: 2, handler: async () => undefined });
    const job = await enqueueJobFor({ organizationId: org.id, type });
    for (let i = 0; i < 2; i += 1) {
      await claimJob({ workerId: `w${i}`, type });
      await adminDb.backgroundJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      await runDueJobs({ types: [], organizationIds: [org.id] });
      // Skip the retry delay so the next loop can claim it straight away.
      await adminDb.backgroundJob.updateMany({ where: { id: job.id, status: "QUEUED" }, data: { runAt: new Date(Date.now() - 1000) } });
    }
    const row = await adminDb.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("DEAD");
    expect(row.lastError).toContain("lease expired");
  });

  it("two workers racing for the same jobs run each job exactly once", async () => {
    const org = await createTestOrganization();
    const seen = new Map<string, number>();
    const type = defineJob({
      handler: async (ctx) => {
        seen.set(ctx.jobId, (seen.get(ctx.jobId) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    const ids = [];
    for (let i = 0; i < 8; i += 1) ids.push((await enqueueJobFor({ organizationId: org.id, type })).id);

    await Promise.all([
      runDueJobs({ workerId: "a", types: [type], organizationIds: [org.id] }),
      runDueJobs({ workerId: "b", types: [type], organizationIds: [org.id] }),
      runDueJobs({ workerId: "c", types: [type], organizationIds: [org.id] }),
    ]);

    expect([...seen.keys()].sort()).toEqual([...ids].sort());
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it("honours the per-type concurrency limit across workers", async () => {
    const org = await createTestOrganization();
    const type = defineJob({ concurrency: 1, handler: async () => undefined });
    await enqueueJobFor({ organizationId: org.id, type });
    await enqueueJobFor({ organizationId: org.id, type });

    const first = await claimJob({ workerId: "a", type, concurrency: 1 });
    const second = await claimJob({ workerId: "b", type, concurrency: 1 });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("queues each scheduled slot once per organisation, however many schedulers tick", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const everyMs = 60_000;
    const type = defineJob({ schedule: { everyMs }, handler: async () => undefined });
    const now = new Date("2026-10-23T10:00:30Z");

    const [one, two] = await Promise.all([
      tickSchedules({ now, types: [type], organizationIds: [orgA.id, orgB.id] }),
      tickSchedules({ now, types: [type], organizationIds: [orgA.id, orgB.id] }),
    ]);
    expect(one.enqueued + two.enqueued).toBe(2);
    const later = await tickSchedules({ now: new Date(now.getTime() + everyMs), types: [type], organizationIds: [orgA.id, orgB.id] });
    expect(later.enqueued).toBe(2);

    const rows = await adminDb.backgroundJob.findMany({ where: { type }, orderBy: { dedupeKey: "asc" } });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.dedupeKey)).toContain(`${type}:${slotFor(now, everyMs)}`);
  });

  it("flags a scheduled job that has missed two runs, but not a young organisation or a healthy one", async () => {
    const old = await createTestOrganization();
    const healthy = await createTestOrganization();
    const young = await createTestOrganization();
    const everyMs = 60_000;
    const now = new Date();
    await adminDb.organization.update({ where: { id: old.id }, data: { createdAt: new Date(now.getTime() - 10 * everyMs) } });
    await adminDb.organization.update({ where: { id: healthy.id }, data: { createdAt: new Date(now.getTime() - 10 * everyMs) } });
    const type = defineJob({ schedule: { everyMs }, handler: async () => undefined });
    await adminDb.backgroundJob.create({
      data: { organizationId: healthy.id, type, status: "SUCCEEDED", finishedAt: new Date(now.getTime() - everyMs) },
    });

    const missed = await checkMissedRuns({
      now,
      types: [type],
      organizationIds: [old.id, healthy.id, young.id],
      alert: false,
    });
    expect(missed.map((m) => m.organizationId)).toEqual([old.id]);
  });

  it("runs the notification sweep as a job per organisation", async () => {
    const org = await createTestOrganization();
    const result = await runNotificationsSweep({ jobKey: `test-sweep-${randomUUID()}`, organizationIds: [org.id] });
    expect(result.ran).toBe(true);
    const jobs = await adminDb.backgroundJob.findMany({ where: { organizationId: org.id, type: "notifications.sweep" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("SUCCEEDED");
  });
});

describe("job status API (FIG-1066, B2.18)", () => {
  it("Management sees this organisation's jobs with counts; Sales is refused; another organisation sees nothing", async () => {
    const org = await createTestOrganization();
    const other = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const otherManagement = await createTestContext(other.id, "MANAGEMENT");
    const type = defineJob({ handler: async () => undefined });
    await enqueueJobFor({ organizationId: org.id, type });
    await runDueJobs({ types: [type], organizationIds: [org.id] });
    await enqueueJobFor({ organizationId: org.id, type });

    const page = await listJobs(management, { type });
    expect(page.total).toBe(2);
    expect(page.counts).toMatchObject({ SUCCEEDED: 1, QUEUED: 1 });
    expect((await listJobs(management, { type, status: "QUEUED" })).items).toHaveLength(1);

    await expect(listJobs(sales)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listJobs(otherManagement, { type })).total).toBe(0);
    const foreignId = page.items[0]!.id;
    await expect(getJob(otherManagement, foreignId)).rejects.toBeInstanceOf(NotFoundError);
    // Row-level security backs the filter: the other organisation's context cannot read the row at all.
    expect((await listJobsForOrganization(other.id, {}, { skip: 0, take: 50 })).items.some((j) => j.id === foreignId)).toBe(false);
  });

  it("retries a dead-letter job and cancels a queued one, both audited; other states are refused", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const type = defineJob({ maxAttempts: 1, handler: async () => { throw new Error("nope"); } });
    const job = await enqueueJobFor({ organizationId: org.id, type });
    await runDueJobs({ types: [type], organizationIds: [org.id] });
    expect((await getJob(management, job.id)).status).toBe("DEAD");

    const retried = await retryDeadJob(management, job.id);
    expect(retried.status).toBe("QUEUED");
    expect(retried.attempts).toBe(0);
    await expect(retryDeadJob(management, job.id)).rejects.toThrow(/dead-letter/);

    const cancelled = await cancelJob(management, job.id);
    expect(cancelled.status).toBe("CANCELLED");
    await expect(cancelJob(management, job.id)).rejects.toThrow(/queued/);

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: job.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["job.retried", "job.cancelled"]);
  });

  it("rejects an unknown status filter", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    await expect(listJobs(management, { status: "BOGUS" })).rejects.toThrow(/Unknown job status/);
  });
});
