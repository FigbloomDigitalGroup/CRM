import { Prisma, type BackgroundJob, type BackgroundJobStatus } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";

/**
 * Data access for `background_jobs` (FIG-1066, B2.18).
 *
 * Two kinds of caller. The runner and the scheduler work across organisations
 * (a worker takes whichever job is next), so they use `adminDb`. Everything a
 * person triggers or reads (enqueue, list, retry, cancel) runs inside the
 * organisation's RLS context.
 */

export interface EnqueueInput {
  organizationId: string;
  type: string;
  payload?: Prisma.InputJsonValue;
  runAt?: Date;
  maxAttempts?: number;
  timeoutMs?: number;
  dedupeKey?: string;
  requestId?: string;
  createdByMembershipId?: string;
}

export function enqueueJob(input: EnqueueInput): Promise<BackgroundJob> {
  return withOrgContext(input.organizationId, (tx) =>
    tx.backgroundJob.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        payload: input.payload ?? {},
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts,
        timeoutMs: input.timeoutMs,
        dedupeKey: input.dedupeKey,
        requestId: input.requestId,
        createdByMembershipId: input.createdByMembershipId,
      },
    }),
  );
}

/**
 * Enqueues one scheduled slot for each organisation. A slot that already has a
 * job (another scheduler instance got there first) is skipped, which is what
 * makes two schedulers ticking at once safe. Returns how many were new.
 */
