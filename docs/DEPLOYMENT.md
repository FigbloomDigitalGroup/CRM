# Deployment (FIG-595)

This project ships as a single Docker image (see `Dockerfile`), built once
and promoted unchanged across environments -- staging and production are
the same artifact with different environment variables, never separate
builds. This document is deliberately platform-agnostic: it targets "any
host that can run a Docker image" (a VPS, Fly.io, Render, Railway, ECS,
etc.) rather than committing this project to a specific vendor it has
never used before. Pick one when you're ready; everything below still
applies.

## The image

```bash
docker build -t figbloom-crm:<version> .
```

One image, two jobs, selected by the command you run it with:

- The app server (the default `CMD`: `npm run start`, i.e. `next start`).
- The one-off deploy admin commands (`prisma migrate deploy`,
  `db:bootstrap-role`, `db:grant-role`) via `docker/entrypoint.sh`, which
  runs them automatically when `RUN_MIGRATIONS_ON_START=true` and then
  `exec`s into whatever command was passed.

It ships the full `node_modules` (including devDependencies) rather than
Next's `output: "standalone"` trimming, specifically so the Prisma CLI and
`tsx` -- needed by the admin commands above -- are present in the same
image as the server. See the Dockerfile's own header comment.

## Deploy sequence

Run this every deploy, in order, against the target environment's real
`DATABASE_URL`/`APP_DB_PASSWORD`:

1. **Build and push** the image to wherever your chosen platform pulls
   from (a registry, or a platform-native build step).
