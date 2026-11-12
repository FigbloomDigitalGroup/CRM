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
| Cron entry for serverless hosting | `GET /api/cron/jobs`, every 5 minutes or less (see "Scheduled work" in `docs/DEPLOYMENT.md`) |
| Vercel | Installed by `vercel.json`: `/api/cron/jobs` every 5 minutes, `/api/cron/notifications-sweep` every 30 minutes, `/api/cron/platform-maintenance` daily at 03:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`. Needs a Pro plan (Hobby allows daily crons only). Production does not use `npm run jobs:worker`. |
| Platform maintenance (belongs to no organisation, so not a job) | `GET /api/cron/platform-maintenance`, daily |
| Status API for Management | `GET /api/orgs/{org}/jobs`, `/jobs/{id}`, `/retry`, `/cancel`, `/schedules` |

## How a job behaves

- A worker claims a due job under a lease (`FOR UPDATE SKIP LOCKED` plus an advisory lock per type for the concurrency limit). A crashed worker's job is picked up again after the lease expires, so every handler must be safe to repeat.
- Completing or failing is fenced by the lease, so a slow worker cannot overwrite the result of the one that took over.
- A failure retries with doubling backoff up to `maxAttempts`, then the job is DEAD (the dead-letter list). Management can retry or cancel from the status API; both are audited.
- A schedule (`schedule: { everyMs }`) enqueues one job per organisation per slot, keyed `<type>:<slot>`, so two schedulers never double-queue. A schedule that has missed two runs is flagged (`checkMissedRuns`).
- Every job carries the organisation and the request id, so a job only ever touches its own organisation.

## Job types

The scheduler call `/api/cron/jobs` must fire **every 5 minutes or less**: `mail.sync` runs every 5 minutes, and queued jobs (`mail.send_scheduled`, `chat.notify`, `platform.org_export`) start late by up to the interval between calls. A 15 to 30 minute interval is not enough.

| Type | What | Schedule |
|---|---|---|
| `notifications.sweep` | Due and overdue task notifications, delivery retries | every 5 minutes or less (the interval of the `/api/cron/jobs` call, not 15 to 30) |
| `notifications.expire` | Removes read notifications older than 90 days (unread are kept) | daily |
| `scores.recompute` | Lead scores and customer health | daily |
| `signals.refresh` | Adoption, stalled deals, overdue tasks for the dashboards | daily |
| `lifecycle.sweep` | Customer lifecycle: dormant, renewal, back to active; tells the owners of customers that went dormant (`docs/LIFECYCLE_AND_RENEWALS.md`) | daily |
| `reminders.sweep` | Proposal follow-ups, renewals coming up, overdue invoices (`docs/LIFECYCLE_AND_RENEWALS.md`, `docs/PAYMENTS.md`) | daily |
| `automations.sweep` | Stalled deal alerts, keyed once per stall (`docs/AUTOMATIONS.md`) | daily |
| `privacy.retention` | Purges data past each retention period; does nothing under a legal hold (`docs/PRIVACY.md`) | daily |
| `files.purge` | Removes the bytes of deleted and quarantined files from the object store after 30 days (`DEFAULT_RETENTION_DAYS` in `src/services/fileService.ts`); the row stays with `purged_at` set | daily |
| `data.migration` | One phase of a data migration: validate, dry run, import or rollback (`docs/DATA_MIGRATION.md`) | on demand |
| `data.import` | One CSV import run (progress, cancel, error report) | on demand |
| `data.export` | One CSV export run (stored through the file service) | on demand |
| `webhooks.deliver` | Signed outbound webhook deliveries and retries with backoff (1, 3, 9, 27 minutes up to 6 hours, dead after 8 attempts) (`docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md`) | on demand, retried by the 5-minute sweep |
| `churn.hints.refresh` | Rules-based churn hints for customer owners (`docs/M17_LANE_D_ROLES_AND_CHURN.md`) | daily |
| `support_access.expire` | Ends support access windows that ran out (`docs/M17_LANE_A_SUPPORT_FLAGS_ANNOUNCEMENTS.md`) | every 5 minutes or less |
| `team_activity.digest` | Hourly and daily team activity digests for Management, grouped (`docs/TEAM_ACTIVITY_NOTIFICATIONS.md`) | every 5 minutes or less |

`data.import` and `data.export` run once (`maxAttempts: 1`): the handler records its own failure on the `data_runs` row, and repeating an import would only repeat work.

## Adding a job

1. `registerJob({ type, handler, ... })` in `src/jobs/definitions.ts`.
2. A handler receives `{ organizationId, payload, log }`; return a small JSON result.
3. Test it with `runDueJobs({ organizationIds: [org.id], types: [...] })` or `enqueueAndRunNow`.
