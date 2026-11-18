import { z } from "zod";
import type { BackgroundJob } from "@prisma/client";
import { isoDateTime } from "./common";
import { pageQueryShape } from "../../app/api/_lib/pageQuery";

export const JobStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "DEAD", "CANCELLED"]);

export const JobSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  status: JobStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  runAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  lastError: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTime,
});

export function toJobDto(job: BackgroundJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastError: job.lastError,
    requestId: job.requestId,
    createdAt: job.createdAt,
  };
}

export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  type: z.string().max(100).optional(),
  ...pageQueryShape,
});

export const ListJobsResponseSchema = z.strictObject({
  items: z.array(JobSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  pageCount: z.number().int(),
  nextCursor: z.string().nullable(),
  /** Jobs per status for this organisation. */
  counts: z.record(z.string(), z.number().int()),
});

export const ScheduleHealthResponseSchema = z.strictObject({
  schedules: z.array(
    z.strictObject({
      type: z.string(),
      everyMs: z.number().int(),
      missedTwoRuns: z.boolean(),
      lastSuccessAt: isoDateTime.nullable(),
    }),
  ),
});