2. **Run the migration/role step exactly once** -- not per replica:
   ```bash
   docker run --rm \
     -e DATABASE_URL="..." \
     -e APP_DB_PASSWORD="..." \
     -e APP_DATABASE_URL="..." \
     -e RUN_MIGRATIONS_ON_START=true \
     figbloom-crm:<version> true
   ```
   (The trailing `true` is an arbitrary no-op command -- the entrypoint
   runs migrate/bootstrap-role/grant-role first regardless of what command
   follows, then `exec`s it. `true` just exits immediately afterward
   instead of starting a server nobody's routing traffic to.)
3. **Start (or roll) the real replicas**, with `RUN_MIGRATIONS_ON_START`
   left unset -- they should only ever run the server:
   ```bash
   docker run -d -p 3000:3000 \
     -e DATABASE_URL="..." \
     -e APP_DATABASE_URL="..." \
     -e SMTP_HOST="..." \
     figbloom-crm:<version>
   ```

This was verified for real against this project's own dev Postgres
container during FIG-595: the image was built, run with
`RUN_MIGRATIONS_ON_START=true` (migrations applied cleanly, the role was
bootstrapped/granted), then the resulting server answered `/api/health`,
served `/login`, and completed a real login against the database -- all
from inside the container, not just asserted.

## Environments

| | Staging | Production |
|---|---|---|
| Image | Same build artifact as production | Same build artifact as staging |
| Database | Its own separate database -- never shared with production | Its own separate database |
| `APP_DB_PASSWORD` | Its own value | Its own value, never reused from staging |
| SMTP | Real provider, or a staging-only sender address so test emails are obviously not real | Real provider |
| Purpose | Verify a build before it reaches real data/users | The real thing |

Never point staging at production's database "just to check something" --
the whole point of tenant isolation (RLS, composite FKs) is that a bug
there is catastrophic, so staging exists to catch that kind of bug before
it's anywhere near real data.

## Required environment variables

See `.env.example` for the full, authoritative, commented list. Summary,
by whether an environment needs it:

| Variable | Dev/CI | Staging/Production | Notes |
|---|---|---|---|
| `DATABASE_URL` | Required | Required | Schema-owner connection. Never used by request-handling code at runtime (see `src/db/adminClient.ts`'s header) -- only by Prisma CLI and `scripts/db-admin.ts`. |
| `APP_DB_PASSWORD` | Required | Required | Password for the least-privilege `figbloom_app` role. Generate a real random value per environment; never reuse dev's. |
| `APP_DATABASE_URL` | Required | Required | Same host/db as `DATABASE_URL`, `figbloom_app` credentials. What the running app actually queries through. |
| `TEST_DATABASE_URL` / `TEST_APP_DATABASE_URL` | Required (tests only) | Not needed | Only exist for the automated test suite's isolated database. |
| `DEV_SESSION_SECRET` | Required | **Omit** | Signs the `/dev-login` placeholder cookie, which only works when `NODE_ENV` is exactly `"development"` regardless (FIG-605) -- see `IMPLEMENTATION_NOTES.md`, "Real authentication (FIG-592)". |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional (unset = logs the link) | **Required for real use** | Without these, password-reset/invite emails only ever reach the server log, not a real inbox -- acceptable for dev, not for real users. |
| `WEBSITE_LEAD_RATE_LIMIT_*` | Optional | Optional | Sane defaults apply; tune only if the defaults are wrong for real traffic. |
| `LOGIN_RATE_LIMIT_*` / `SIGNUP_RATE_LIMIT_*` / `PASSWORD_RESET_RATE_LIMIT_*` | Optional | Optional | Sane defaults apply (FIG-784) -- see "Rate limiting on login/signup/password-reset," below. |
| `IMPORT_MAX_ROWS` | Optional | Optional | Per-call CSV import row ceiling (FIG-596); defaults to 20000. |
| `APP_BASE_URL` | Optional (defaults to `http://localhost:3000`) | **Required for correct links** | Builds the deep links inside notification emails (FIG-597) and is an allowed origin for the CSRF check (FIG-802) -- set to this environment's real public URL. |
| `CRON_SECRET` | Not needed | **Required to use `/api/cron/notifications-sweep`** | See "Scheduled jobs," below. Not needed if the notifications sweep is only ever triggered via the CLI script. |
| `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` | Optional | Optional | Defaults to `15`. See "Scheduled jobs," below. |
| `SMS_PROVIDER_API_KEY` | Not needed | Optional | No real SMS provider is wired up yet (FIG-597) -- see `src/notifications/sms.ts`. Setting this alone does nothing. |
| `LOG_LEVEL` | Optional (defaults to `info`) | Optional | `pino` level -- see "Logging," below. |
| `NODE_ENV` | Set by tooling (`next dev`/`test`) | `production` | Set automatically by `next build`/`next start`; the Dockerfile also sets it explicitly in the runner stage. |

## Secrets handling

- Never commit a real `.env` file -- it's gitignored on purpose, and
  `.env.example` exists so nothing real ever needs to live in git.
- Every secret above (`APP_DB_PASSWORD`, `SMTP_PASS`, a real
  `DATABASE_URL`) belongs in whatever secret store your chosen platform
  provides -- GitHub Actions secrets for anything CI needs, the deploy
  platform's own environment/secrets UI for staging and production. CI's
  own Postgres service credentials (`.github/workflows/ci.yml`) are
  throwaway, container-local values and are not real secrets; don't
  confuse them with the real ones.
- Staging and production must each have their own independently-generated
  secrets -- a leaked staging secret should never also compromise
  production.
- Rotating `APP_DB_PASSWORD` is exactly `npm run db:bootstrap-role` again
  with the new `APP_DB_PASSWORD` set (it updates the existing role's
  password) followed by restarting the app's replicas with the matching
  new `APP_DATABASE_URL`.

## Health check

`GET /api/health` -- checks real database connectivity (`SELECT 1`
through the schema-owner connection), not just "the process is up."
Returns `{"status": "ok"}` / 200 when healthy, `{"status": "error"}` / 503
otherwise. The Dockerfile's own `HEALTHCHECK` instruction already polls
this every 30s; wire your platform's health/readiness check to the same
path.

## Scheduled jobs

The notifications due/overdue sweep (FIG-597) generates "task due
today"/"task overdue" notifications and retries any failed email delivery
whose backoff has elapsed. Its actual logic lives in
`src/services/notificationSweepService.ts`'s `runNotificationsSweep` --
both ways of triggering it below call exactly that function, so there's one
implementation to reason about regardless of how your deployment schedules
it.

### Triggering it (pick one)

This project's deployment is a single Docker image with no scheduler/queue
sidecar (see "The image," above), so nothing runs this automatically on its
own -- wire it to one of:

- **An authenticated cron route (recommended -- works on any host):**
  `GET /api/cron/notifications-sweep`, authenticated by a shared secret
  (`CRON_SECRET`, see below) sent as either `Authorization: Bearer
  <CRON_SECRET>` or an `X-Cron-Secret: <CRON_SECRET>` header. Point any
  external scheduler at this URL:
  - A VPS crontab: `*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/notifications-sweep`
  - A GitHub Actions workflow on a `schedule:` cron trigger
  - A platform's own scheduled-HTTP-request feature (Vercel Cron, Render
    Cron Jobs, Railway Cron, a Kubernetes CronJob running `curl`, ...) --
    several of these (Vercel Cron included) already send requests with
    exactly the `Authorization: Bearer <secret>` header this route expects.
- **A plain CLI invocation on a schedule** (`npm run notifications:sweep`,
  `scripts/notifications-sweep.ts`) -- for a VPS cron entry or sidecar cron
  container that would rather `exec` into the running container than make
  an HTTP request:
  `*/15 * * * * docker exec <container> npm run notifications:sweep`

Either way, the interval between triggers is yours to choose when you
configure the scheduler/cron entry -- 15-30 minutes is reasonable. The app
does not need to be told what that interval is in order to run the sweep;
see the next section for what `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES`
actually does.

### Required/optional env vars

| Variable | Required for | Notes |
|---|---|---|
| `CRON_SECRET` | The `/api/cron/notifications-sweep` route | Any long random value, generated per environment (same handling as `APP_DB_PASSWORD`/`SMTP_PASS`). The route refuses to run at all (500) if this is unset, rather than ever being callable without one. Not needed if you only ever trigger the sweep via the CLI script. |
| `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` | Optional, both triggers | Defaults to `15`. Used two ways: (1) a self-throttle -- the sweep itself refuses to actually run again until this many minutes have passed since its last successful completion, so a misconfigured or too-eager scheduler calling it every minute can't force extra runs; (2) the stale-lock timeout (3x this value) that lets a crashed run's lock be reclaimed instead of wedging the job forever. Set this to match whatever interval you actually configured the scheduler/cron entry with. |

### Double-send protection

Overlapping runs can't double-send (two replicas triggered by the same
schedule, a slow run still in flight when the next tick fires): every call
to `runNotificationsSweep` first tries to claim a lock row
(`scheduled_job_runs`, one row per job, compare-and-swap `IDLE` ->
`RUNNING`) before touching any organization's data, and skips entirely if
it can't. This is on top of generated notifications already being
deduplicated regardless (a task is only ever flagged "due" or "overdue"
once, see `notifications`' partial unique index) -- so it's also safe to
run more often than needed or to miss a run entirely; a skipped run just
means the next one catches up on whatever's now due/overdue or newly
eligible for retry.

### Checking it's actually running

`GET /api/health`'s response includes a `notificationsSweep` object
(`{status, lastCompletedAt, lastError}`) -- `lastCompletedAt` is `null`
only if the job has never completed yet in this environment (e.g. before
its scheduler/cron entry has fired for the first time). The sweep also
logs a structured line (`src/lib/logger.ts`, so it reaches whatever log
aggregator you've wired up) on completion and on any per-organization
failure.

## Rate limiting on login/signup/password-reset

`POST /api/auth/login`, `/api/auth/signup`, and
`/api/auth/password-reset/request` are each rate-limited per IP and per
email (FIG-784) -- real, durable limiting, not an in-process counter, so it
works correctly across however many replicas you run. It shares the same
backing store (`auth_rate_limit_attempts`) the website lead-capture
endpoint's own rate limiting uses (FIG-594) -- one durable mechanism, not
two. No setup is required beyond applying migrations as usual; there is no
sidecar, no Redis, nothing extra to deploy.

**Defaults** (all tunable via env, see `.env.example`):

| Action | Window | Max per IP | Max per email |
|---|---|---|---|
| Login | 15 min | 20 | 5 |
| Signup | 1 hour | 10 | 3 |
| Password-reset request | 1 hour | 10 | 3 |

Once a limit is hit, every further attempt for that IP or email within the
window gets the same generic 429 (`"Too many requests. Please try again
later."`) regardless of whether the credentials/email this time happen to
be valid -- this is the lockout, and it's deliberately indistinguishable
from "this account doesn't exist" or "this account exists but you got the
password wrong," same enumeration-resistance reasoning IMPLEMENTATION_NOTES.md's
"Real authentication (FIG-592)" section already documents for the 401/
generic-reset-message bodies.

If you're running behind a reverse proxy/load balancer that doesn't
already set `X-Forwarded-For` (or sets it in a way this environment
doesn't trust), per-IP limiting silently has nothing to key on for that
request (see `src/app/api/_lib/clientRequest.ts`'s header comment) -- the
per-email limit still applies regardless, so this degrades rather than
fails open entirely.

## Logging / error monitoring

Structured JSON logs to stdout via `pino` (`src/lib/logger.ts`) --
pretty-printed in development, plain JSON lines in production, which is
what any log aggregator (your platform's own log viewer, or a shipped-off
aggregator) actually wants. Every route's unhandled-error fallback logs
through this (`logger.error({ err }, ...)`) instead of a bare
`console.error`.

### Error tracking (Sentry, FIG-753)

Real error tracking is wired in via `@sentry/nextjs`, covering both ends:

- **Backend**: every `logger.error`/`logger.fatal` call already in the
  codebase also reports to Sentry (`src/lib/logger.ts`'s pino
  `hooks.logMethod` -- no change needed at any of those call sites, and
  none needed for ones added later either). Framework-level errors Next.js
  itself catches during rendering/data fetching are reported via
  `onRequestError` in `src/instrumentation.ts`.
- **Frontend**: unhandled render/hydration errors are reported via
  `src/app/error.tsx` (the per-route boundary) and `src/app/global-error.tsx`
  (the one Next.js falls back to if the root layout itself throws -- a
  plain `error.tsx` can't catch that). Client-side `Sentry.init` lives in
  `src/instrumentation-client.ts`, the filename/location Next.js's build
  plugin looks for automatically.

**Setup:**

1. Create a Sentry project (any org/plan with a free tier works for a
   pilot-scale deployment) and copy its DSN.
2. Set `NEXT_PUBLIC_SENTRY_DSN` in the target environment (staging,
   production). A DSN is not a secret by Sentry's own design -- it's safe
   in a committed example file's comment and safe to ship to the browser,
   which is why one var covers both the client and server init rather than
   a public/private pair.
3. Optional, build-time only, for readable stack traces (real source
   instead of minified build output): set `SENTRY_ORG`, `SENTRY_PROJECT`,
   and `SENTRY_AUTH_TOKEN` (a Sentry auth token *is* a real secret -- treat
   it the same as `APP_DB_PASSWORD`/`SMTP_PASS`). All three are read
   directly from the environment by the underlying bundler plugin; nothing
   in this repo needs to reference them. Omitting `SENTRY_AUTH_TOKEN`
   (e.g. in CI, or any environment without one set up yet) just skips the
   source-map upload step -- the build still succeeds, and the app's own
   error reporting is completely unaffected.

Leave all four unset for local dev/CI: every Sentry call in this app
(`Sentry.init` in both instrumentation files, the logger bridge) is a
complete no-op without a DSN, so no Sentry account is required to run or
test this app locally. See `.env.example` for the exact variable names and
their defaults/comments.

**What's deliberately never sent (FIG-753 AC):** no email address, phone
number, or deal/money value reaches Sentry, even inside a free-text error
message, request body, or breadcrumb. `src/lib/sentryScrub.ts` is the one
place this is implemented -- `scrubPII` (key-based redaction for known
sensitive fields like `email`/`value`/`notes`, pattern-based redaction for
anything that looks like an email or phone number embedded in a string)
and `scrubSentryEvent` (applies it to an event's request data, extra
context, tags, contexts, breadcrumbs, exception message, and `user` object
-- which is reduced to just a membership id, since this app never calls
`Sentry.setUser` with anything else). Both the client and server
`Sentry.init` set this as `beforeSend`/`beforeSendTransaction`, and the
logger bridge applies the same `scrubPII` to whatever context object was
passed to `logger.error`. See `tests/sentryScrub.test.ts` for the exact
behavior this guarantees.

**Verifying it's working:** after setting `NEXT_PUBLIC_SENTRY_DSN` in a
real environment, trigger a real error (any unhandled exception in a route
or page) and confirm it appears in the Sentry project within a minute or
two, with a redacted/absent `email`/`phone`/`value` wherever the
underlying error touched one.

## Inbound email provider

`POST /api/public/orgs/[orgSlug]/communications/inbound` (FIG-598) logs an
externally-sent email onto the matching contact's timeline -- "BCC-to-CRM"
style. The endpoint itself is real and tested, authenticated by a
per-organization token generated from `/o/[orgSlug]/settings`, but nothing
calls it yet: that requires a real inbound-email-parsing provider account
(Postmark, Mailgun, SendGrid inbound parse, or similar) plus the DNS/MX
changes it needs, none of which exist for this project -- the same kind of
gap as SMTP/Sentry/SMS above. Once you have one, configure its webhook to
POST here with the token in the URL (see the settings page for the exact
request shape).

## Backup and restore

Verified for real against this project's own Postgres during FIG-595 --
these are the exact commands that were run, not a theoretical procedure.

**Backup** (custom format -- compressed, and restorable selectively if
ever needed):

```bash
docker exec <postgres-container> pg_dump -U figbloom -Fc \
  -f /tmp/figbloom_backup.dump figbloom_crm_dev
docker cp <postgres-container>:/tmp/figbloom_backup.dump ./figbloom_backup.dump
```

Run this on a schedule appropriate to how much data loss is tolerable
(daily, at minimum, once real customer data exists) and store the result
somewhere other than the database host itself. If your Postgres is a
managed service (RDS, Neon, Cloud SQL, etc.), prefer its built-in
automated backups for the routine case -- the commands above are the
manual/fallback procedure, and the one actually exercised here.

**Restore** (into a *new* database -- never restore over a live one
without a separate, verified backup of its current state first):

```bash
docker exec <postgres-container> psql -U figbloom -d postgres \
  -c "CREATE DATABASE figbloom_crm_restored;"
docker exec <postgres-container> pg_restore -U figbloom \
  -d figbloom_crm_restored --no-owner --no-privileges \
  /tmp/figbloom_backup.dump
```

`--no-owner --no-privileges` matters here: the dump was taken as the
`figbloom` schema owner, and a straight restore would try to recreate
grants/ownership tied to that exact role name, which may not be
appropriate on whatever host you're restoring into. After restoring, run
`npm run db:bootstrap-role && npm run db:grant-role` against the restored
database before pointing the app at it -- the dump includes the
`figbloom_app` role's grants as they existed at backup time, but not the
role itself or its current password.

Verify a restore by comparing row counts on a few core tables
(`organizations`, `users`, `memberships`) between source and restored
database, and confirm row-level security is still enabled
(`SELECT relrowsecurity FROM pg_class WHERE relname = 'organizations';`
should return `t`) -- both checks were run for real here and matched.

## Data deletion requests (GDPR / Kenya DPA)

See `docs/DATA_DELETION_REQUESTS.md` for the full request-handling
process. The actual erasure step is `scripts/erase-data-subject.ts`
(FIG-601) -- a standalone admin script, not a web route, run by hand
after the verification/legal-basis steps the doc describes.

## CI

`.github/workflows/ci.yml` runs on every PR and every push to `main`:
lint, typecheck, `prisma migrate deploy` against a real Postgres service
container, `figbloom_app` role provisioning, the full Vitest suite, a
production build, and a separate job that builds the Docker image itself
-- so a broken Dockerfile fails CI the same way a broken test would,
rather than being discovered at deploy time.