export async function enqueueScheduledSlot(input: {
  organizationIds: string[];
  type: string;
  dedupeKey: string;
  maxAttempts: number;
  timeoutMs: number;
  runAt: Date;
}): Promise<number> {
  if (input.organizationIds.length === 0) return 0;
  const { count } = await adminDb.backgroundJob.createMany({
    data: input.organizationIds.map((organizationId) => ({
      organizationId,
      type: input.type,
      dedupeKey: input.dedupeKey,
      maxAttempts: input.maxAttempts,
      timeoutMs: input.timeoutMs,
      runAt: input.runAt,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** The extra time a worker's lease outlives the job's own timeout, so a live worker never loses its job. */
export const LEASE_GRACE_MS = 30_000;

export interface ClaimOptions {
  workerId: string;
  /** Only claim this type. */
  type: string;
  /** At most this many jobs of the type may run at once, across all workers. */
  concurrency?: number | null;
  /** Claim one specific job (used for run-now). */
  jobId?: string;
  organizationIds?: string[];
}

/**
 * Takes the next due job of one type, or nothing. `FOR UPDATE SKIP LOCKED`
 * means two workers never take the same row, and a transaction-scoped advisory
 * lock on the type makes the concurrency check and the claim one step, so the
 * limit cannot be overshot by two workers counting at the same moment.
 */
export async function claimJob(options: ClaimOptions): Promise<BackgroundJob | null> {
  const { workerId, type, concurrency, jobId, organizationIds } = options;
  return adminDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"background_jobs:" + type}))`;

    if (concurrency != null) {
      const [{ running }] = await tx.$queryRaw<{ running: bigint }[]>`
        SELECT count(*)::bigint AS running FROM background_jobs
        WHERE type = ${type} AND status = 'RUNNING' AND lease_expires_at > now()`;
      if (Number(running) >= concurrency) return null;
    }

    const byId = jobId ? Prisma.sql`AND id = ${jobId}` : Prisma.empty;
    const byOrg =
      organizationIds && organizationIds.length > 0
        ? Prisma.sql`AND organization_id IN (${Prisma.join(organizationIds)})`
        : Prisma.empty;

    const rows = await tx.$queryRaw<BackgroundJobRow[]>`
      UPDATE background_jobs SET
        status = 'RUNNING',
        attempts = attempts + 1,
        locked_by = ${workerId},
        lease_expires_at = now() + (timeout_ms + ${LEASE_GRACE_MS}) * interval '1 millisecond',
        started_at = now(),
        finished_at = NULL,
        updated_at = now()
      WHERE id = (
        SELECT id FROM background_jobs
        WHERE status = 'QUEUED' AND run_at <= now() AND type = ${type} ${byId} ${byOrg}
        ORDER BY run_at, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return rows[0] ? fromRow(rows[0]) : null;
  });
}

interface BackgroundJobRow {
  id: string;
  organization_id: string;
  type: string;
  payload: Prisma.JsonValue;
  status: BackgroundJobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  timeout_ms: number;
  locked_by: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  last_error: string | null;
  result: Prisma.JsonValue | null;
  dedupe_key: string | null;
  request_id: string | null;
  created_by_membership_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function fromRow(r: BackgroundJobRow): BackgroundJob {
  return {
    id: r.id,
    organizationId: r.organization_id,
    type: r.type,
    payload: r.payload,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAt: r.run_at,
    timeoutMs: r.timeout_ms,
    lockedBy: r.locked_by,
    leaseExpiresAt: r.lease_expires_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    lastError: r.last_error,
    result: r.result,
    dedupeKey: r.dedupe_key,
    requestId: r.request_id,
    createdByMembershipId: r.created_by_membership_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Puts jobs whose worker vanished (lease expired while RUNNING) back in the
 * queue, or in the dead-letter state when their attempts are used up. The
 * claim already counted the attempt, so a job that always kills its worker
 * ends up dead instead of looping forever. Returns how many were recovered.
 */
export async function reclaimExpiredJobs(backoffMsFor: (type: string, attempts: number) => number): Promise<number> {
  const expired = await adminDb.backgroundJob.findMany({
    where: { status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
    select: { id: true, type: true, attempts: true, maxAttempts: true, lockedBy: true },
    take: 200,
  });
  let recovered = 0;
  for (const job of expired) {
    const dead = job.attempts >= job.maxAttempts;
    const { count } = await adminDb.backgroundJob.updateMany({
      // The lock holder is part of the match, so a job another reclaimer or the
      // owner itself just settled is left alone.
      where: { id: job.id, status: "RUNNING", lockedBy: job.lockedBy, leaseExpiresAt: { lt: new Date() } },
      data: dead
        ? {
            status: "DEAD",
            lockedBy: null,
            leaseExpiresAt: null,
            finishedAt: new Date(),
            lastError: "The worker stopped before finishing (lease expired) and no attempts are left.",
          }
        : {
            status: "QUEUED",
            lockedBy: null,
            leaseExpiresAt: null,
            runAt: new Date(Date.now() + backoffMsFor(job.type, job.attempts)),
            lastError: "The worker stopped before finishing (lease expired); trying again.",
          },
    });
    recovered += count;
  }
  return recovered;
}

/**
 * Records success, but only for the worker that still holds the job at this
 * attempt. If the lease was lost and someone else took it, the stale worker's
 * result is dropped, so one job never settles twice.
 */
export async function completeJob(
  job: Pick<BackgroundJob, "id" | "lockedBy" | "attempts">,
  result: Prisma.InputJsonValue | null,
): Promise<boolean> {
  const { count } = await adminDb.backgroundJob.updateMany({
    where: { id: job.id, status: "RUNNING", lockedBy: job.lockedBy, attempts: job.attempts },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      lockedBy: null,
      leaseExpiresAt: null,
      lastError: null,
      result: result ?? Prisma.JsonNull,
    },
  });
  return count === 1;
}

/** Records a failed attempt: back to the queue after a backoff, or to the dead-letter state when attempts are used up. */
export async function failJob(
  job: Pick<BackgroundJob, "id" | "lockedBy" | "attempts" | "maxAttempts">,
  error: string,
  backoffMs: number,
  options: { forceDead?: boolean } = {},
): Promise<"retry" | "dead" | "lost"> {
  const dead = options.forceDead === true || job.attempts >= job.maxAttempts;
  const { count } = await adminDb.backgroundJob.updateMany({
    where: { id: job.id, status: "RUNNING", lockedBy: job.lockedBy, attempts: job.attempts },
    data: dead
      ? { status: "DEAD", finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null, lastError: error }
      : {
          status: "QUEUED",
          runAt: new Date(Date.now() + backoffMs),
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: error,
        },
  });
  if (count !== 1) return "lost";
  return dead ? "dead" : "retry";
}

export interface JobListFilter {
  status?: BackgroundJobStatus;
  type?: string;
}

export function listJobsForOrganization(
  organizationId: string,
  filter: JobListFilter,
  paging: { skip: number; take: number },
) {
  const where: Prisma.BackgroundJobWhereInput = {
    organizationId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.type ? { type: filter.type } : {}),
  };
  return withOrgContext(organizationId, async (tx) => {
    const [items, total] = await Promise.all([
      tx.backgroundJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: paging.skip,
        take: paging.take,
      }),
      tx.backgroundJob.count({ where }),
    ]);
    return { items, total };
  });
}

export function getJobForOrganization(organizationId: string, jobId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.backgroundJob.findFirst({ where: { id: jobId, organizationId } }),
  );
}

export function countJobsByStatus(organizationId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.backgroundJob.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<
      Record<BackgroundJobStatus, number>
    >;
  });
}

/** Dead-letter job back to the queue with a fresh attempt budget. */
export function requeueDeadJob(organizationId: string, jobId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.backgroundJob.updateMany({
      where: { id: jobId, organizationId, status: "DEAD" },
      data: { status: "QUEUED", attempts: 0, runAt: new Date(), lastError: null, finishedAt: null },
    }),
  );
}

export function cancelQueuedJob(organizationId: string, jobId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.backgroundJob.updateMany({
      where: { id: jobId, organizationId, status: "QUEUED" },
      data: { status: "CANCELLED", finishedAt: new Date() },
    }),
  );
}

/** Latest successful finish of a type for each organisation, for the missed-run check. */
export async function lastSuccessByOrganization(type: string): Promise<Map<string, Date>> {
  const rows = await adminDb.backgroundJob.groupBy({
    by: ["organizationId"],
    where: { type, status: "SUCCEEDED" },
    _max: { finishedAt: true },
  });
  const map = new Map<string, Date>();
  for (const row of rows) if (row._max.finishedAt) map.set(row.organizationId, row._max.finishedAt);
  return map;
}
