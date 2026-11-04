# Staging runbook (FIG-1123, P1.01)

Staging is production's shape with its own database, files, secrets and mail sandbox. It exists for rehearsals (`docs/MIGRATION_REHEARSAL.md`), UAT and the smoke suite. It deploys from `dev-given` (standing decision of 27 Oct 2026). Background reading: `docs/DEPLOYMENT.md` (image and deploy sequence), `docs/SUPABASE_PLAN.md` (database host decision, FIG-1255 to FIG-1258).

Status: the repo side is ready; the environment itself needs the human decisions at the end of this page.

## What is in the repo

| File | Purpose |
|---|---|
| `.env.staging.example` | Every variable staging needs, as names with placeholders. Values go in the host's secret store. |
| `scripts/stagingGuard.ts` | One guard shared by the staging scripts (see "Safety rules"). |
| `scripts/staging-refresh.ts` | Anonymises a restored copy in place: `check`, `anonymise`, `verify`. |
| `scripts/staging-seed.ts` | Adds the UAT sign-ins (and an organisation if the database is empty). |
| `scripts/staging-smoke.ts` | Smoke suite over HTTP, run after each deploy. |
| `.github/workflows/deploy-staging.yml` | Deploy pipeline with an approval. Off until `STAGING_DEPLOY_ENABLED=true`; the host step is a placeholder. |

Suggested `package.json` scripts (not added here to avoid a merge clash; add them with the change that lands this): `staging:refresh` = `tsx scripts/staging-refresh.ts`, `staging:seed` = `tsx scripts/staging-seed.ts`, `staging:smoke` = `tsx scripts/staging-smoke.ts`.

## How staging differs from development (CLAUDE.md rule 10)

| | Development | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | development | **production** (same image) | production |
| `FIGBLOOM_ENVIRONMENT` | unset | `staging` | `production` |
| `ALLOW_DEV_ACCOUNTS` | `true` | **unset** (the staging scripts refuse if it is `true`) | unset |
| `npm run seed:dev`, dev chips, Dev Super Admin | yes | **never** (the boot guard would stop the app) | never |
| Sign-ins | `@figbloom.local` dev accounts | UAT accounts `uat-<role>@staging.example.com` on the normal password login, password from `STAGING_UAT_PASSWORD` | real people |
| Data | invented sample data | anonymised copy of real data, or of a dev database (see below) | real |
| Email | logged to console | sandbox inbox only | real provider |
| Files | local disk | its own private bucket | its own private bucket |

The standard build, the Docker image and CI stay free of dev-only code (`npm run check:build-output`). The `npm run preview` exception in CLAUDE.md is for a database on one computer and is not used for staging.

There is no Dev Super Admin on staging. The Platform Super Admin console is V1.1; a real platform identity for staging is created with that work.

## Safety rules (all enforced in code)

- Refused unless `FIGBLOOM_ENVIRONMENT=staging`. Production is refused by name; an unset variable is refused.
- Refused if `ALLOW_DEV_ACCOUNTS=true`.
- Refused unless the database name contains `staging`, and refused if `DATABASE_URL` equals `PRODUCTION_DATABASE_URL` when that tripwire is set.
- `anonymise` also needs `--yes` and `STAGING_REFRESH_CONFIRM=<database name>`.
- Output is table names, column names and counts only. Database errors are cut down to code, table, column and constraint, because Postgres can quote a row in its message.
- Never run it on a laptop against real data. Real data moves only database to database inside the hosting network (below).

## Data refresh (repeatable)

Get data into staging, anonymise it in place, check it, then add the UAT sign-ins. Do this before the app is pointed at the database.

1. Take a dump from the source (the production backup once production exists; before then, a dev database such as the sample data, which the anonymiser also strips of dev accounts):
   `pg_dump -Fc --no-owner -f <file> <source database>`. Keep the file on the host or in its private storage. Do not put it in git, a chat or a laptop.
