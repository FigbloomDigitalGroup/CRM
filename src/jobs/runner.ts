import { randomUUID } from "node:crypto";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import {
  claimJob,
  completeJob,
  enqueueJob,
  enqueueScheduledSlot,
  failJob,
  lastSuccessByOrganization,
  reclaimExpiredJobs,
} from "../repositories/backgroundJobs";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  backoffMs,
  getJobDefinition,
  listJobDefinitions,
  type JobContext,
  type JobDefinition,
} from "./registry";

/**
 * The job definitions import the services that run them, and those services import this runner to queue work, so importing the
 * definitions from here at the top made a cycle (runner -> definitions -> service -> runner). Webpack evaluates such a cycle in whatever
 * order the first importer happens to load, which broke the production build ("Cannot access ... before initialization"). They are
 * loaded on first use instead; every function below that reads the registry waits for this first.
 */
let definitionsLoaded: Promise<unknown> | null = null;
function ensureDefinitions(): Promise<unknown> {
  definitionsLoaded ??= import("./definitions");
  return definitionsLoaded;
}

/**
 * The job runner and scheduler (FIG-1066, B2.18). Anything can call these: the
 * worker script (`npm run jobs:worker`), the authenticated cron route, or a
 * test. They are safe to run from several processes at once.
 */

export class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`The job did not finish within ${ms} ms.`);
    this.name = "JobTimeoutError";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

export function newWorkerId(): string {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}

export type JobOutcome = "succeeded" | "retry" | "dead" | "lost" | "unknown-type";

export interface JobRunResult {
  jobId: string;
  organizationId: string;
  type: string;
  outcome: JobOutcome;
}

async function executeClaimed(job: BackgroundJob): Promise<JobRunResult> {
  await ensureDefinitions();
  const definition = getJobDefinition(job.type);
  const log = logger.child({ jobId: job.id, organizationId: job.organizationId, requestId: job.requestId, jobType: job.type });
  const base = { jobId: job.id, organizationId: job.organizationId, type: job.type };

  if (!definition) {
    // A job type this build does not know (a rollback, a typo). Dead-letter it
    // at once instead of retrying something that cannot succeed.
    log.error({}, "Job type is not registered; moved to the dead-letter list");
    await failJob(job, `No handler is registered for "${job.type}".`, 0, { forceDead: true });
    return { ...base, outcome: "unknown-type" };
  }

  const ctx: JobContext = {
    jobId: job.id,
    organizationId: job.organizationId,
    type: job.type,
    payload: job.payload,
    attempt: job.attempts,
    requestId: job.requestId,
    log,
  };

  try {
    const result = await withTimeout(definition.handler(ctx), job.timeoutMs);
    const settled = await completeJob(job, (result ?? null) as Prisma.InputJsonValue | null);
    if (!settled) {
      log.warn({}, "Job finished after its lease was lost; the result was dropped");
      return { ...base, outcome: "lost" };
    }
    log.info({ attempt: job.attempts }, "Job succeeded");
    return { ...base, outcome: "succeeded" };
  } catch (err) {
    const message = errorMessage(err);
    const state = await failJob(job, message, backoffMs(definition, job.attempts));
    log.error({ err, attempt: job.attempts, state }, "Job attempt failed");
    return { ...base, outcome: state === "lost" ? "lost" : state };
  }
}

export interface RunJobsOptions {
  workerId?: string;
  /** Stop after this many jobs. Default 50. */
  maxJobs?: number;
  /** Stop starting new jobs after this long. Default 25 s (fits a serverless cron call). */
  budgetMs?: number;
  /** Only these job types. */
  types?: string[];
  /** Only these organisations (test seam; real workers serve everyone). */
  organizationIds?: string[];
}

/** Recovers abandoned jobs, then runs due jobs until none are left or the budget is spent. */
export async function runDueJobs(options: RunJobsOptions = {}): Promise<{ reclaimed: number; results: JobRunResult[] }> {
  await ensureDefinitions();
  const workerId = options.workerId ?? newWorkerId();
  const maxJobs = options.maxJobs ?? 50;
  const deadline = Date.now() + (options.budgetMs ?? 25_000);
  const definitions = listJobDefinitions().filter((d) => !options.types || options.types.includes(d.type));

  const reclaimed = await reclaimExpiredJobs((type, attempts) => backoffMs(getJobDefinition(type), attempts));
  const results: JobRunResult[] = [];

  let progressed = true;
  while (progressed && results.length < maxJobs && Date.now() < deadline) {
    progressed = false;
    for (const definition of definitions) {
      if (results.length >= maxJobs || Date.now() >= deadline) break;
      const job = await claimJob({
        workerId,
        type: definition.type,
        concurrency: definition.concurrency ?? null,
        organizationIds: options.organizationIds,
      });
      if (!job) continue;
      progressed = true;
      results.push(await executeClaimed(job));
    }
  }
  return { reclaimed, results };
}

export interface EnqueueAndRunInput {
  organizationId: string;
  type: string;
  payload?: Prisma.InputJsonValue;
  requestId?: string;
  createdByMembershipId?: string;
  workerId?: string;
}

