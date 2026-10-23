# Background jobs (FIG-1066, B2.18)

Everything that runs outside a request goes through the job framework. Do not
build ad hoc schedulers.

## Pieces

| Piece | Where |
|---|---|
| Table `background_jobs` (RLS, one row per run) | `prisma/migrations/20261023140000_background_jobs` |
| Queue operations: enqueue, claim, complete, fail, requeue, cancel | `src/repositories/backgroundJobs.ts` |
| Job catalogue: one `registerJob` per type | `src/jobs/definitions.ts` |
| Runner: `runDueJobs`, `enqueueJobFor`, `enqueueAndRunNow`, schedules, missed-run check | `src/jobs/runner.ts` |
| Worker process | `npm run jobs:worker` (`scripts/jobs-worker.ts`) |
| Cron entry for serverless hosting | `GET /api/cron/jobs` |
| Status API for Management | `GET /api/orgs/{org}/jobs`, `/jobs/{id}`, `/retry`, `/cancel`, `/schedules` |

## How a job behaves

- A worker claims a due job under a lease (`FOR UPDATE SKIP LOCKED` plus an advisory lock per type for the concurrency limit). A crashed worker's job is picked up again after the lease expires, so every handler must be safe to repeat.
- Completing or failing is fenced by the lease, so a slow worker cannot overwrite the result of the one that took over.
- A failure retries with doubling backoff up to `maxAttempts`, then the job is DEAD (the dead-letter list). Management can retry or cancel from the status API; both are audited.
- A schedule (`schedule: { everyMs }`) enqueues one job per organisation per slot, keyed `<type>:<slot>`, so two schedulers never double-queue. A schedule that has missed two runs is flagged (`checkMissedRuns`).
- Every job carries the organisation and the request id, so a job only ever touches its own organisation.

## Job types

| Type | What | Schedule |
|---|---|---|
| `notifications.sweep` | Due and overdue task notifications, delivery retries | every few minutes |
| `notifications.expire` | Removes read notifications older than 90 days (unread are kept) | daily |
| `scores.recompute` | Lead scores and customer health | daily |
| `signals.refresh` | Adoption, stalled deals, overdue tasks for the dashboards | daily |
| `data.import` | One CSV import run (progress, cancel, error report) | on demand |
| `data.export` | One CSV export run (stored through the file service) | on demand |

`data.import` and `data.export` run once (`maxAttempts: 1`): the handler records its own failure on the `data_runs` row, and repeating an import would only repeat work.

## Adding a job

1. `registerJob({ type, handler, ... })` in `src/jobs/definitions.ts`.
2. A handler receives `{ organizationId, payload, log }`; return a small JSON result.
3. Test it with `runDueJobs({ organizationIds: [org.id], types: [...] })` or `enqueueAndRunNow`.
