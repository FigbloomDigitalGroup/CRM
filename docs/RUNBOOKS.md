# Runbooks and incident process (P1.04, FIG-1126)

Goal: anyone on the team can deploy, roll back and handle an incident, at 2 a.m., without asking the person who wrote the code.

Database: plain PostgreSQL, local for now, AWS later (Michael, 4 Nov 2026). Nothing here depends on a hosting vendor. This file links to the detailed documents instead of copying them: if a linked document and this one disagree, the linked document is right and this one needs fixing.

Status: **written; the rollback dry run is done on local staging: part 1 (image rollback) on 4 Nov 2026 (section 11a) and part 2 (database rollback, with a real additive and a real destructive migration) on 5 Nov 2026 (section 11b).** The team table-top exercise (section 10) is **deferred to hypercare by Given's waiver (decision 6.12, 5 Nov 2026)** and replaced for now by a desk walkthrough by one person (section 10, "Desk walkthrough, 5 Nov 2026"), which found gaps that are fixed below. The on-call table (section 9) is still empty.

## 0. If you only read one thing

1. Something is wrong in production. Open section 8 (incident process) and declare it. Decide the severity with the table there.
2. If it started with a deploy and it is Sev-1 or Sev-2: roll back the image (section 2). Do not debug first.
3. If data is lost, wrong or shown to the wrong organisation: stop writes, tell Given and Michael at once, then read sections 2 and 8.
4. Write down what you do, with the time, as you do it (the timeline log in section 8).
5. Never paste a password, token, connection string or customer data into chat, a ticket or a log.

## Index

| # | Runbook | Use it when |
|---|---|---|
| 1 | Deploy | Releasing a new version |
| 2 | Rollback | A release is bad, or data must go back |
| 3 | Migrations | A release changes the database |
| 4 | Secrets rotation | A secret leaked, someone left, or it is due |
| 5 | Job failures | Jobs are late, dead or not running |
| 6 | Finding the cause (quick checks) | Something is wrong and you do not know what |
| 7 | Where the commands live | You need an exact command |
| 8 | Incident process | Declaring, running and closing an incident |
| 9 | On-call and escalation | Who to call |
| 10 | Table-top exercise | Practising, three scenarios |
| 11 | Rollback dry-run checklist | Proving rollback works before it is needed |
| 11a | Dry-run results, 4 Nov 2026 | What the first dry run found and changed |

Related documents: [DEPLOYMENT.md](DEPLOYMENT.md) (image, environment variables, deploy sequence), [MIGRATION_REHEARSAL.md](MIGRATION_REHEARSAL.md) (upgrade runbook and the two temporary indexes), [BACKUP_RESTORE.md](BACKUP_RESTORE.md) (backups, restore, drill), [CUTOVER_PLAN.md](CUTOVER_PLAN.md) (the one-off go-live, rollback section 7), [GO_LIVE.md](GO_LIVE.md) (rollback triggers, severity definitions, hypercare), [JOBS.md](JOBS.md), [OBSERVABILITY.md](OBSERVABILITY.md) (alerts, metrics), [STAGING.md](STAGING.md), [STORAGE.md](STORAGE.md), [SECURITY_REVIEW_V1.md](SECURITY_REVIEW_V1.md), [SECURITY_SIGNOFF_V1.md](SECURITY_SIGNOFF_V1.md).

## 1. Deploy

Rule: **build once, migrate once, roll the replicas, smoke test.** Staging and production run the same image; only the environment variables differ. Never build a separate image for production. Never run migrations from every replica.

Before you start:

- The change is on `dev-given` with green CI (standing decision of 27 Oct 2026: nothing goes to `dev-staging` or `main` until Given says so).
- You know whether the release contains migrations (look in `prisma/migrations/` for folders newer than what production has). If it does, read section 3 first.
- No incident is open. Do not deploy during one.
- Deploys are not made at the end of the working day or on a day nobody is reachable.

Steps (details and the exact `docker run` commands are in [DEPLOYMENT.md](DEPLOYMENT.md), "Deploy sequence"):

