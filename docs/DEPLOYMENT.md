# Deployment (FIG-595)

> **MVP on Vercel (9 Nov 2026, `docs/DECISIONS.md` section 7):** the first production deployment runs on Vercel with Neon PostgreSQL and an S3-compatible bucket. The Docker image below stays valid (staging on this computer, the later AWS move). For Vercel read "Vercel MVP deployment" at the end of this file and `docs/VERCEL_SETUP.md`.

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
| `DEV_SESSION_SECRET` | Required | **Omit** | Signs the dev sign-in chips cookie, which only works when `NODE_ENV` is exactly `"development"` regardless (FIG-605) -- see `IMPLEMENTATION_NOTES.md`, "Real authentication (FIG-592)". |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional (unset = logs the link) | Optional if `RESEND_API_KEY` and `EMAIL_FROM` are set | Invites, resets, notifications and quotes send through SMTP when `SMTP_HOST` is set, otherwise through Resend (`RESEND_API_KEY` + `EMAIL_FROM`). With neither, production logs an ERROR at boot and `/api/health` reports `email: misconfigured`; links are never logged in production. |
| `WEBSITE_LEAD_RATE_LIMIT_*` | Optional | Optional | Sane defaults apply; tune only if the defaults are wrong for real traffic. |
| `LOGIN_RATE_LIMIT_*` / `SIGNUP_RATE_LIMIT_*` / `PASSWORD_RESET_RATE_LIMIT_*` | Optional | Optional | Sane defaults apply (FIG-784) -- see "Rate limiting on login/signup/password-reset," below. |
| `IMPORT_MAX_ROWS` | Optional | Optional | Per-call CSV import row ceiling (FIG-596); defaults to 20000. |
| `APP_BASE_URL` | Optional (defaults to `http://localhost:3000`) | **Required for correct links** | Builds the deep links inside notification emails (FIG-597) and is an allowed origin for the CSRF check (FIG-802) -- set to this environment's real public URL. |
| `CRON_SECRET` | Not needed | **Required to use `/api/cron/notifications-sweep`** | See "Scheduled jobs," below. Not needed if the notifications sweep is only ever triggered via the CLI script. |
| `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` | Optional | Optional | Defaults to `15`. See "Scheduled jobs," below. |
| `SMS_PROVIDER_API_KEY` | Not needed | Optional | No real SMS provider is wired up yet (FIG-597) -- see `src/notifications/sms.ts`. Setting this alone does nothing. |
| `LOG_LEVEL` | Optional (defaults to `info`) | Optional | `pino` level -- see "Logging," below. |
| `CRON_SECRET` (all cron routes) | Not needed | **Required** | Bearer secret for `/api/cron/jobs`, `/api/cron/platform-maintenance` and `/api/cron/notifications-sweep`. Unset: the routes fail closed (500). |
| `TWO_STEP_ENCRYPTION_KEY` | Optional (dev fallback key) | **Required** | 32 random bytes, base64. Encrypts two-step secrets. Unset in production: two-step enrolment and sign-in fail closed. |
| `INTEGRATION_ENCRYPTION_KEY` | Optional | **Required for mail and calendar connections** | base64 of 32 random bytes. Encrypts stored OAuth tokens. Unset: no connection token can be stored or read (feature disabled). |
| `PLATFORM_DB_PASSWORD` | Required | **Required** | Password for the `figbloom_platform` role, created by `npm run db:bootstrap-role`. Unset: the platform role is not created and the platform console cannot connect. |
| `PLATFORM_DATABASE_URL` | Required | **Required** | Same host/db, `figbloom_platform` credentials; used by the platform console. Unset: the platform console fails closed. |
| `PLATFORM_DB_ROLE` / `APP_DB_ROLE` | Optional | Optional | Role names for the bootstrap script; default `figbloom_platform` / `figbloom_app`. |
| `PLATFORM_DELETION_WAIT_DAYS` | Optional | Optional | Retention wait for platform data requests and exports, in days. Default 30; values below 7 are ignored. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Optional | Required to offer Gmail and Google Calendar | Unset: the Google connection is unavailable (feature disabled). Register `${APP_BASE_URL}/api/integrations/oauth/callback` as the redirect address; there is no separate redirect variable, it derives from `APP_BASE_URL`. |
| `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` | Optional | Required to offer Outlook | Unset: the Microsoft connection is unavailable. Same redirect address. |
| `MICROSOFT_OAUTH_TENANT` | Optional | Optional | Default `common`. |
| `ANTHROPIC_API_KEY` | Optional | Required for the assistant and business-card reader | Unset: the assistant says it is not set up; the card reader falls back to typing. Also needs `@anthropic-ai/sdk` installed. |
| `ASSISTANT_MODEL` | Optional | Optional | Claude model id for the assistant. Code default is `claude-opus-5-5` today (the decision says Sonnet; see `docs/M13_CLOSEOUT.md`). |
| `TRUSTED_PROXY_HOPS` | Optional | Required behind a proxy | Number of trusted proxy hops. When unset, `X-Forwarded-For` is ignored (per-IP limits then have no key). |
| `TWO_STEP_RATE_LIMIT_MAX_PER_USER` / `_MAX_PER_IP` / `_WINDOW_MS` | Optional | Optional | Two-step code attempts per window. Defaults 10 / 30 / 900000 ms. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Optional | Required for web push | All three needed; unset: push is disabled. Subject is a `mailto:` or `https:` contact. |
| `PUSH_EXTRA_HOSTS` | Optional | Optional | Comma-separated extra push-service hosts to allow. |
| `JOBS_POLL_INTERVAL_MS` | Optional | Optional | Poll interval of `npm run jobs:worker`; default 5000. |
| `MIGRATION_MAX_ROWS` / `MIGRATION_ROLLBACK_WINDOW_HOURS` | Optional | Optional | Data-migration row ceiling (default 50000) and rollback window. |
| `INVITE_RESEND_COOLDOWN_MS` | Optional | Optional | Brake on re-sending a pending invite; default 60000. |
| `APP_VERSION` | Optional | Optional | Version reported to the PWA; falls back to the Vercel commit sha, then `dev`. |
| `HIDE_DEV_LOGIN_ACCOUNTS` | Optional | Omit | `true` hides the dev sign-in chips in a demo run. |
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Optional | Optional | Sentry environment name; default is `NODE_ENV`. |
| `LOG_PLAIN` | Optional | Not needed | `1` turns off pretty logging in development. |
| `NEXT_PUBLIC_API_SOURCE` / `NEXT_PUBLIC_MOCK_API_URL` | Optional | Omit | Frontend data source (`real` or `mock`) and mock server address. |
| `NEXT_PUBLIC_DEMO_SCREENS` | Optional | Omit | `true` shows demo-data screens in production; leave unset until they are wired. |
| `METRICS_TOKEN` | Not needed | Required to use `GET /api/metrics` | Long random value from the secret store, sent as a bearer token or `x-metrics-token`. Unset means the route answers 404. See `docs/OBSERVABILITY.md`. |
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