/**
 * Queues one job and runs it now in this process, with the same timeout,
 * retry bookkeeping and logging as a worker would give it. A failure leaves the
 * job queued for retry (or dead) exactly as it would be otherwise.
 */
export async function enqueueAndRunNow(input: EnqueueAndRunInput): Promise<JobRunResult & { job: BackgroundJob | null }> {
  await ensureDefinitions();
  const definition = getJobDefinition(input.type);
  const job = await enqueueJob({
    organizationId: input.organizationId,
    type: input.type,
    payload: input.payload,
    maxAttempts: definition?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    timeoutMs: definition?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    requestId: input.requestId,
    createdByMembershipId: input.createdByMembershipId,
  });
  const claimed = await claimJob({
    workerId: input.workerId ?? newWorkerId(),
    type: input.type,
    concurrency: null,
    jobId: job.id,
  });
  if (!claimed) {
    return { jobId: job.id, organizationId: job.organizationId, type: job.type, outcome: "lost", job };
  }
  const result = await executeClaimed(claimed);
  const final = await adminDb.backgroundJob.findUnique({ where: { id: job.id } });
  return { ...result, job: final };
}

/** Queues a job for a worker to pick up; returns at once. */
export async function enqueueJobFor(input: Omit<EnqueueAndRunInput, "workerId"> & { runAt?: Date }): Promise<BackgroundJob> {
  await ensureDefinitions();
  const definition = getJobDefinition(input.type);
  return enqueueJob({
    organizationId: input.organizationId,
    type: input.type,
    payload: input.payload,
    runAt: input.runAt,
    maxAttempts: definition?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    timeoutMs: definition?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    requestId: input.requestId,
    createdByMembershipId: input.createdByMembershipId,
  });
}

/** The scheduling slot a moment falls into for a given interval. */
export function slotFor(now: Date, everyMs: number): number {
  return Math.floor(now.getTime() / everyMs);
}

export interface TickOptions {
  now?: Date;
  organizationIds?: string[];
  types?: string[];
}

/**
 * Queues this interval's run of every scheduled job type for each active
 * organisation. Each (type, slot, organisation) is queued once however many
 * schedulers tick, so a missed tick is simply picked up by the next one.
 */
export async function tickSchedules(options: TickOptions = {}): Promise<{ enqueued: number }> {
  await ensureDefinitions();
  const now = options.now ?? new Date();
  const scheduled = listJobDefinitions().filter(
    (d): d is JobDefinition & { schedule: { everyMs: number } } =>
      !!d.schedule && (!options.types || options.types.includes(d.type)),
  );
  if (scheduled.length === 0) return { enqueued: 0 };

  const organizations = await adminDb.organization.findMany({
    where: { status: "ACTIVE", ...(options.organizationIds ? { id: { in: options.organizationIds } } : {}) },
    select: { id: true },
  });
  const organizationIds = organizations.map((o) => o.id);

  let enqueued = 0;
  for (const definition of scheduled) {
    const slot = slotFor(now, definition.schedule.everyMs);
    enqueued += await enqueueScheduledSlot({
      organizationIds,
      type: definition.type,
      dedupeKey: `${definition.type}:${slot}`,
      maxAttempts: definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      timeoutMs: definition.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      runAt: now,
    });
  }
  return { enqueued };
}

export interface MissedRun {
  organizationId: string;
  type: string;
  everyMs: number;
  lastSuccessAt: Date | null;
}

/**
 * Scheduled jobs that have not succeeded for two full intervals. A new
 * organisation is not blamed until it is old enough to have missed two runs.
 * Each one is logged as an error, which is what alerting listens for.
 */
export async function checkMissedRuns(options: { now?: Date; organizationIds?: string[]; types?: string[]; alert?: boolean } = {}): Promise<MissedRun[]> {
  await ensureDefinitions();
  const now = options.now ?? new Date();
  const scheduled = listJobDefinitions().filter((d) => d.schedule && (!options.types || options.types.includes(d.type)));
  if (scheduled.length === 0) return [];

  const organizations = await adminDb.organization.findMany({
    where: { status: "ACTIVE", ...(options.organizationIds ? { id: { in: options.organizationIds } } : {}) },
    select: { id: true, createdAt: true },
  });

  const missed: MissedRun[] = [];
  for (const definition of scheduled) {
    const everyMs = definition.schedule!.everyMs;
    const limit = now.getTime() - 2 * everyMs;
    const lastSuccess = await lastSuccessByOrganization(definition.type);
    for (const org of organizations) {
      if (org.createdAt.getTime() > limit) continue;
      const last = lastSuccess.get(org.id) ?? null;
      if (!last || last.getTime() < limit) {
        missed.push({ organizationId: org.id, type: definition.type, everyMs, lastSuccessAt: last });
      }
    }
  }
  for (const m of options.alert === false ? [] : missed) {
    logger.error(
      { organizationId: m.organizationId, jobType: m.type, lastSuccessAt: m.lastSuccessAt },
      "Scheduled job has missed two runs",
    );
  }
  return missed;
}