1. **Note the current version.** Write down the image tag that is running now. This is your way back. Do not continue until you have it.
2. **If the release has migrations: take a backup first.** `pg_dump -Fc -f before-<version>.dump "$DATABASE_URL"` (store it off the database host; keep it until the release is signed off plus 30 days, per [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
3. **Build and push the image once:** `docker build -t figbloom-crm:<version> .`
4. **Run the migration step once** (not per replica): the image with `RUN_MIGRATIONS_ON_START=true` and a no-op command, which runs `prisma migrate deploy`, `db:bootstrap-role` and `db:grant-role` (command in [DEPLOYMENT.md](DEPLOYMENT.md) step 2). Then `npm run seed` (production-safe: it only reconciles the role and permission catalogue). **The image cannot run it** (it has no `src/` folder and the seed imports it): run it from a checkout of the same commit with `DATABASE_URL` pointing at the target, as in [STAGING.md](STAGING.md) "Local staging stack".
5. **Roll the replicas** onto the new image with `RUN_MIGRATIONS_ON_START` unset. One at a time if you have more than one; wait for `GET /api/health` to answer 200 `{"status":"ok"}` on each before the next.
6. **Smoke test.** Staging: `STAGING_URL=https://<staging host> npx tsx scripts/staging-smoke.ts` (add `STAGING_UAT_PASSWORD` for the signed-in part). Production: `npm run smoke:prod` with the `SMOKE_*` variables set (see [GO_LIVE.md](GO_LIVE.md) section 4); all 7 tests must pass, none skipped. **The smoke test is read-only: it cannot see a broken save.** After every deploy also, as a person in the browser, create one test lead and archive it, so the write path is exercised.
7. **Watch** the dashboards for 30 minutes ([OBSERVABILITY.md](OBSERVABILITY.md)): 5xx ratio, p95 latency, job lag, dead jobs, health. Do not walk away before that.
8. **Record** the version, time, who deployed, and the smoke result in the deploy log (a Linear comment on the release issue is enough).

If step 4, 5 or 6 fails: go to section 2 and apply the decision rule. Do not try a second deploy "to fix it" while production is down.

## 2. Rollback

Two different rollbacks exist. Choose with the decision rule below.

### 2a. Image rollback (fast, usually safe)

Put the previous image tag back on the replicas.

1. Take the tag you wrote down in deploy step 1. The tag must still exist on the host: if the new build re-used the same tag (for example `staging`), the old image is already gone. So give every release its own tag (`figbloom-crm:<version>`) and, before deploying, run `docker tag figbloom-crm:<current> figbloom-crm:<current>-prev`. `docker image ls figbloom-crm` shows what is there.
2. Roll the replicas back to it, one at a time, the same way you rolled them forward (`RUN_MIGRATIONS_ON_START` unset). Do **not** run the migration step again. With plain Docker that means removing the bad container and starting the old tag with the same environment (no values on the command line; use an env file kept outside the repo):

   ```bash
   docker logs <bad container> > incident-<date>.log 2>&1   # keep the evidence first: removing a container deletes its logs
   docker rm -f <bad container>
   docker run -d --name <name> --restart unless-stopped --network <network> -p <port>:3000 --env-file <env file> figbloom-crm:<previous tag>
   ```

   On a managed host use its "redeploy previous image" action. Measured on 4 Nov 2026: about 28 s from removing the bad container to the first `/api/health` 200 (next start takes 5 to 13 s, plus the check interval).
3. Check `GET /api/health` on each, then the smoke test (section 1, step 6). **On builds before 4 Nov 2026 `/api/health` proved only that the app could reach the database as the owner login.** Current builds also check the application role (`APP_DATABASE_URL`, answer 503 with `"appRole":"error"` when it cannot connect), and staging or production now refuses to boot with `APP_DATABASE_URL` unset. After a rollback or a secret change still sign in as a real user (the signed-in part of the smoke test does this); a failing sign-in while health is 200 means something else is wrong.
4. Announce (section 8 templates) and keep the incident open until the cause is known.

When it is safe: the release had **no migrations**, or its migrations were only additive (new tables or columns, new indexes) and the old code ignores them. Migrations only go forward; `prisma migrate deploy` never undoes one. The old code simply runs against the newer schema. If the release dropped, renamed or tightened anything (a column removed, a column made required, a constraint added), the old image may break against the new schema. Check the migration folders of the release before relying on this, and say so in the incident timeline. There is no automatic check for this.

### 2b. Database rollback (slow, loses data written since the backup)

Restore the pre-change backup into a new empty database and point the app at it. Full procedure and verification: [BACKUP_RESTORE.md](BACKUP_RESTORE.md) section 7; the same steps for the go-live are in [CUTOVER_PLAN.md](CUTOVER_PLAN.md) section 7.

1. Freeze: put the app in a state where nobody writes (stop the replicas and jobs, or show the maintenance notice). **Every change made after the backup is lost by this rollback.** Say that out loud to the incident lead before you start.
2. Take a dump of the broken database first, as evidence (`pg_dump -Fc -f broken-<date>.dump "$DATABASE_URL"`). Do not delete the broken database until the cause is known. If the database will not start (full disk, corruption) a dump is impossible: stop it and keep a copy or a volume snapshot of its data directory instead, if there is room, and say in the timeline that none was taken.
3. `createdb figbloom_restore_<date>` then `pg_restore --no-owner --no-privileges -d figbloom_restore_<date> before-<version>.dump`.
4. Run `npm run db:bootstrap-role` and `npm run db:grant-role` against the restored database (`APP_DB_PASSWORD` from the secret store). Roles are not inside a dump of one database; without this step the app cannot connect.
5. Verify: row counts against the numbers you recorded before the release (`npx tsx scripts/reconcile-counts.ts --source <url> --target <url>`, schema-owner URLs, exit code 0 means no difference), row-level security still on (`SELECT relrowsecurity FROM pg_class WHERE relname = 'organizations';` returns `t`).
6. Point `DATABASE_URL` and `APP_DATABASE_URL` in the secret store at the restored database, start the **previous** image, run the smoke test.
7. Unfreeze, announce, and write down what was lost (the time window between the backup and the freeze).

Timing: restore of the rehearsal database took 4 s ([MIGRATION_REHEARSAL.md](MIGRATION_REHEARSAL.md)); the RTO target is 1 hour including the people steps ([BACKUP_RESTORE.md](BACKUP_RESTORE.md) section 5, proposed, not yet confirmed). Timed on 5 Nov 2026 at small volume (section 11b): freeze to serving with the smoke test passing 29 s, people steps not included.

### 2c. Decision rule

Work down the list and stop at the first line that fits.

| Situation | Do this |
|---|---|
| Bad release, **no migrations** in it | Image rollback (2a) |
| Bad release, migrations that were only additive | Image rollback (2a). Leave the new schema in place. |
| Bad release, migrations that dropped or changed things the old code needs, and **nobody has written new data yet** (still in the freeze) | Database rollback (2b) then the old image |
| Same, but people **have** written data since | **Stop. Do not restore.** A restore throws that data away. Given decides, with Michael informed. Meanwhile keep the app down or read-only. |
| Data corrupted or deleted by a bug or a person, the app itself is fine | Database restore (2b) into a scratch database first; compare; Given decides what to bring back. Do not restore over live. |
| Data from one organisation seen by another, or payments or values seen by a role that must not see them | Treat as a security incident (section 8, Sev-1): stop access first (take the app down or flip the release flag off), then decide rollback. Do not roll back before you have saved the logs and the request ids as evidence. |
| Cannot tell | Roll back the image if the release was in the last 24 hours. A rollback you did not need costs minutes; a bad release left running costs users. |

Time limit (from [GO_LIVE.md](GO_LIVE.md) section 5): if it cannot be fixed within **30 minutes**, roll back. Decision maker: Given, with Michael informed. If Given cannot be reached within 15 minutes of a Sev-1, the person holding the on-call role rolls back the image (2a) and records that Given was not reachable. A database restore (2b) always waits for Given.

## 3. Migrations

Full upgrade runbook: [MIGRATION_REHEARSAL.md](MIGRATION_REHEARSAL.md), "Upgrade runbook". Backup and restore: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

Rules:

- Migrations run **once per deploy**, from the one-off step, never from each replica.
- A migration that works on a development database can lock a production table for a long time. Run the release against a restored copy first (the same command as the rehearsal) if the release has migrations and the data is large.
- Migrations only go forward. The backup taken before is the only way back.
- Never edit a migration that has been applied anywhere. Add a new one.

Order on the day:

1. Tell people the CRM is read-only for a few minutes; take the backup (deploy step 2).
2. **Temporary indexes for the deal-rules migration.** If the database holds more than a few thousand deals, and the release includes `20261023230000_deal_rules` (a database that has not yet had it; it is already applied on dev and test), create two temporary indexes **before** the migration, otherwise it locks `deals` for about 9.5 s at 3,500 deals and 40,000 activities, and the time grows with deals times activities:

   ```sql
   CREATE INDEX upgrade_tmp_activities_deal ON activities (deal_id);
   CREATE INDEX upgrade_tmp_communications_deal ON communications (deal_id);
   ```

   With them the migration took 0.7 s and the worst wait for a write was 681 ms. Run the upgrade in a quiet window either way.
3. `npm run migrate:deploy` (through the migration step of the image).
4. `npm run db:bootstrap-role` then `npm run db:grant-role` (the app role needs privileges on new tables; skipping this makes the app fail with permission errors on the new tables).
5. `npm run seed` (production-safe: only the role and permission catalogue).
6. `npx tsx scripts/backfill-organization-defaults.ts` after the first upgrade of an existing organisation (adds missing starting data, changes nothing that is there). Never call `seedOrganizationDefaults` without `fillOnly` on an existing organisation: it would undo renames made in settings.
7. **Drop the temporary indexes** once the upgrade has finished: `DROP INDEX upgrade_tmp_activities_deal; DROP INDEX upgrade_tmp_communications_deal;`. If you forget, nothing breaks, but writes to those tables carry the cost of two indexes nobody needs.
8. Check: sign in as Management, open Leads, Deals and Customer 360, and compare counts with the numbers recorded before.

If a migration fails half way: stop. Do not run it again blindly. Read the error, check `_prisma_migrations` for the row that did not finish, and ask the incident lead whether to restore (section 2b) instead. A failed migration leaves the database in the state PostgreSQL left it; Prisma will refuse the next `migrate deploy` until the failed row is resolved. There is no repo script for resolving it; the Prisma command is `npx prisma migrate resolve`, and using it is a decision for Given.

The decision for Given about editing that migration instead of using the temporary indexes is recorded in [MIGRATION_REHEARSAL.md](MIGRATION_REHEARSAL.md) finding 1; this runbook assumes the migration is unchanged.

## 4. Secrets rotation

General rules:

- New values are generated fresh (long and random) and stored **only** in the host's secret store (and the GitHub `staging` environment for staging). Never in git, chat, tickets or logs.
- Staging and production never share a value.
- Rotate on a schedule (proposal: every 6 months, to confirm with Given), whenever someone with access leaves, and **at once** if a leak is suspected.
- After every rotation write the date and who did it in the secret log (not the value).
- When in doubt, rotate everything the leaked secret could reach, and treat it as an incident (section 8).

### 4a. App database password (`APP_DB_PASSWORD`, used inside `APP_DATABASE_URL`)

1. Generate the new password and put the new `APP_DB_PASSWORD` and the matching `APP_DATABASE_URL` in the secret store (do not restart anything yet).
2. Run `npm run db:bootstrap-role` with the **new** `APP_DB_PASSWORD` and the owner `DATABASE_URL`: it updates the existing role's password (this is the documented rotation, [DEPLOYMENT.md](DEPLOYMENT.md) "Secrets handling").
3. Roll the replicas (and the jobs worker) so they pick up the new `APP_DATABASE_URL`.
4. Check `GET /api/health` and sign in.
5. Record it.

If you skip step 3: the running replicas still hold the old password and start failing with authentication errors as soon as they open a new connection (existing connections keep working for a while, so it can look fine at first). If you do step 2 before putting the value in the secret store, a restart will bring the app back with the old password and it will not connect. Anything else that connects as `figbloom_app` (the jobs worker, any cron container) must also be restarted.

The owner credential in `DATABASE_URL` (the schema-owner login) is rotated in the database itself (`ALTER ROLE ... PASSWORD`) and then in the secret store; no script in the repo does it. It is only used by the migration step and admin scripts, so update the secret store and the deploy pipeline together.

### 4b. `CRON_SECRET`

Used by `GET /api/cron/notifications-sweep` and `GET /api/cron/jobs`.

1. Generate the new value.
2. Put it in the secret store and restart the replicas.
3. **Immediately** update the scheduler that calls the cron routes (crontab, platform cron, GitHub workflow) to send the new value.
4. Test: call the route with the new value and expect 200; the old value must now return 401.

If you skip step 3: the scheduled calls get refused, nothing runs the notifications sweep or the scheduled jobs, and job lag starts to grow (alert at 600 s). If `CRON_SECRET` is unset the route refuses to run at all (500); that is deliberate. If you run the worker (`npm run jobs:worker`) it does not use this secret, so jobs continue; only the HTTP triggers break.

### 4c. `METRICS_TOKEN`

1. Generate the new value and put it in the secret store; restart the replicas.
2. Update the metrics scraper and the alert stack with the new token.
3. Test: `curl -H "Authorization: Bearer <new token>" https://<host>/api/metrics` returns the metrics; the old token returns an error.

If you skip step 2: the scrape fails, the "Metrics gone" alert fires after 3 minutes, and **all the alerts that depend on metrics go blind** (error rate, latency, job lag). The uptime probe on `/api/health` keeps working. Unset means the route answers 404.

### 4d. Storage keys

Follow [STORAGE.md](STORAGE.md) "Rotating the storage credentials" (S3 driver: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; local driver: `STORAGE_SIGNING_SECRET`).

S3 keys, in order:

1. Create a second access key for the same identity (two keys active).
2. Put the new pair in the secret store and restart the replicas.
3. Test an upload, a download and a delete in the app.
4. Disable the old key, watch for access errors for a day, then delete it.

If you disable the old key before step 2 is live everywhere: uploads and downloads fail with access errors for every replica still on the old key. Links already handed out stop working when the old key is disabled; they live 60 seconds, so users only retry.

Local driver: changing `STORAGE_SIGNING_SECRET` and restarting invalidates every outstanding signed link at once (links are short-lived, so this is a minor annoyance, not an outage). In production the secret is required: without it the app refuses to start the local driver.

The backup credentials are separate from the application's ([BACKUP_RESTORE.md](BACKUP_RESTORE.md) section 6): rotate them separately, and test a backup and a restore afterwards.

### 4e. Session secret

**There is no session secret in production.** Real sessions are random tokens stored hashed in the `sessions` table (`src/auth/session.ts`), so there is no key to rotate. `DEV_SESSION_SECRET` only signs the dev sign-in cookie, which cannot work in production and must be **omitted** there ([DEPLOYMENT.md](DEPLOYMENT.md)). If it is set in production, remove it.

What you actually do when sessions might be stolen (a leak, a lost laptop, a suspected breach):

1. Sign everyone out by ending every active session in the database. There is no script or admin screen for "all users"; Management can end one user's sessions from their security settings. For everyone, use the owner connection:

   ```sql
   UPDATE sessions SET revoked_at = now(), revoked_reason = 'REVOKED' WHERE revoked_at IS NULL;
   ```

   The next request from every device is refused and the user signs in again. Take care: this signs out everyone in every organisation. Get the incident lead's approval first.
2. Force password resets for any affected user (the password reset flow ends their sessions with reason `PASSWORD_RESET`).
3. If a user's sessions only need ending, use the "sign out other devices" action or the user's security settings rather than SQL.

If you skip step 1 after a stolen cookie: the thief stays signed in until the session's own expiry (4 to 24 hours by organisation policy, never past its absolute expiry).

### 4f. Other keys (for completeness)

Website and inbound-email keys rotate in settings with a 24-hour grace window (up to 72) ([SECURITY_REVIEW_V1.md](SECURITY_REVIEW_V1.md)). `SMTP_PASS`, the error-tracking auth token and the antivirus settings are changed in the secret store and need a restart; test a password-reset email after changing the mail login.

## 5. Job failures

How the job framework works: [JOBS.md](JOBS.md). Do not build ad hoc schedulers and do not fix jobs by hand in the database unless this section says so.

### What "failing" looks like

| Symptom | Likely meaning |
|---|---|
| Alert "Job lag" (over 600 s, page over 1800 s) | Jobs are due but nothing is running them: the worker is down, the cron call is not firing, or every worker is busy |
| Alert "Dead jobs" (any, increasing over 15 min) | A job type is failing every attempt and went to the dead-letter list |
| Users say notifications or reminders stopped | The notifications sweep is not running (see below) |
| `GET /api/health` shows an old `lastCompletedAt` in `notificationsSweep` | Same |

### Reading job lag from `/api/metrics`

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://<host>/api/metrics | grep figbloom_job
```

| Line | Meaning |
|---|---|
| `figbloom_job_lag_seconds{type="..."}` | Age in seconds of the oldest queued job that is already due, per job type. 0 or absent is good. Over 600 is the warning, over 1800 pages. |
| `figbloom_jobs_queued{type="..."}` | Waiting jobs |
| `figbloom_jobs_running{type="..."}` | Jobs being run now |
| `figbloom_jobs_dead{type="..."}` | Jobs that used up their attempts (the dead-letter list) |

Read it like this: lag high and `running` 0 means nobody is working (check the worker or the cron call). Lag high and `running` above 0 for a long time means a slow or stuck handler. `dead` above 0 means a handler fails every time. The gauges come from the database, so any replica shows the same numbers; the request counters are per process.

### Steps

1. **Is something running the jobs?** Either a worker (`npm run jobs:worker`, one or several; `--once` runs one pass and exits) or an external scheduler calling `GET /api/cron/jobs` with `CRON_SECRET`. If neither is running, start the worker or fix the scheduler. After a restart the worker recovers jobs a stopped worker left behind (log line "Recovered jobs left behind by a stopped worker"); a job whose lease expired is picked up again, so handlers are safe to repeat.
2. **Is the secret right?** A scheduler that gets 401 or 500 from the cron route has the wrong or missing `CRON_SECRET` (section 4b).
3. **Look at the failing jobs.** Management can list and inspect jobs through the API (`GET /api/orgs/{org}/jobs`, `/jobs/{id}`, `/jobs/schedules`; documented in [API_REFERENCE.md](API_REFERENCE.md)); there is no screen or script for it in this repo. Search the logs for the job's `requestId`, and the error tracker for the error.
4. **Dead jobs (dead-letter).** A failure retries with doubling backoff up to `maxAttempts`, then the job is DEAD. Fix the cause first (a dead job retried before the fix just dies again), then Management retries it (`POST /api/orgs/{org}/jobs/{id}/retry`) or cancels it (`.../cancel`); both are audited. `data.import` and `data.export` run once (`maxAttempts: 1`) and record their own failure on the data run: ask the user to start a new run rather than retrying.
5. **The notifications sweep.** It is itself a job (`notifications.sweep`) and also has its own CLI and cron route. To run it once by hand: `npm run notifications:sweep`. It claims a lock row so two runs cannot double-send; a skipped run just means the next one catches up. If the sweep reports that it is already running and never finishes, the stale lock is reclaimed after 3 times `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` (default 15 minutes, so 45).
6. **Missed schedules.** A schedule that has missed two runs is flagged (`checkMissedRuns`); the worker checks every 10 minutes. After the worker is back, `tickSchedules` queues the current slot; slots missed during the outage are not replayed one by one.
7. **Confirm.** Lag falls back to 0 within a few minutes and the dead count stops rising. Resolve the alert, and write what failed in the timeline if an incident was open.

Severity: a job failure alone is Sev-3 (a workaround exists: nothing is lost, work is late) unless it blocks a main flow, in which case Sev-2. Retention jobs (`privacy.retention`) failing silently is worth a Linear issue the same day.

## 6. Finding the cause (quick checks)

Do these in order; each takes a minute.

1. `GET /api/health`. 503 or no answer: the database or the app is down. (A wrong owner password makes the production guard stop the app about 25 s after the container starts, so you see a restart loop and "connection refused" rather than a 503; `docker logs <container>` says "Refusing to start in production: could not check whether dev accounts exist".) 200: continue, but 200 does **not** clear the app role: a wrong `APP_DATABASE_URL` password still gives 200 (section 11a). Sign in as a test user too.
2. Is it everyone or one organisation, one role, one screen? Ask in the incident channel.
3. Did a deploy or a secret change happen in the last 24 hours? Rollback candidates are there (section 2).
4. Dashboards ([OBSERVABILITY.md](OBSERVABILITY.md)): 5xx ratio, p95, job lag, dead jobs.
5. Take a failing request's id (the `x-request-id` response header, or the `requestId` in the error body), and search the logs for it. The error tracker event carries the same id.
6. Database reachable? Disk full? Connections exhausted? (Look at the host, not the app.)
7. Backups: did last night's backup run and is its size normal? (An alert exists for failure; "no news" is not good news.)

## 7. Where the commands live

Every command used above exists in the repo; this table is the check.

| Command | Where |
|---|---|
| `npm run migrate:deploy`, `db:bootstrap-role`, `db:grant-role`, `seed` | `package.json` |
| `npm run jobs:worker`, `notifications:sweep` | `package.json`, `scripts/jobs-worker.ts`, `scripts/notifications-sweep.ts`. **Run them from a checkout, not from the production image:** the image has `scripts/` but no `src/`, and the worker fails there with "Cannot find module '../src/db/adminClient'" (checked 4 Nov 2026). Until a worker image exists, use the cron route `GET /api/cron/jobs` with `CRON_SECRET` as the scheduler. |
| `npm run seed` | `package.json`, `prisma/seed.ts` (imports `src/`: checkout only, not the image) |
| `npm run smoke:prod` | `package.json`, `e2e/smoke/` |
| `npm run staging:smoke` (or `npx tsx scripts/staging-smoke.ts`) | `package.json`, `scripts/staging-smoke.ts` (run from a checkout; it needs only HTTP access) |
| `npm run backup:drill` (or `npx tsx scripts/backup-drill.ts [database]`) | `package.json`, `scripts/backup-drill.ts` |
| `npm run reconcile:counts` (or `npx tsx scripts/reconcile-counts.ts --source <url> --target <url>`) | `package.json`, `scripts/reconcile-counts.ts` |
| `npx tsx scripts/backfill-organization-defaults.ts [slug]` | `scripts/backfill-organization-defaults.ts` (imports `src/`: checkout only, not the image) |
| `npx tsx scripts/migration-rehearsal.ts` | `scripts/migration-rehearsal.ts` |
| `pg_dump`, `pg_restore`, `psql` | PostgreSQL tools (not in the repo, not in the app image, not installed on this Windows computer). On local staging they exist **inside the Postgres container**, for example `docker exec figbloom_crm_staging_postgres pg_dump -Fc -U <owner> -d <database> > file.dump` (redirect, so the file lands on the host) |

What does **not** exist, and what to do instead:

- A one-command rollback. Image rollback is done in the host's own deploy tool (or the `docker rm` and `docker run` pair in section 2a); database rollback is section 2b by hand.
- A health check that covers the app role, or a start-up check that fails when `APP_DATABASE_URL` is missing or wrong (section 11a, findings 1 and 2).
- A script or screen to sign out all users or to list dead jobs across organisations. Use the SQL in section 4e and the per-organisation jobs API.
- A resolver for a half-applied migration. Use Prisma's `migrate resolve` with Given's decision.
- A "maintenance mode" switch. Stop the replicas or put the notice at the host or load balancer. If you need one, raise it as an issue.
- An on-call tool. Section 9 is a plain table.

## 8. Incident process

### Declare

Anyone can declare an incident. Declare early; closing a false alarm costs nothing. To declare: post in the team channel "INCIDENT: <one line>, declared by <name> at <time>", open a Linear issue titled `INCIDENT <date> <one line>` (no customer data in it), and start the timeline log below. Then set the severity.

### Severity

Same definitions as [GO_LIVE.md](GO_LIVE.md) (that table is the source; if it changes, change this one).

| Sev | Meaning | Response | Fix target |
|---|---|---|---|
| Sev-1 | Production down; data loss or corruption; cross-organisation exposure; payments or values shown to a role that must not see them; nobody can sign in | Immediately, whoever is available | Same day, or roll back |
| Sev-2 | A main V1 flow is broken for a role with no workaround (create lead, move deal, record payment) | Within 2 hours | 1 working day |
| Sev-3 | A flow is broken but a workaround exists; wrong data shown but not harmful | Within 1 working day | 3 working days |
| Sev-4 | Cosmetic, copy, minor annoyance | Triaged daily | Backlog, by priority |

If unsure between two, take the higher one and lower it later. Only Given and Michael change a severity after it is set; the incident lead may raise it at any time.

Alerts map roughly as: health down, or 5xx above 2% for 3 minutes, is Sev-1 until shown otherwise; job lag and dead jobs are Sev-3 unless a main flow is blocked; a new error group in the tracker is triaged by the rules in [OBSERVABILITY.md](OBSERVABILITY.md).

**Security incidents** (tenant exposure, masked values or payments shown to the wrong role, leaked secret, suspicion of either) are always Sev-1. Extra rules: save the evidence first (logs, request ids, a dump of the affected state), do not delete or "tidy" anything, tell Given and Michael at once, and do not discuss it outside the incident channel. The data protection side (notifying the regulator or affected customers) is a decision for Given and Michael with the checklist in `docs/DATA_PROTECTION_CHECKLIST.md`; the on-call person does not make it alone. If personal data may have been exposed, Given decides with legal advice whether the Data Commissioner and the affected people must be told; the Kenya DPA period is 72 hours for the Commissioner (to be confirmed by the lawyer, `docs/DATA_PROTECTION_CHECKLIST.md` row 14). Write the time the incident was detected in the timeline; the period runs from awareness.

### Roles

| Role | Does | Does not |
|---|---|---|
| **Incident lead** | Owns the incident, decides what to try next, calls the rollback, sets the pace, assigns the rest | Does the typing and the investigating themselves: delegate |
| **Communications lead** | Writes and sends every message to users and to Management, keeps the timeline log, tells people the next update time | Does not debug |
| Responders | Investigate and fix as the lead directs | Do not change things without telling the lead |

Sev-1: both roles must be filled by two different people. If only one person is available, they are the incident lead and tell Given and Michael they are alone. Sev-2: one person may hold both. The first person to respond is the incident lead until they hand it over out loud ("you are now incident lead"); handovers go in the timeline.

### Cadence

Sev-1: status message every 30 minutes, even if it says "no change". Sev-2: every 2 hours. Sev-3: when it changes.

### Communication templates

**Users (first message)**

```
Subject: FigBloom CRM: we are looking into a problem

We are aware that <what people see, in plain words, for example "the CRM is slow or
unavailable"> since <time, with time zone>. We are working on it now.
You can <workaround, or "there is nothing you need to do">.
Please do not <what to avoid, if any>.
Next update by <time>.
```

**Users (update)**

```
Update <time>: <what we know now, one or two sentences>. <What we are doing next>.
Next update by <time>.
```

**Users (resolved)**

```
Resolved <time>: the problem with <what> is fixed. It affected <who> from <start> to <end>.
<If data was affected: what was lost or needs re-entering, and how people will be told.>
We will share what happened and what we are changing within <N> working days.
```

**Management (first message, send within 30 minutes of a Sev-1 and within 2 hours of a Sev-2)**

```
Subject: INCIDENT Sev-<n>: <one line>

Declared: <time>   Incident lead: <name>   Communications lead: <name>
Impact: <who and what is affected; how many organisations or users if known>
Data at risk: <none known / possible loss / possible exposure of: ...>  (never include the data itself)
What we know: <facts only, no guesses>
What we are doing: <current action>
Decision needed from you: <for example "approve database rollback", or "none">
Next update: <time>
```

**Management (closing)**

```
Subject: INCIDENT Sev-<n> closed: <one line>

Duration: <start> to <end>   Customers affected: <...>   Data affected: <...>
Cause (short): <...>   Fix: <...>
Follow-ups: <Linear issues>   Post-incident review: <date>
```

Rules for every message: plain words, no blame, no guesses stated as facts, no customer data, no secrets, no masked values (deal values, margins, costs, payments).

**To users after a database restore** (Given approves before it goes out):

> We had a problem with our database and restored it from the backup taken at <time> on <date>. Anything you entered or changed after <time> is lost. Please check what you did between <time> and <time> and enter it again. We are sorry. Everything else is as it was. We will tell you when the cause is fixed.

### Timeline log

Keep one running list in the incident's Linear issue (or a shared note), one line per event, in UTC or one named time zone, written as it happens.

```
<time>  <who>  <what happened or what was done>  <result>
09:02  Given    Alert: health down                    declared Sev-1
09:04  Given    Incident lead = Given, comms = (name)
09:07  (name)   Checked /api/health: 503              database unreachable
09:12  (name)   Restarted the database host           health 200 at 09:14
```

Log: when it started, when it was noticed, when it was declared, every action and result, every decision and who made it, every message sent, severity changes, handovers, and when it ended.

### Closing

An incident is closed when users are back to normal, the final messages are sent, the timeline is complete, the follow-up issues exist, and the post-incident review is booked (Sev-1 and Sev-2: within 5 working days).

### Post-incident review template

Blameless: we look at how the system and the process let it happen, not at who was on duty.

```
Incident: <title>   Severity: <n>   Date: <date>   Review date: <date>   Attendees: <...>

Summary (3 sentences): what happened, who was affected, how it ended.
Impact: users and organisations affected, duration, data lost or exposed (yes/no, what), money or contracts (if any).
Timeline: (paste the log, then mark: start, detected, declared, mitigated, resolved)
Detection: how did we find out? alert, user, someone looking? Time from start to detection: __
Response: time from detection to declaration __; to mitigation __; to resolution __.
Root cause: (the chain of reasons, "why" asked five times, ends in a cause we can change)
What went well:
What went badly or was lucky:
Did the runbook help? Which step was missing, wrong or unclear? (fix this file the same week)
Actions: (each with a Linear issue, an owner and a date)
  1.
  2.
Prevent / detect sooner / respond faster / reduce the damage: one action for each at least.
Sign-off: Given __   Michael __   Date __
```

## 9. On-call and escalation

Not filled in. **Given must name the people**; this document does not invent anyone. The only names in the project are Given and Michael. Until the table is filled, the escalation path in the last row is the whole process.

Alerts page the team channel and the on-call phone ([OBSERVABILITY.md](OBSERVABILITY.md)); that wiring is a human task and is not done yet.

| Role / duty | Name | Phone | Backup (name and phone) | Hours covered | Notes |
|---|---|---|---|---|---|
| Primary on-call (first responder, starts as incident lead) | | | | | |
| Secondary on-call (takes over if primary does not answer in 15 minutes) | | | | | |
| Communications lead (Sev-1) | | | | | |
| Database / backup recovery key holder 1 | | | | | Two holders are required by [BACKUP_RESTORE.md](BACKUP_RESTORE.md) section 6 |
| Database / backup recovery key holder 2 | | | | | |
| Host or cloud account access (can restart servers, change secrets) | | | | | |
| Management decision (rollback, severity, customer notice) | Given | | | | Name taken from the project; phone to fill |
| Management escalation | Michael | | | | Informed of every Sev-1 and Sev-2; phone to fill |

Escalation path:

| Time since the alert | If nobody has acknowledged | Who |
|---|---|---|
| 0 min | Page the primary | Primary on-call |
| 15 min | Page the secondary and tell Given | Secondary on-call |
| 30 min | Phone Given; if Given cannot be reached phone Michael | Anyone |
| 60 min and still down | Sev-1 with nobody in charge: whoever reads this takes the incident lead role and follows section 0 | Anyone |

Acknowledge means a person is looking, said so in the channel, and has taken the incident lead role.

Things to fill in once and keep current: the team channel name, the uptime and alert service login holder, where the secret store is, where the backups are and who can decrypt them, the host's console address. Put these in the secret store or the team's password manager, not in this file.

## 10. Table-top exercise

Purpose: practise the process with nothing at risk. Nobody touches production. One facilitator reads the script, two or three people play the incident lead, communications lead and responder, and one person writes the timeline. Allow 90 minutes for all three scenarios (30 each). Run it **before go-live**, with the people named in section 9, and again after any change to this file's process.

Ground rules: use these documents (not memory); say out loud what you would do and the exact command; the facilitator answers only with what the scenario says; stop the clock when the "resolved" message is drafted.

For each scenario: declare, set a severity, assign roles, write the first user message and the first Management message from the templates in section 8, and say which runbook sections you used.

### Scenario A: a bad deploy

Script:

1. 14:05. You deployed version N 10 minutes ago. It included one migration that adds a column.
2. 14:15. Alert: 5xx ratio 6% for 3 minutes. Two users message that saving a deal gives an error. The smoke test from the deploy had passed.
3. 14:20. Logs show an error on deal save in one code path; no data looks wrong.
4. Facilitator injects: Michael asks "can we just fix it forward?"
5. 14:30. Facilitator: the fix is not found yet.

Discuss and decide: severity (Sev-2 or Sev-1?); the decision rule (section 2c: additive migration, so image rollback); who rolls back; what to check afterwards; what to tell users; what goes in the review.

Success looks like: declared within 5 minutes; rollback of the image chosen without a database restore; the new column left in place; smoke test after; the Management message sent; nobody pasted a secret.

### Scenario B: database restore needed

Script:

1. 02:10. Health down alert. `/api/health` returns 503.
2. 02:20. The database host's disk filled; the database is corrupted and will not start. The last nightly dump finished at 01:00 and its size is normal. No WAL archive exists (the V1 default in [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
3. Facilitator injects: only one of the two recovery key holders answers the phone.
4. Facilitator injects: a user phones saying "I entered 20 deals this morning".
5. The restore scratch host is a fresh server.

Discuss and decide: Sev-1; incident lead and communications lead; the data lost is everything since 01:00, who says so and who approves the restore (Given; section 2c); the restore steps (section 2b, which runs roles after the restore and checks counts and row-level security); what the RTO target is and whether you are within it; what to tell the user who entered deals; what happens to the corrupted database (keep it as evidence); backup check that night.

Success looks like: Given asked before restoring; the restore goes into a new database; roles run; reconciliation or count check done; the data-loss window stated to users in plain words; the timeline records every step.

### Scenario C: tenant-isolation breach suspected

Script:

1. 11:30. A user from organisation X reports that they saw a company name that is not theirs on the Companies screen. Gone after a refresh.
2. 11:40. Facilitator: the error tracker shows nothing unusual. The request id the user supplied is in the logs; the response was a normal 200.
3. Facilitator injects: Finance in organisation Y says a payment amount showed in a Sales screenshot a colleague sent.
4. Facilitator injects: a journalist's email address is on the user's message.
5. 12:15. A release went out yesterday that changed a list query.

Discuss and decide: Sev-1 (security incident, section 8); do not tidy anything; save evidence (the request id, logs, screenshots) first; who decides to take the app down or flip the release flag off; whether to roll back the image (yesterday's release) after saving evidence; who talks to the journalist (not the responders: Given and Michael); the data protection checklist; whether other organisations could be affected and how to check without reading customer data (counts, ids and the cross-organisation tests, never contents); the Management message must not include the data seen.

Success looks like: evidence saved before any change; Given and Michael told within minutes; nobody replies to the journalist; the lead says plainly what is and is not known; the review lists a regression test for the leaking query (hard rule 8).

### Table-top results (fill in)

| Date | Scenario | Facilitator | Players (lead / comms / responder) | Time to declare | Time to decision | Gaps found in the runbooks | Fixes (issue ids) | Result |
|---|---|---|---|---|---|---|---|---|
| (not run yet) | A bad deploy | | | | | | | |
| (not run yet) | B database restore | | | | | | | |
| (not run yet) | C tenant breach | | | | | | | |

Acceptance for FIG-1126: the three rows are filled, the gaps are fixed in this file, and Given has seen them. **Waived for now (decision 6.12): no team is available before go-live. The team exercise is held in the first production week; until then the desk walkthrough below stands in for it.**

### Desk walkthrough, 5 Nov 2026

One person (an AI assistant working for Given) walked scenarios A, B and C against these runbooks, step by step and command by command, with nobody playing the roles and nothing run in production. This finds gaps in the text; it does not test how people behave, who picks up the phone, or how long a decision takes. Result per scenario and the gaps found:

| # | Scenario | Gap found | Fixed here? |
|---|---|---|---|
| 1 | A, C | **Rolling back an image deleted the evidence.** Section 2a removed the bad container with `docker rm -f`, which deletes its logs, while section 2c says to save logs and request ids first. | Yes: the log is saved before the removal (2a step 2). Production also needs logs kept outside the container (a log driver or shipper); not built. |
| 2 | A | **The smoke test passed while saving a deal was broken**, as the scenario says. The suite is read-only by design. | Text: deploy step 6 now adds a manual create-and-archive of a test lead. A safe write check in the production smoke suite is a possible follow-up. |
| 3 | B | **The scenario assumes a 01:00 nightly dump, and no job takes one.** `docs/BACKUP_RESTORE.md` defines the nightly dump and the `backup:drill` script proves restore, but nothing runs a nightly backup on staging or production. Scenario B could not be carried out today. | **No. Open and serious**: a go-live blocker that needs a backup job (a container or host job that runs `pg_dump -Fc`, keeps 14 daily, alerts when a day is missing) and backup storage. Proposed to Given. |
| 4 | B | An evidence dump of a database that will not start is impossible. | Yes (2b step 2). |
| 5 | B | No message for users after a restore (the user who "entered 20 deals this morning"). | Yes: template added in section 8. |
| 6 | B | Two recovery key holders are required, none are named and no dump encryption key exists. | No: people (section 9). |
| 7 | C | No step for notifying the Data Commissioner and affected people (72 hours, awareness). | Yes: added to the security incident rule in section 8. The decision itself is Given's with the lawyer. |
| 8 | A, B, C | The on-call and escalation table is empty, so "who rolls back / who is incident lead" has no answer. | No: Given names the people (section 9). Until then Given is the incident lead. |
| 9 | C | "Flip the release flag off" is an environment value (`ACTIVE_RELEASE`), which needs a redeploy, not a switch. Taking the app down (stop the container) is the fast stop. | Noted: use the container stop as the first action, the flag after. |

What stays open for the team exercise in hypercare: who answers the phone, how fast the incident lead is chosen, whether the templates are usable under pressure, and whether the people can find the commands without help.

## 11. Rollback dry-run checklist

Run it on **staging** (or a scratch environment), never on production, at least once before go-live and again after any change to the deploy or restore process. Time every step; the totals are the real RTO inputs.

Preparation (before you start the clock):

- [ ] Staging exists with the same image as production would run, and holds the anonymised data ([STAGING.md](STAGING.md)).
- [ ] You have the previous image tag and the new one.
- [ ] Two people: one does it, one reads this list and writes the times.
- [ ] A backup of staging exists from before the "release".

Dry run, part 1: image rollback

- [ ] Note the running tag and time T0.
- [ ] Deploy the new image (section 1), including a migration that adds a column or an index.
- [ ] Run the smoke test: passes. Record the result.
- [ ] Roll the replicas back to the previous tag (2a). Record the time it took.
- [ ] `GET /api/health` is 200 on every replica.
- [ ] Smoke test passes on the old image against the newer schema. If it does not, record exactly what broke (this is the case section 2a warns about).
- [ ] Time from T0 to "old image serving": ____

Dry run, part 2: database rollback

- [ ] Take the pre-release backup (`pg_dump -Fc`). Note its size and time.
- [ ] Write a few rows (a test lead in a test organisation) after the backup, to prove the data-loss window.
- [ ] Freeze (stop replicas and jobs).
- [ ] Dump the "broken" database as evidence.
- [ ] Restore into a new database (`pg_restore --no-owner --no-privileges`). Time: ____
- [ ] `npm run db:bootstrap-role` and `npm run db:grant-role` against it. Time: ____
- [ ] Count check: `npx tsx scripts/reconcile-counts.ts --source <backup copy> --target <restored>` shows zero differences. Row-level security still on (`relrowsecurity` is `t`).
- [ ] Switch the connection strings, start the previous image, run the smoke test. Time: ____
- [ ] The test rows written after the backup are gone, as expected, and you can say so.
- [ ] Unfreeze, and write the announcement from the templates (do not send).
- [ ] Total time freeze to serving: ____ (compare with the 1 hour RTO target).
- [ ] Also run `npm run backup:drill` once and note the result ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).

Afterwards:

- [ ] Every step that was wrong, missing or unclear is fixed in this file the same day.
- [ ] Results recorded below and the timed numbers copied into [BACKUP_RESTORE.md](BACKUP_RESTORE.md) section 7 (replacing the developer-machine figures).

| Date | Run by | Environment | Part 1 time | Part 2 time | Result | Problems found | Fixes |
|---|---|---|---|---|---|---|---|
| 4 Nov 2026 | Claude Code for Given (one person, no second reader) | Local staging stack, own containers on ports 33010 and 33011 | About 30 s (mechanism only) | Not run | Part 1: image rollback works; part 2 not done | 8 findings, see 11a | Text fixed the same day; code questions open |
| 5 Nov 2026 | Claude Code for Given (one person, no second reader) | Scratch copies of the staging database, own containers on ports 33004 and 33005 | Additive migration: old image served, smoke 18 of 18 | 29 s freeze to serving, smoke passing | Part 2 works; decision rule rows confirmed | 3 findings, see 11b | Text fixed the same day |

## 11a. Dry-run results, 4 Nov 2026

Part 1 (image rollback) only, on the local staging stack, by one actor (an AI assistant working for Given). Own containers on ports 33010 and 33011 on the staging network, started with `docker run` from an env file copied from the running staging app container and deleted afterwards. The shared staging app, its database content and the other staging containers were not touched. **Not done:** part 2 (database rollback); a release with a migration (the shared staging database must not change); anything with a second person.

Setup: image `figbloom-crm:staging` tagged `figbloom-crm:staging-prev`. Both tags pointed at the **same image id**, so the run proved the mechanism (replace a container, wait for health), not that an older build works against a newer schema.

### Timings

| Step | What was done | Result | Time |
|---|---|---|---|
| Bad release A | Wrong `APP_DATABASE_URL` password (the app role) | `/api/health` 200 "ok", container "healthy", `/login` 200. The app role could not log in at all (direct query: "valid database credentials" error). **Health did not detect it.** | never visible |
| Bad release B | Wrong `DATABASE_URL` password (the owner) | The server starts, then the production dev-account guard cannot query the database ("Refusing to start in production: could not check whether dev accounts exist") and the process exits with code 1. Then connection refused. | exit 26.5 s after start; Docker "unhealthy" at about 27 s |
| Bad release C | `APP_DATABASE_URL` missing | Starts and is healthy (`/api/health` 200). The app passes the missing value to Prisma, which then falls back to the datasource in the schema (the owner `DATABASE_URL`). Not verified whether row-level security still protects reads in that case (finding 2). | first 200 at 48 s, Docker "healthy" at 53 s |
| Rollback (2a) | `docker rm -f` of the bad container, `docker run` of `figbloom-crm:staging-prev` with the good env on the same port | `/api/health` 200 | 28 s to first 200 |
| Smoke test on the rolled-back container | `scripts/staging-smoke.ts` against it, without `STAGING_UAT_PASSWORD` | 9 pass, 1 skipped (signed-in checks), exit 0 | a few seconds |

Time from the decision to roll back until the old image answered health: about 30 s with a local image. On a real host add the registry pull. A failure that does not stop the process (bad release A) never turns the Docker check unhealthy.

### Decision rule (section 2c) against what was seen

- No migrations, or additive migrations: image rollback worked as written. The additive case was **not** exercised (no migration was run), so "the old code ignores the new columns" is still untested.
- "Cannot tell: roll back if the release was in the last 24 hours": consistent with the run, because bad release A looks healthy and only a sign-in test shows it.
- The 30-minute limit: the mechanics took under a minute; the limit is a decision limit. Nothing contradicted it.
- The restore rows were not run.

### Findings

| # | Where | Finding | Fixed? |
|---|---|---|---|
| 1 | 2a step 3, section 6 | `/api/health` uses the owner connection only. A wrong or rotated `APP_DB_PASSWORD` (the section 4a failure) leaves health at 200 while nobody can sign in. | Text corrected (sign in as a test user too). **Code not changed:** consider checking the app role in the health route. For Given and a developer. |
| 2 | Environment | A missing `APP_DATABASE_URL` is not a start-up error: Prisma falls back to the owner login and the container is healthy. The app might then run as the table owner. | Noted. **Needs a developer check** (does the owner bypass row-level security? should production boot refuse when it is unset?). |
| 3 | 2a steps 1 and 2 | No command and no way to keep the previous tag: the staging stack tags only `figbloom-crm:staging`, so a rebuild replaces the old image. "Put the previous tag back" had no command. | Fixed: tag convention, `docker tag` before deploying, the `docker rm` and `docker run` pair. |
| 4 | Section 1 step 4, section 5, section 7 | `npm run seed`, `jobs:worker`, `notifications:sweep` and `backfill-organization-defaults` cannot run inside the production image (no `src/`). The worker has nowhere to run except through the cron route. | Text and command table fixed. **Needs a decision:** a worker image, or include `src/`. |
| 5 | Section 7 | The `staging:smoke` npm script exists (the table said it did not). `pg_dump`, `pg_restore` and `psql` are not on this computer nor in the app image, so part 2 cannot be done here except through the Postgres container. | Fixed. |
| 6 | Section 6 step 1 | A wrong owner password shows as an exited container, not as a 503, because the production guard stops the process. | Fixed. |
| 7 | 2a "one at a time" | The compose staging stack has one app container, so rolling replicas one at a time was not exercised. With restart policy `unless-stopped`, bad release B becomes a crash loop: check `docker ps` for "Restarting", not only health. | Noted here. |

### Command-existence table (section 7), each row checked

| Row | Result |
|---|---|
| `migrate:deploy`, `db:bootstrap-role`, `db:grant-role`, `seed` | In `package.json`. `seed` not runnable in the image (finding 4). |
| `jobs:worker`, `notifications:sweep` | In `package.json`, scripts exist. Not runnable in the image (finding 4). |
| `smoke:prod` | In `package.json`; `e2e/smoke/` exists. Not run (needs six `SMOKE_*` accounts; sign-in is limited to 5 per email per 15 minutes and staging is shared). |
| `scripts/staging-smoke.ts` | Exists and ran; also `npm run staging:smoke`. Corrected. |
| `backup:drill`, `reconcile:counts` | In `package.json`, scripts exist. Not run (part 2). |
| `backfill-organization-defaults.ts`, `migration-rehearsal.ts` | Exist. Backfill needs `src/`. |
| `pg_dump`, `pg_restore`, `psql` | Not on the host or in the app image; present in the Postgres container. Corrected. |
| `RUN_MIGRATIONS_ON_START` and the entrypoint | Exist (`docker/entrypoint.sh`); not run, to keep the shared database unchanged. |

### What only people can do (from this run)

- The table-top exercise with named on-call people (section 9 is still empty): nobody answered a phone, took the incident lead role or decided on a rollback here.
- Decide findings 1, 2 and 4 (code and image changes).
- Run part 2 with two people where `pg_dump` and `pg_restore` are available, and repeat part 1 with a real migration and a genuinely older image.
- Sign-off (section 13) stays empty.

## 11b. Dry-run results, part 2 and a real schema change, 5 Nov 2026

By one actor (an AI assistant working for Given), on **scratch copies of the staging database** (73 tables, about 700 rows, 446 KiB dump), never on the shared staging database. The scratch "live" database `figbloom_drill_live` was restored from a dump of staging; two temporary app containers (ports 33004 and 33005, same image as staging, environment taken from the running staging app, nothing printed) stood in for the old image and the rolled-back image. All scratch databases, containers and env files were removed afterwards and the shared staging stack was not touched. The smoke test is `scripts/staging-smoke.ts` (18 checks).

| Step | What was done | Result | Time |
|---|---|---|---|
| Baseline | App on the scratch live database | smoke 18 of 18 | health 200 after 2.4 s |
| Pre-release backup | `pg_dump -Fc` | 457,863 bytes, 1,012 catalogue entries | 0.6 s |
| Release 1, **additive** | `ALTER TABLE leads ADD COLUMN` plus an index, old code still running | smoke **18 of 18**: the old code ignores a new column and index | n/a |
| Release 2, **destructive** | the column `leads.lead_status_id` renamed (a column the code needs) | `/api/health` **still 200**; smoke **16 of 18**: both leads lists fail | n/a |
| Freeze | app stopped | | 0.8 s |
| Evidence dump of the broken database | `pg_dump -Fc` | | 0.8 s |
| Restore into a new database | `pg_restore --no-owner --no-privileges` | | 5.6 s |
| `db:bootstrap-role` and `db:grant-role` against it | roles set up for the app | | 3.2 s |
| Count check | `reconcile-counts`, backup copy against restored database | 72 tables, 725 rows each side, 571 rows spot-checked: **zero differences**, exit 0; RLS on `organizations` is `t` | 8.9 s (includes making the backup copy) |
| Previous image on the restored database | new container | first health 200 | 2.5 s |
| Smoke on the restored database | | **18 of 18** | |
| **Freeze to serving, smoke passing** | | | **29.2 s** (RTO target 1 hour) |

Data-loss window: 6 sign-in records were written on the scratch live database after the backup (the smoke runs of releases 1 and 2); the restored database does not have them (43 at the backup, 49 on the broken database, 46 on the restored one, which is 43 plus the 3 written by the smoke run on the restored copy). The added column is gone and `lead_status_id` is back.

**What this confirms in section 2c:** an additive migration is safe for an image rollback (tested with a real change, not just the same image twice); a destructive one needs the database rollback, and that works as written, including the roles step.

**Findings**

| # | Finding | Action |
|---|---|---|
| 1 | After the destructive migration `/api/health` stays 200 while core screens fail. Health checks the database connection, not the schema the code expects. Only the smoke test saw it. | Text: a green health check after a migration proves nothing about the schema; the smoke test (section 1, step 6 and 2a, step 3) is the check. No code change proposed: a schema check in health would need a list of expected columns and would also fail on additive migrations. |
| 2 | A first attempt of this run built the container environment with a filter that dropped names containing digits (`S3_*`). The app started without a storage endpoint: health 200, `/api/me/context` 500, log line "S3_ENDPOINT is required when STORAGE_DRIVER=s3". | Another case of finding 1. When rolling back by hand, copy the **whole** environment (`docker inspect` `Config.Env`), never a filtered list. |
| 3 | Not done in this run: the announcement from the section 8 templates, approval by Given before the restore (section 2c), a second person, a genuinely older build (both containers ran the same image), the people steps and their clock time. | Stay for the table-top (section 10, scenario B covers the approval and the announcement). |

The 29 s covers the machine steps on a 446 KiB database; the 1 hour RTO target is about the people steps and the size of production. The timing is also noted in `docs/BACKUP_RESTORE.md`.

## 12. What only people can do

- Name the on-call people, their phones, backups and hours (section 9), and set up the alert paging to them.
- Hold the team table-top exercise (section 10) in the first production week and fill in its table (deferred, decision 6.12).
- Build the nightly backup job and choose the backup storage (desk walkthrough, gap 3).
- Repeat the rollback dry run with a genuinely older build and a second person when a real host exists (done once on scratch copies, section 11b).
- Decide the secrets rotation schedule and keep the secret log.
- Confirm the RPO and RTO targets (they are still proposals in [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
- Decide whether a maintenance-mode switch and an "end all sessions" admin action are worth building (neither exists today).
- Approve this document (sign-off below).

## 13. Sign-off (left empty on purpose)

| Role | Name | Date | Signature |
|---|---|---|---|
| Runbooks reviewed | Given | | |
| Table-top and dry run seen | Given | | |
| Informed | Michael | | |