2. Empty the staging database, restore, then migrate to the current version:
   `pg_restore --no-owner --clean --if-exists -d <staging database> <file>`, then `npm run migrate:deploy`, `npm run db:bootstrap-role`, `npm run db:grant-role` (set `APP_DB_NAMES` to the staging database name; its default is the dev and test names).
3. Check the rules against the live schema: `npx tsx scripts/staging-refresh.ts check`. It fails on a text, JSON or array column that no rule classifies (a new migration added one). Decide scrub or keep, edit `SCRUB` or `KEEP` in the script, repeat.
4. `STAGING_REFRESH_CONFIRM=<staging database> npx tsx scripts/staging-refresh.ts anonymise --yes`. One transaction: if a row count changes or any residue is found, it rolls back.
5. `npx tsx scripts/staging-refresh.ts verify` (also safe to run any time later).
6. `npm run seed` (role catalogue), then `STAGING_UAT_PASSWORD=... npx tsx scripts/staging-seed.ts`.
7. Delete the dump file. Start or roll the app, then run the smoke suite.

What the anonymiser does:

- **Deleted** (credentials, secrets, queues, logs, imports): sessions, password reset tokens, idempotency keys, push subscriptions, sync queue, website and inbound-email keys, rate-limit counters, background jobs, notification deliveries, sign-in events, recent searches, import sessions and their issues and changes, platform identities. Deleting jobs and deliveries means nothing queued can send.
- **Replaced** with stand-ins: user, contact and company emails (`u<hex>@staging.example.com`), names, phones (`+2540000nnnnnn`, not dialable), websites, free text (notes, subjects, descriptions, bodies, reasons), custom fields, social profiles, qualification answers, audit before/after values, merge snapshots, file names. A missing value stays missing. All password hashes are removed.
- **Kept**: ids, organisation ids and every foreign key (so row-level security and organisation isolation behave exactly as before), counts, dates, stages, statuses, owners, catalogues, email templates, organisation names, and money amounts and currencies.
- Stand-ins are a hash of the original plus a random salt used for that run only and then discarded. The same email maps to the same stand-in everywhere in a run, nothing can be looked up from the result, and each refresh gives different stand-ins.
- Checks inside the transaction: row counts unchanged outside the emptied tables; no user email outside the staging domain, no `@figbloom.local`, no platform identity, no real password hash; no email address left in any text, JSON or array column; row-level security still on with a policy for every table that has `organization_id`.

Limits to know: free text inside kept columns (email template bodies, organisation settings JSON, custom field options) is checked only for email addresses. Files in storage are not copied (staging has its own bucket), so downloads of restored files fail until files are re-uploaded.

## Smoke suite

`STAGING_URL=https://<staging host> npx tsx scripts/staging-smoke.ts` (add `STAGING_UAT_PASSWORD` for the signed-in part). Checks: health and database, login page loads, no dev chips, dev sign-in routes closed, security headers and HSTS, anonymous calls refused, sign-in as Management, Sales and Finance, leads load, payments visible to Management and Finance and refused to Sales (masking). Read-only. The pipeline runs it after each deploy.

## Deploy sequence

As `docs/DEPLOYMENT.md`, with these staging specifics:

1. Build the image once per commit. Staging and production run the same image.
2. One-off migration job against the **direct** database URL: migrate, `db:bootstrap-role`, `db:grant-role` (the entrypoint with `RUN_MIGRATIONS_ON_START=true`), then `npm run seed`. Run it once per deploy, never per replica. For a database with more than a few thousand deals, create the two temporary indexes first and drop them afterwards (`docs/MIGRATION_REHEARSAL.md`, finding 1), and run `scripts/backfill-organization-defaults.ts` after the first upgrade.
3. Replicas start with `RUN_MIGRATIONS_ON_START` unset, using the **pooled** application URL.
4. Smoke suite.

