import type { Prisma } from "@prisma/client";

/**
 * The job catalogue (FIG-1066, B2.18). Code defines which kinds of job exist;
 * the `background_jobs` table holds the individual runs. A handler may run
 * more than once for the same job (a crashed worker's job is picked up again),
 * so every handler must be safe to repeat.
 */
export interface JobContext<P = unknown> {
  jobId: string;
  organizationId: string;
  type: string;
  payload: P;
  /** 1 for the first run. */
  attempt: number;
  requestId: string | null;
  /** Logger that already carries the organisation, job id and request id. */
  log: JobLogger;
}

export interface JobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface JobDefinition<P = unknown> {
  type: string;
  /** What the job did; stored as the job's result. */
  handler: (ctx: JobContext<P>) => Promise<Prisma.InputJsonValue | void>;
  /** Per-attempt time limit. Default 5 minutes. */
  timeoutMs?: number;
  /** Attempts before the job goes to the dead-letter list. Default 5. */
  maxAttempts?: number;
  /** First retry delay; doubles each attempt up to `maxBackoffMs`. Default 30 s. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** At most this many of this type run at once across all workers. Default: no limit. */
  concurrency?: number;
  /** Runs once per organisation every `everyMs`. */
  schedule?: { everyMs: number };
}

export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 60 * 60_000;

const definitions = new Map<string, JobDefinition<never>>();

export function registerJob<P = unknown>(definition: JobDefinition<P>): void {
  const existing = definitions.get(definition.type);
  // Re-registering the same type replaces it (hot reload, tests); the shape is the same.
  if (existing && existing === (definition as unknown as JobDefinition<never>)) return;
  definitions.set(definition.type, definition as unknown as JobDefinition<never>);
}

export function getJobDefinition(type: string): JobDefinition<unknown> | undefined {
  return definitions.get(type) as unknown as JobDefinition<unknown> | undefined;
}

export function listJobDefinitions(): JobDefinition<unknown>[] {
  return [...definitions.values()] as unknown as JobDefinition<unknown>[];
}

/** Test seam: forget a type registered by a test. */
export function unregisterJob(type: string): void {
  definitions.delete(type);
}

/** Delay before retry number `attempts` (the attempt that just failed): base, 2x, 4x, ... capped. */
export function backoffMs(definition: Pick<JobDefinition, "baseBackoffMs" | "maxBackoffMs"> | undefined, attempts: number): number {
  const base = definition?.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const cap = definition?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  return Math.min(cap, base * 2 ** Math.max(0, attempts - 1));
}