Either way, the interval for the sweep is yours to choose -- 15-30 minutes is
reasonable for the sweep alone. (`/api/cron/jobs` needs 5 minutes or less, see "Scheduled work" below.) The app
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

## Scheduled work

Nothing in the Docker image schedules itself: it has no scheduler sidecar and the
compose files have no scheduler service. **On Vercel, `vercel.json` installs all three calls**
(see "Vercel MVP deployment", below). On any other host, whoever runs the environment must install **all** the calls
below. Without them mail sync, scheduled sends, chat notifications,
data-request exports, retention and the platform audit check never run.

| Route | Interval | What it runs |
|---|---|---|
| `/api/cron/jobs` | **Every 5 minutes or less** | The job queue for every organisation: `oauth.refresh`, `mail.sync`, `calendar.sync`, `mail.send_scheduled`, `chat.notify`, `sequences.run`, `platform.org_export`, `notifications.sweep` and the other job types in `docs/JOBS.md`, including the daily `privacy.retention` (with the chat retention purge). `mail.sync` runs every 5 minutes, and queued jobs start late by up to the interval between calls. |
| `/api/cron/platform-maintenance` | Daily | Platform audit-chain verification and the purge of expired organisation exports. |
| `/api/cron/notifications-sweep` | 15 to 30 minutes (see "Scheduled jobs") | Due and overdue task notifications and email delivery retries. Also covered by `/api/cron/jobs`; keep it only if you want it on its own interval. |

All three accept `GET` or `POST` and need the secret in `CRON_SECRET` (set per
environment; if unset the routes refuse to run), sent as
`Authorization: Bearer <CRON_SECRET>` (or `X-Cron-Secret: <CRON_SECRET>`).
`npm run jobs:worker` is a long-running alternative to the `/api/cron/jobs`
call (polls every `JOBS_POLL_INTERVAL_MS`, default 5000); it does not replace
the platform-maintenance call.

**Crontab (VPS)**

```cron
*/5 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/jobs
15 3 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/platform-maintenance
*/30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/notifications-sweep
```

