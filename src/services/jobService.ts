import type { BackgroundJob, BackgroundJobStatus } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { checkMissedRuns } from "../jobs/runner";
import { listJobDefinitions } from "../jobs/registry";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import {
  cancelQueuedJob,
  countJobsByStatus,
  getJobForOrganization,
  listJobsForOrganization,
  requeueDeadJob,
} from "../repositories/backgroundJobs";
import { recordAuditEvent } from "../repositories/auditEvents";

/**
 * The job status API for Management (FIG-1066, B2.18): their organisation's
 * jobs only. The platform console reads the same table across organisations
 * later (PL9). Permission: `configuration.manage` (Management).
 */
const PERMISSION = "configuration.manage";

export const JOB_STATUSES: BackgroundJobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "DEAD", "CANCELLED"];

export interface JobListQuery extends PageRequest {
  status?: string;
  type?: string;
}

export async function listJobs(ctx: AuthContext, query: JobListQuery = {}) {
  requirePermission(ctx, PERMISSION);
  if (query.status && !JOB_STATUSES.includes(query.status as BackgroundJobStatus)) {
    throw new ValidationError("Unknown job status.", [
      { path: "status", message: `Use one of ${JOB_STATUSES.join(", ")}.` },
    ]);
  }
  const paging = resolvePaging(query);
  const { items, total } = await listJobsForOrganization(
    ctx.organizationId,
    { status: query.status as BackgroundJobStatus | undefined, type: query.type },
    paging,
  );
  return { ...buildPage(items, total, paging), counts: await countJobsByStatus(ctx.organizationId) };
}

/** Scheduled job types and whether each has run recently enough; a type that missed two runs is flagged. */
export async function getScheduleHealth(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const missed = await checkMissedRuns({ organizationIds: [ctx.organizationId], alert: false });
  return listJobDefinitions()
    .filter((d) => d.schedule)
    .map((d) => {
      const miss = missed.find((m) => m.type === d.type);
      return {
        type: d.type,
        everyMs: d.schedule!.everyMs,
        missedTwoRuns: !!miss,
        lastSuccessAt: miss ? miss.lastSuccessAt : null,
      };
    });
}

export async function getJob(ctx: AuthContext, jobId: string): Promise<BackgroundJob> {
  requirePermission(ctx, PERMISSION);
  const job = await getJobForOrganization(ctx.organizationId, jobId);
  if (!job) throw new NotFoundError("Job", jobId);
  return job;
}

/** Puts a dead-letter job back in the queue with a fresh attempt budget. */
export async function retryDeadJob(ctx: AuthContext, jobId: string): Promise<BackgroundJob> {
  requirePermission(ctx, PERMISSION);
  const job = await getJob(ctx, jobId);
  const { count } = await requeueDeadJob(ctx.organizationId, jobId);
  if (count === 0) {
    throw new ValidationError("Only a job in the dead-letter list can be retried.", [
      { path: "status", message: `This job is ${job.status}.` },
    ]);
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    actorUserId: ctx.userId,
    action: "job.retried",
    entityType: "BackgroundJob",
    entityId: jobId,
    metadata: { type: job.type },
  });
  return getJob(ctx, jobId);
}

/** Cancels a job that has not started. A running job cannot be cancelled. */
export async function cancelJob(ctx: AuthContext, jobId: string): Promise<BackgroundJob> {
  requirePermission(ctx, PERMISSION);
  const job = await getJob(ctx, jobId);
  const { count } = await cancelQueuedJob(ctx.organizationId, jobId);
  if (count === 0) {
    throw new ValidationError("Only a queued job can be cancelled.", [
      { path: "status", message: `This job is ${job.status}.` },
    ]);
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    actorUserId: ctx.userId,
    action: "job.cancelled",
    entityType: "BackgroundJob",
    entityId: jobId,
    metadata: { type: job.type },
  });
  return getJob(ctx, jobId);
}