If the database is on Supabase (FIG-1255/1256): app on the transaction pooler (port 6543, `pgbouncer=true`), migrations and role steps on the direct URL (port 5432); the Data API off and `anon`/`authenticated` grants revoked on the `public` schema. Those steps belong to FIG-1256 and are not done here.

Nothing is real until the environment exists. Until then, `npm run db:setup` plus the dev server is the rehearsal on this computer.

## Decisions and actions only a human can take

| # | Who | What | Recommendation |
|---|---|---|---|
| 1 | Given | **Supabase go/no-go (FIG-1255).** Needs a Supabase project, then the spike: migrations, role bootstrap and grants, full suite, tenant attack suite, performance suite, `pg_trgm`, pooler with our per-transaction organisation setting, Data API off with an `anon` test, Nairobi latency, cost. The written decision in `docs/SUPABASE_PLAN.md` is signed by Given. | Run the spike on staging now and decide on its numbers. It is plain Postgres, so leaving later costs little. If any of role bootstrap, pooler behaviour or latency is red, fall back to a managed Postgres elsewhere (the repo side above does not change). |
| 2 | Given | **Hosting for the app** (staging and production use the same one). `docs/DEPLOYMENT.md` is platform-agnostic: any host that runs a Docker image. | Pick one managed container host with a region close to the database, secrets UI, a scheduled-HTTP feature for `/api/cron/notifications-sweep` and a one-off job runner for the migration step. Region matters more than brand. |
| 3 | Given | **Region and Kenya DPA.** No Africa region was found on Supabase (to confirm). Production data location needs the P1.06 assessment (FIG-1258). Staging holds only anonymised data, so it is not blocked by this. | Put staging in the same region as the intended production so latency numbers are honest. |
| 4 | Given | **Accounts**: hosting, database, object storage, a mail sandbox (Mailpit or a sandbox inbox, never a real provider), Sentry project (optional), ClamAV host for `CLAMD_HOST` (FIG-1257). | Create them under a company-owned login, not a personal one. |
| 5 | Given | **DNS and TLS** for the staging host name, and the value for `APP_BASE_URL` (it is also the allowed origin for the CSRF check). | A name such as `staging.<company domain>`; HSTS is sent in production mode, so TLS must be right first. |
| 6 | Given | **Secrets**, each generated fresh and different from production: `APP_DB_PASSWORD`, database owner URL, `CRON_SECRET`, storage keys, mail sandbox login, `STAGING_UAT_PASSWORD`. Put them in the host's secret store and the GitHub `staging` environment. | Never in git, chat or this repo. Rotation steps are in `docs/DEPLOYMENT.md`. |
| 7 | Given | **GitHub**: create the `staging` environment with required reviewers (the approval step); set variables `STAGING_DEPLOY_ENABLED=true` and `STAGING_URL`; add the secrets named in the workflow. Fill in the host's deploy command in the placeholder step. | Required reviewer: Given or Michael. |
| 8 | Given | **Source of staging data.** Before go-live there is no production data. | Use a dev-database dump (the anonymiser removes dev accounts) for the first rehearsals, then a production backup for the final rehearsal on the real shape and size. |
| 9 | Given | **Money amounts stay as they are** in the anonymised copy (they hang off invented companies). | Keep, for realistic reports. Say if amounts must be scaled. |
| 10 | Given | **Deal-rules migration lock** (open item from the rehearsal): edit the merged migration or follow the two-index runbook. | Follow the runbook; do not edit history. |
| 11 | Given | Approve adding the three `staging:*` npm scripts and merging this work to `dev-given`. | Yes. |

Not done here and still open: the infrastructure-as-code for the host (needs decision 2), the mail sandbox wiring (decision 4), the restore drill and backups (FIG-1258), observability (FIG-1124, depends on this issue), and a run of these scripts against a real staging database, which needs an environment to exist. The scripts have been type-checked and linted only; they have not been run against a database.
