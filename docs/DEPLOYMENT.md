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
| `DEV_SESSION_SECRET` | Required | **Omit** | Signs the `/dev-login` placeholder cookie, which is hard-disabled by `NODE_ENV === "production"` regardless -- see `IMPLEMENTATION_NOTES.md`, "Real authentication (FIG-592)". |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional (unset = logs the link) | **Required for real use** | Without these, password-reset/invite emails only ever reach the server log, not a real inbox -- acceptable for dev, not for real users. |
| `WEBSITE_LEAD_RATE_LIMIT_*` | Optional | Optional | Sane defaults apply; tune only if the defaults are wrong for real traffic. |
| `IMPORT_MAX_ROWS` | Optional | Optional | Per-call CSV import row ceiling (FIG-596); defaults to 20000. |
| `APP_BASE_URL` | Optional (defaults to `http://localhost:3000`) | **Required for correct links** | Builds the deep links inside notification emails (FIG-597) -- set to this environment's real public URL. |
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

`npm run notifications:sweep` (`scripts/notifications-sweep.ts`, FIG-597)
generates "task due today"/"task overdue" notifications and retries any
failed email delivery whose backoff has elapsed. This project's deployment
is a single Docker image with no scheduler/queue sidecar (see "The image,"
above), so nothing runs this automatically -- wire it to whatever
recurring-task mechanism your chosen host provides:

- A cron entry on a VPS: `*/15 * * * * docker exec <container> npm run notifications:sweep`
- A platform-native scheduled job (Render Cron Jobs, Railway Cron, Fly
  Machines on a schedule, a Kubernetes CronJob, ...)

Every 15-30 minutes is reasonable. It's safe to run more often or to miss a
run entirely: generated notifications are deduplicated (a task is only
ever flagged "due" or "overdue" once, see `notifications`' partial unique
index), and a skipped run just means the next one catches up on whatever's
now due/overdue or newly eligible for retry.

## Logging / error monitoring

Structured JSON logs to stdout via `pino` (`src/lib/logger.ts`) --
pretty-printed in development, plain JSON lines in production, which is
what any log aggregator (your platform's own log viewer, or a shipped-off
aggregator) actually wants. Every route's unhandled-error fallback logs
through this (`logger.error({ err }, ...)`) instead of a bare
`console.error`.

A real error-tracking service (Sentry or similar) is a deliberate next
step, not built here -- it needs a real account/DSN this project doesn't
have, the same kind of infrastructure-dependent gap as SMTP (FIG-592) and
captcha (FIG-594). It would hook in at the same `logger.error` call sites
already in place.

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