**GitHub Actions** (a separate workflow file; secrets `CRON_SECRET` and `APP_URL`.
GitHub can delay scheduled runs by several minutes, so prefer a crontab where mail sync matters.)

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
    - cron: "15 3 * * *"
jobs:
  call:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/cron/jobs"
          if [ "${{ github.event.schedule }}" = "15 3 * * *" ]; then
            curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/cron/platform-maintenance"
          fi
```

**Vercel** (`vercel.json`; Vercel sends `Authorization: Bearer $CRON_SECRET` itself
when the `CRON_SECRET` environment variable is set). The 5-minute schedule below needs **Vercel Pro**; the Hobby plan rejects it and the repository's `vercel.json` therefore holds daily entries plus an outside 5-minute caller (see "Scheduled work on Vercel"):

```json
{
  "crons": [
    { "path": "/api/cron/jobs", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/platform-maintenance", "schedule": "15 3 * * *" },
    { "path": "/api/cron/notifications-sweep", "schedule": "*/30 * * * *" }
  ]
}
```

## Rate limiting on login/signup/password-reset

`POST /api/auth/login`, `/api/auth/signup`, and
`/api/auth/password-reset/request` are each rate-limited per IP and per
email (FIG-784) -- real, durable limiting, not an in-process counter, so it
works correctly across however many replicas you run. It shares the same
backing store (`auth_rate_limit_attempts`) the website lead-capture
endpoint's own rate limiting uses (FIG-594) -- one durable mechanism, not
two. No setup is required beyond applying migrations as usual; there is no
sidecar, no Redis, nothing extra to deploy.

**Client address and proxies.** `X-Forwarded-For` is only trusted when `TRUSTED_PROXY_HOPS` is set to the number of proxies in front of the app (1 for one load balancer): the entry that many places from the right is taken as the client. When it is unset the header is ignored and `X-Real-IP` (set by the platform) is used; with neither, IP-based limits are skipped for that request.

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

Request ids, metrics, alert rules and the alert drill are in `docs/OBSERVABILITY.md` (FIG-1124).

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

Two inbound paths exist. The older one, `POST /api/public/orgs/[orgSlug]/communications/inbound` (FIG-598), takes a neutral JSON body and a per-organisation token; nothing calls it. The one to use is the **Mailgun route** (FIG-806): `POST /api/public/inbound/mailgun`. Mailgun was chosen because it signs every webhook (HMAC-SHA256 of timestamp + token with your signing key); Postmark and SendGrid inbound do not. The adapter is one file (`src/integrations/inbound/mailgun.ts`), so another provider can be added later.

How it works: each organisation has a BCC address, `<org-slug>+<token>@<INBOUND_EMAIL_DOMAIN>`, shown to Management in **Settings, Inbound email, BCC to CRM** with a Copy button. A user adds it to Bcc. Mailgun receives the mail and forwards it to the webhook. The app verifies the signature (refusing anything older than 15 minutes, any token used before, and any unknown or other-organisation address), then logs the message on the matching contact's timeline (sender not known: Needs linking). Attachments are not stored.

### Environment variables

| Variable | Notes |
|---|---|
| `MAILGUN_INBOUND_SIGNING_KEY` | Mailgun's **HTTP webhook signing key** (Mailgun dashboard, Sending, Webhooks). Unset: every inbound call is refused. Secret manager only. |
| `INBOUND_EMAIL_DOMAIN` | The (sub)domain whose MX points at Mailgun, for example `inbound.yourcompany.com`. Unset: no BCC address is shown. Use a subdomain you do not use for normal mail. |
| `INBOUND_EMAIL_ADDRESS_SECRET` | 32+ random characters (`openssl rand -base64 32`). Makes each address unguessable. Set once: changing it changes every organisation's address. Required in production. |

### Runbook (Given)

1. Create a Mailgun account (or use the existing one). Add the inbound domain (Sending, Domains, Add domain), for example `inbound.yourcompany.com`.
2. At your DNS host add the two MX records Mailgun shows for that domain (`mxa.mailgun.org` and `mxb.mailgun.org`, priority 10; the EU hosts if the domain is in the EU region). Add the SPF and DKIM TXT records Mailgun also asks for. Wait until the domain shows as verified.
3. In Mailgun open Receiving, Routes, Create route. Expression type **Match Recipient**, pattern `.*@inbound.yourcompany.com`. Action **Forward** to `https://<your app domain>/api/public/inbound/mailgun`. Priority 0.
4. Copy the HTTP webhook signing key into `MAILGUN_INBOUND_SIGNING_KEY`. Set `INBOUND_EMAIL_DOMAIN` to the domain from step 1 and a new `INBOUND_EMAIL_ADDRESS_SECRET`. Redeploy.
5. Sign in as Management and open Settings, Inbound email. The **BCC to CRM** card shows the address. Copy it.
6. Production test: pick an existing contact with a known email address. Send an email from that address to anyone, with the BCC address in Bcc, and a subject such as "BCC test". Within a minute the message should appear on that contact's timeline as an inbound email. If the sender is not a contact, it appears under Needs linking instead.
7. If nothing arrives: Mailgun, Logs shows whether the route fired and the HTTP status the app returned. 401 means the signing key is wrong or unset, or the message is older than 15 minutes; 404 means the address is not valid for this environment (check `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_ADDRESS_SECRET` and the slug). Settings, Inbound email also shows the last message that could not be processed.

Steps 1 to 6 need your Mailgun account and DNS, so this path is untested in production until you do them.

## Support requests by email (Resend)

Customers of the CRM (the organisations) ask Figbloom for help by email. There is no Customer Support role and no ticket list in the CRM (decision 12, 5 Nov 2026); the platform console holds the tickets. Full description: `docs/SUPPORT_BY_EMAIL.md`.

How it works: any signed-in member opens Help, then **Contact support**, writes a subject and a message and sends it. The app sends one email through Resend's API to `SUPPORT_INBOX_EMAIL`. The member's own address is the Reply-To, so replies reach them directly. The subject carries a reference (`[FB-20261105-K7Q2X9] ...`) and the email carries the organisation, the member, the role and the page. A member may send 5 requests an hour and an organisation 20.

| Variable | What it is |
|---|---|
| `RESEND_API_KEY` | The Resend API key (starts `re_`). Michael sends it once Resend is set up. Secret manager only. Use a key with **Sending access** only. |
| `SUPPORT_EMAIL_FROM` | The sender, for example `Figbloom CRM <support-requests@mail.yourcompany.com>`. Its domain must be verified in Resend. |
| `SUPPORT_INBOX_EMAIL` | Where Figbloom support reads requests: the address the platform console takes tickets from. |

Set-up, in order:

1. In Resend, add the sending domain (Domains, Add Domain) and add the DNS records it shows (SPF, DKIM). Wait until it shows **Verified**.
2. Create an API key with **Sending access** for that domain. Put it in `RESEND_API_KEY` (secret manager), with `SUPPORT_EMAIL_FROM` and `SUPPORT_INBOX_EMAIL`. Redeploy.
3. Sign in as any member of a V1.1 organisation, open Help, Contact support, send a request. The dialog shows the reference.
4. Check the support inbox: the email arrives with the reference in the subject, and Reply goes to the member.
5. If it does not arrive: Resend, Logs shows each send and its status. The app answers 503 with "Support by email is not set up yet" when any of the three variables is missing, and 503 "We could not send your request" when Resend refuses the message (the cause is in the server log, never on screen).

Local development: with any variable unset the request is logged and the dialog says nothing was sent. Nothing leaves the machine.

Until Michael's key arrives, step 2 onward cannot be done, so this path is untested against the real Resend service. The adapter is tested against a stand-in `fetch` (`tests/supportRequests.test.ts`).

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

## Go-live checklist for V1.1 features

- [ ] Platform role created: `PLATFORM_DB_PASSWORD` set, then `npm run db:bootstrap-role` and `npm run db:grant-role`; `PLATFORM_DATABASE_URL` set.
- [ ] Platform admin created with `npm run platform:bootstrap-admin`.
- [ ] `TWO_STEP_ENCRYPTION_KEY` and `INTEGRATION_ENCRYPTION_KEY` set (32 random bytes, base64, different per environment).
- [ ] Email configured (`RESEND_API_KEY` + `EMAIL_FROM`, or `SMTP_*`); in production links are never logged, so without a provider invites and resets cannot be delivered. `/api/health` must show `email.status: ok`.
- [ ] `CRON_SECRET` set and the scheduler entries from "Scheduled work" installed (`/api/cron/jobs` every 5 minutes or less, `/api/cron/platform-maintenance` daily).
- [ ] `TRUSTED_PROXY_HOPS` set when behind a proxy (number of trusted proxy hops; when unset `X-Forwarded-For` is ignored).
- [ ] OAuth client ids and secrets set and `${APP_BASE_URL}/api/integrations/oauth/callback` registered, if mail and calendar connections are offered.
- [ ] `APP_BASE_URL` set to the public URL; no dev accounts exist and `ALLOW_DEV_ACCOUNTS` is not set.
## Database hosting

Plain PostgreSQL, running locally for now, with a planned migration to AWS (Michael's decision, 4 Nov 2026; `docs/DECISIONS.md` section 5). Keep to standard PostgreSQL features so that move is a dump and restore plus new connection strings. The AWS services and region are not chosen yet.

## Vercel MVP deployment

Decided by Given on 9 Nov 2026, Michael to confirm (`docs/DECISIONS.md` section 7). Scope: V1 plus the wired V1.1 screens; V2 screens stay hidden. The human steps, in order, are in `docs/VERCEL_SETUP.md`.

### What is in the repository for Vercel

| File | Purpose |
|---|---|
| `vercel.json` | Build command `prisma generate && next build` (migrations never run in a build), function `maxDuration` for the long routes, and the three cron entries (daily, the Hobby plan limit). |
| `prisma/schema.prisma` | `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, so the query engine for the Vercel runtime is bundled. |
| `next.config.js` | Unchanged and still applies: security headers, the `/sw.js` headers, the Sentry build wrapper (source map upload only with `SENTRY_AUTH_TOKEN`). |
| `scripts/migrate-deploy-direct.ts` | `npm run migrate:deploy:direct`: runs `prisma migrate deploy` through `DIRECT_URL`. |

**Why there is no `directUrl` in the Prisma datasource (closing decision for MVP-05: deliberately not added).** Prisma then makes a `DIRECT_URL` variable mandatory for every command (`generate`, `validate`, the test suite, CI), which would break every setup that has only `DATABASE_URL`. Instead `npm run migrate:deploy:direct` copies `DIRECT_URL` onto `DATABASE_URL` for that one command. With `DIRECT_URL` unset it behaves exactly like `npm run migrate:deploy`. Run it from a trusted computer, never from the Vercel build.

**Connection strings on Neon.** `APP_DATABASE_URL` (what the running app queries through, role `figbloom_app`) and `PLATFORM_DATABASE_URL` (role `figbloom_platform`) use Neon's **pooled** host (the host name containing `-pooler`) with `?sslmode=require&pgbouncer=true&connection_limit=1`. `DATABASE_URL` (owner role) is the **direct** host, used only by scripts and migrations; `DIRECT_URL` is the same direct owner URL. Row-level security keys on the organisation set per transaction, which works through the transaction-mode pooler; step 9 below proves it on the hosted database.

**Heavy dependencies.** `exceljs` and `web-push` are plain Node packages used by the import/export and push paths; no route uses the edge runtime. Vercel reports function size on the first build; if one exceeds the limit, report it.

### Production database bring-up (run once, in this order)

Run from a trusted computer with the repository on `dev-given`. Values below are placeholders; real values live only in the Vercel project settings and the secret store.

1. **Create the Neon project** (Vercel Marketplace, plain PostgreSQL) and a database `figbloom_crm`. Keep the production project separate from any project used by previews; previews must never point at the production database.
2. **Set the owner connection for this shell** (direct, non-pooled host, owner role):
   ```bash
   export DATABASE_URL="postgresql://<owner>:<password>@<direct-host>/figbloom_crm?sslmode=require"
   export DIRECT_URL="$DATABASE_URL"
   export APP_DB_PASSWORD="<long random value>"
   export PLATFORM_DB_PASSWORD="<another long random value>"
   ```
3. **Enable `pg_trgm`** (search needs it): `psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'`.
4. **Apply the migrations:** `npm run migrate:deploy:direct`, then confirm `npx prisma migrate status` shows nothing pending.
5. **Create the application roles:** `npm run db:bootstrap-role` creates `figbloom_app` and `figbloom_platform` with the two passwords above; `npm run db:grant-role` grants their table privileges (audit events stay append-only; the platform role sees only its own tables). If Neon refuses the `GRANT CONNECT` on the database, note the exact message; the table grants are what matter.
6. **Seed the role and permission catalogue only:** `NODE_ENV=production npm run seed`. `prisma/seed.ts` is the production-safe seed: the five roles and their permissions, no organisation, no user, no sample data. Re-running it is safe. **Never run `npm run seed:dev` or `npm run db:setup` against this database.**
7. **Build the pooled URLs** for `figbloom_app` and `figbloom_platform` from Neon's pooled host and put them in Vercel as `APP_DATABASE_URL` and `PLATFORM_DATABASE_URL`.
8. **Create the first platform admin and the first organisation** through the bootstrap flow (`docs/PLATFORM_ADMINS.md`).
9. **Cross-organisation check on the hosted database.** With two test organisations A and B: signed in as a member of A, `GET /api/orgs/<B-slug>/leads/<B-lead-id>` must answer 403 or 404, and A's lists must never contain B's rows. In `psql` as `figbloom_app` with no organisation set, `SELECT count(*) FROM leads;` must return 0 (row-level security closed by default). The automated tenant tests run against a **copy** of the schema (`TEST_DATABASE_URL`), never against production data. Delete the test organisations afterwards.
10. **Take a first backup** (`docs/BACKUP_RESTORE.md`; `pg_dump` over the direct URL) before real data is loaded.

Moving to AWS later is a dump and restore plus new connection strings (section "Database hosting").

### Environment variable reference

One table, covering `.env.example` and every `process.env` read in `src/`. **Prod** = Vercel Production environment; **Preview** = Vercel Preview environment (own Neon project and own bucket, never the production database, different secrets). S = secret: enter only in Vercel as Sensitive, never in a file.

| Variable | Prod | Preview | Supplied by | Notes |
|---|---|---|---|---|
| `NODE_ENV` | automatic | automatic | Vercel | `production` in both. |
| `FIGBLOOM_ENVIRONMENT` | `production` | `preview` | Given | `production` switches on the production boot guards. Previews must not use it. |
| `ACTIVE_RELEASE` | `v1.1` | `v1.1` | Given | MVP scope is V1 plus wired V1.1. Unset means `v1`. |
| `APP_BASE_URL` | required | required | Given | Public URL, no trailing slash. Builds links, is a CSRF allowed origin, and derives the OAuth redirect. |
| `DATABASE_URL` S | required | required | Given (Neon) | Owner role, **direct** host. Scripts and migrations only. |
| `DIRECT_URL` S | local shell only | local shell only | Given (Neon) | Same as `DATABASE_URL`; read only by `npm run migrate:deploy:direct`. |
| `APP_DB_PASSWORD` S, `PLATFORM_DB_PASSWORD` S | local shell only | local shell only | Given | Passwords `db:bootstrap-role` gives the two roles. |
| `APP_DATABASE_URL` S | required | required | Given (Neon) | `figbloom_app`, **pooled** host. Production refuses to boot without it. |
| `PLATFORM_DATABASE_URL` S | required | required | Given (Neon) | `figbloom_platform`, **pooled** host. The platform console fails closed without it. |
| `APP_DB_ROLE`, `PLATFORM_DB_ROLE` | optional | optional | | Role names; defaults `figbloom_app`, `figbloom_platform`. |
| `TEST_DATABASE_URL`, `TEST_APP_DATABASE_URL`, `TEST_PLATFORM_DATABASE_URL` | never | never | | Test suite only. |
| `STORAGE_DRIVER` | `s3` (target); **`local` on the MVP test deployment, 11 Nov 2026** | `s3` | Given | Required in production: unset makes the app page shell fail ("STORAGE_DRIVER must be set"). The test deployment uses `local` because no bucket exists yet; files then live in the server's scratch folder and are **lost** (see `docs/MVP_HANDOVER.md` section 0). Replace with `s3` before real use. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | required | required | Given | AWS example: `https://s3.<region>.amazonaws.com`. Preview uses its own bucket. |
| `S3_ACCESS_KEY_ID` S, `S3_SECRET_ACCESS_KEY` S | required | required | Given | Key limited to this bucket (`docs/STORAGE.md`). |
| `S3_FORCE_PATH_STYLE` | `false` | `false` | Given | Virtual-hosted style on Amazon S3. |
| `S3_PUBLIC_ENDPOINT` | unset | unset | | Only when browsers reach the store at another host than the server. |
| `STORAGE_LOCAL_DIR`, `STORAGE_SIGNING_SECRET` (the secret is S) | not used with `s3`; **set on the MVP test deployment** (`/tmp/figbloom-files` and a random secret) | not used | Given | **Set in production today** (test only). Local driver only: Vercel's disk is not persistent, so files are lost when the server instance is recycled and are not shared between instances. Fake-data test only. |
| `CLAMD_HOST`, `CLAMD_PORT` | unset | unset | | No ClamAV host in the MVP. |
| `ANTIVIRUS_MODE` | `builtin-only` | optional | Given | Opt-out of the ClamAV requirement; needs the written risk acceptance in `docs/DECISIONS.md` section 7. Without it and without `CLAMD_HOST`, production refuses to boot. A warning is logged at every boot while it is active. Remove it when a ClamAV host exists. |
| `CRON_SECRET` S | required | required | Given | 32+ random characters. Vercel sends it as `Authorization: Bearer` on cron calls. Unset: the cron routes answer 500. |
| `NOTIFICATIONS_SWEEP_INTERVAL_MINUTES` | unset (default `15`) | optional | | Match the interval at which `/api/cron/jobs` is called. Unset in the MVP production. |
| `TWO_STEP_ENCRYPTION_KEY` S | required | required | Given | `openssl rand -base64 32`. |
| `INTEGRATION_ENCRYPTION_KEY` S | required | required | Given | `openssl rand -base64 32`. Without it no mail or calendar token can be stored. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` S | for Gmail and Calendar | optional | Given (Google Cloud) | Redirect `${APP_BASE_URL}/api/integrations/oauth/callback`. |
| `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` S, `MICROSOFT_OAUTH_TENANT` | for Outlook | optional | Given (Entra) | Same redirect. Tenant default `common`. |
| `RESEND_API_KEY` S | required (**test key today**: a free Resend account) | optional | Michael or Given | Support requests by email. Replace with a key from the real account at changeover. |
| `SUPPORT_EMAIL_FROM` | required (**test value today**: `onboarding@resend.dev`) | optional | Given | Must use a domain verified in Resend. `onboarding@resend.dev` works only for the Resend account owner's own address. |
| `SUPPORT_INBOX_EMAIL` | required (**test value today**: Given's Gmail) | optional | Michael | Where support requests arrive. |
| Support email changeover | | | | When testing ends: (1) add the Figbloom domain in Resend and publish the SPF and DKIM records until it shows "verified"; (2) set `SUPPORT_EMAIL_FROM` to an address on it; (3) set `SUPPORT_INBOX_EMAIL` to Michael's support mailbox; (4) create a key under the real Resend account (Sending access only) and replace `RESEND_API_KEY`; (5) redeploy and send one test request. |
| `POSTGRES_*`, `PG*`, `NEON_*`, `VITE_NEON_AUTH_URL` | present | present | Neon integration | Created by the Neon integration in Vercel. **The app does not read them**; they can stay (do not delete them while the integration is connected, they are managed by it). The app uses `DATABASE_URL`, `APP_DATABASE_URL` and `PLATFORM_DATABASE_URL`. |
| `RESEND_API_KEY` S, `EMAIL_FROM` | required for invites, resets and quotes (unless SMTP is used) | optional | Michael | Sender domain must be verified in Resend. In production links are never logged; without a provider, `/api/health` reports `email: misconfigured`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` S, `SMTP_FROM` | optional alternative to Resend | optional | Given | If `SMTP_HOST` is set it wins over Resend. |
| `MAILGUN_INBOUND_SIGNING_KEY` S, `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_ADDRESS_SECRET` S | optional | optional | Given | BCC-to-CRM. Unset: inbound calls are refused. |
| `ANTHROPIC_API_KEY` S | for assistant and card reader | optional | Given | Unset: the assistant says it is not set up. |
| `ASSISTANT_MODEL` | optional | optional | Given | Model id. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` S, `VAPID_SUBJECT` | for web push | optional | Given | All three or push is off. |
| `PUSH_EXTRA_HOSTS` | optional | optional | | Extra push hosts. |
| `TRUSTED_PROXY_HOPS` | `1` | `1` | Given | Vercel is one trusted proxy hop. Unset: per-IP rate limits have no key. |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | optional | Given | Error tracking. |
| `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` | `preview` | | |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` S | build-time, optional | optional | Given | Source map upload; unset skips it. |
| `APP_VERSION` | optional | optional | | Falls back to `VERCEL_GIT_COMMIT_SHA`. |
| `METRICS_TOKEN` S | optional | optional | Given | Only to read `/api/metrics`. |
| `LOG_LEVEL`, `LOG_PLAIN` | optional | optional | | Default `info`. |
| `LOGIN_*`, `SIGNUP_*`, `PASSWORD_RESET_*`, `WEBSITE_LEAD_RATE_LIMIT_*`, `TWO_STEP_RATE_LIMIT_*`, `LOCKOUT_*`, `INVITE_RESEND_COOLDOWN_MS`, `ME_CONTEXT_CACHE_MS`, `IMPORT_MAX_ROWS`, `MIGRATION_MAX_ROWS`, `MIGRATION_ROLLBACK_WINDOW_HOURS`, `PLATFORM_DELETION_WAIT_DAYS` | optional | optional | | Tuning; defaults are fine (`.env.example`). |
| `JOBS_POLL_INTERVAL_MS` | not used | not used | | For `npm run jobs:worker`, which Vercel does not use. |
| `SMS_PROVIDER_API_KEY` | unset | unset | | No provider is wired. |

**Must NOT be set in Production (nor in Preview):**

| Variable | Why |
|---|---|
| `ALLOW_DEV_ACCOUNTS` | Enables dev accounts and sign-in chips. Production boot fails if a dev account exists. |
| `DEMO_SCREENS`, `NEXT_PUBLIC_DEMO_SCREENS` | Switch demo-data screens on. |
| `NEXT_PUBLIC_PREVIEW_CHIPS`, `PREVIEW_DEV_CHIPS` | Build the dev sign-in chips (`npm run preview` only). |
| `DEV_SESSION_SECRET`, `HIDE_DEV_LOGIN_ACCOUNTS`, `E2E_ALLOW_DEV_ACCOUNTS` | Development only. |
| `NEXT_PUBLIC_API_SOURCE`, `NEXT_PUBLIC_MOCK_API_URL` | Mock API for development. |
| `SKIP_BUILD_TYPECHECK`, `NEXT_DIST_DIR` | CI and local only; a deploy build keeps its type check. |
| `STAGING_*`, `REHEARSAL_*`, `RECONCILE_*`, `ADOPTION_REPORT_DATABASE_URL` | Scripts only. |

### Files: bucket, CORS, versioning, limits

- **Bucket:** private (block all public access), default encryption on, versioning on, with a lifecycle rule that expires old versions after 30 days. The app's key may only get, put and delete objects in this bucket.
- **Browser uploads and downloads go straight to the bucket** through signed links, so Vercel's 4.5 MB request body limit does not apply to them. Server-side steps (scan on finalise, import, export) read the object from the bucket.
- **CORS on the bucket** (needed for the signed browser upload and download), with the real site origin:
  ```json
  [{ "AllowedOrigins": ["https://<your-domain>"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]
  ```
- **Size limits** (`src/storage/policy.ts`): avatars and logos 2 MB, attachments 25 MB, imports 10 MB, exports 50 MB. Safe on Vercel because of the direct-to-bucket upload. The local-driver blob route does not exist when `STORAGE_DRIVER=s3`.
- **Antivirus:** no ClamAV host in the MVP. Uploads get the built-in file-type checks and the EICAR detector only: the accepted risk in `docs/DECISIONS.md` section 7, and the reason for `ANTIVIRUS_MODE=builtin-only`.

### Scheduled work on Vercel

`vercel.json` currently holds three **daily** entries, because Vercel Hobby rejects anything more frequent: `/api/cron/jobs` at 02:00 UTC, `/api/cron/notifications-sweep` at 02:30 and `/api/cron/platform-maintenance` at 03:00. Each route checks `Authorization: Bearer $CRON_SECRET` (constant-time compare, fails closed when unset); Vercel sends that header itself once `CRON_SECRET` is set in the project. Each function is allowed 300 seconds, and the job runner stops starting new jobs after 25 seconds.

**On the Hobby plan the 5-minute runner is an outside caller.** The MVP uses a free cron-job.org job: `GET https://figbloom-crm.vercel.app/api/cron/jobs` every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>` (mail sync, scheduled sends, chat notifications and sequences depend on it). On **Pro**, put `{ "path": "/api/cron/jobs", "schedule": "*/5 * * * *" }` in `vercel.json` and drop the outside caller. Nothing in production depends on `npm run jobs:worker`. Vercel runs crons only against the production deployment.

### Domain, DNS, OAuth and email

1. **Domain:** add `<your-domain>` in Vercel (Project, Settings, Domains) and create the DNS records the dashboard shows (for an apex domain an A record, for a subdomain a CNAME to the Vercel target; use the exact values displayed). The certificate is automatic.
2. **`APP_BASE_URL`:** set to `https://<your-domain>` (no trailing slash) in Production, then redeploy.
3. **OAuth redirect:** register `https://<your-domain>/api/integrations/oauth/callback` in Google Cloud (OAuth client, Gmail and Calendar scopes) and in the Microsoft Entra app registration (Web platform). Change both whenever the domain changes.
4. **Resend:** add the sending domain in Resend, create the SPF (TXT) and DKIM records it shows at the DNS host, wait for "verified", then set `SUPPORT_EMAIL_FROM` on that domain. Add a DMARC TXT record (`v=DMARC1; p=none; rua=mailto:<address>`) and tighten it later.
5. **Inbound email** (BCC-to-CRM, optional): MX of the inbound subdomain to Mailgun (see "Inbound email provider").
