# Vercel setup: the human steps (MVP, 9 Nov 2026)

Do these in order. Reference for every value: `docs/DEPLOYMENT.md`, section "Vercel MVP deployment". Decisions: `docs/DECISIONS.md` section 7. Everything in angle brackets is yours to fill in; real values go into Vercel and the secret store only, never into a file or a commit.

## 0. Before you start

- A Vercel account on the **Pro** plan (Hobby allows cron runs once a day only; the job runner needs every 5 minutes).
- Admin access to the GitHub repository (the Vercel GitHub app must be allowed to read it).
- A domain you control and can edit DNS for.
- Sign the risk acceptance in `docs/DECISIONS.md` section 7.6 (uploads without a malware scanner) before real files are uploaded.

## 1. Create the project from GitHub

1. Vercel dashboard, Add New, Project, Import the Figbloom CRM repository.
2. Framework preset: Next.js. Leave the build settings alone: `vercel.json` sets the install command (`npm ci`) and the build command (`prisma generate && next build`). **Do not add a migration step to the build.**
3. Do not deploy yet if the environment variables are missing: skip to step 2 first, then deploy.

## 2. Production branch is `dev-given`

Project, Settings, Git, Production Branch: `dev-given`. Every other branch and every pull request then gets a preview deployment. Previews never get production secrets (step 5).

## 3. Neon database (Marketplace)

1. Project, Storage, Create Database, Neon (Marketplace). Create **one project for production**, region as agreed by Given.
2. Create a second, separate Neon project for previews and connect it to the **Preview** environment only. Never give the production database to Preview.
3. From Neon's connection details copy: the **direct** (non-pooled) URL and the **pooled** URL (host contains `-pooler`) of the owner role.
4. Run the production database bring-up from `docs/DEPLOYMENT.md` ("Production database bring-up", steps 1 to 10) on your computer. In short:
   ```bash
   export DATABASE_URL="<direct owner URL>"
   export DIRECT_URL="$DATABASE_URL"
   export APP_DB_PASSWORD="<random>"
   export PLATFORM_DB_PASSWORD="<random>"
   psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
   npm run migrate:deploy:direct
   npm run db:bootstrap-role
   npm run db:grant-role
   NODE_ENV=production npm run seed
   ```
   Never run `seed:dev` or `db:setup` here.

## 4. Storage bucket

Create a private S3-compatible bucket (AWS S3 suggested): block public access, default encryption, versioning on. Create a key limited to that bucket. Set the CORS rule from `docs/DEPLOYMENT.md` ("Files: bucket, CORS, versioning, limits") with your real domain. Make a second bucket and key for Preview.

## 5. Environment variables

Project, Settings, Environment Variables. Enter each variable from the table in `docs/DEPLOYMENT.md` ("Environment variable reference") with the right environments ticked. Minimum for Production:

```
FIGBLOOM_ENVIRONMENT=production
ACTIVE_RELEASE=v1.1
APP_BASE_URL=https://<your-domain>
DATABASE_URL=<direct owner URL>
APP_DATABASE_URL=<pooled figbloom_app URL>?sslmode=require&pgbouncer=true&connection_limit=1
PLATFORM_DATABASE_URL=<pooled figbloom_platform URL>?sslmode=require&pgbouncer=true&connection_limit=1
STORAGE_DRIVER=s3
S3_ENDPOINT=<https://s3.<region>.amazonaws.com>
S3_REGION=<region>
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
ANTIVIRUS_MODE=builtin-only
CRON_SECRET=<openssl rand -hex 32>
TWO_STEP_ENCRYPTION_KEY=<openssl rand -base64 32>
INTEGRATION_ENCRYPTION_KEY=<openssl rand -base64 32>
TRUSTED_PROXY_HOPS=1
RESEND_API_KEY=<from Resend>
SUPPORT_EMAIL_FROM=<Figbloom CRM <support-requests@mail.your-domain>>
SUPPORT_INBOX_EMAIL=<inbox>
```

Add the mail provider, OAuth, `ANTHROPIC_API_KEY` and push values from the table when you have them. Mark every secret Sensitive.

**Never add to Production or Preview:** `ALLOW_DEV_ACCOUNTS`, `DEMO_SCREENS`, `NEXT_PUBLIC_DEMO_SCREENS`, `NEXT_PUBLIC_PREVIEW_CHIPS`.

Preview: the same names with the preview database, the preview bucket, different secrets, `FIGBLOOM_ENVIRONMENT=preview`, and no `ANTIVIRUS_MODE` needed.

## 6. Cron

Nothing to configure: `vercel.json` installs the three entries (`/api/cron/jobs` every 5 minutes, `/api/cron/notifications-sweep` every 30 minutes, `/api/cron/platform-maintenance` daily). After the first production deploy, open Project, Settings, Cron Jobs and check all three are listed; use "Run" on `/api/cron/jobs` and check the log shows a 200. A 500 means `CRON_SECRET` is missing; a 401 means it is wrong.

## 7. Domain and DNS

1. Project, Settings, Domains, add `<your-domain>`; create the DNS records Vercel shows; wait for the certificate.
2. Set `APP_BASE_URL=https://<your-domain>` (Production) and redeploy.
3. Register the OAuth redirect `https://<your-domain>/api/integrations/oauth/callback` in Google Cloud and in Microsoft Entra.
4. In Resend add the sending domain, create the SPF and DKIM records it shows, and wait for "verified".

## 8. First deploy and checks

1. Push to `dev-given` (or press Redeploy). Check the build log: it must run `prisma generate` and `next build` and must not run any migration.
2. Open `https://<your-domain>/api/health` (answers ok) and the login page.
3. Run bring-up steps 8 and 9 of `docs/DEPLOYMENT.md` (first platform admin and organisation, then the cross-organisation check on the hosted database).
4. Take a first database backup (`docs/BACKUP_RESTORE.md`) before real data is loaded.

## 9. What is still open after these steps

- Written risk acceptance (no malware scanner), signed by Given and Michael.
- Michael's confirmation of the Neon and bucket choices.
- Kenya Data Protection Act items listed in `docs/DECISIONS.md` section 6.14.

## 10. Free-plan path (Hobby) for a sales-team test, added 9 Nov 2026

Decision context: Given wants to start with nothing paid. This is fine for a **test with fake data**. It is **not** the setup for real customers (see "Limits"). Limits quoted below are from memory of the providers' public pages: **check each one on the day**, they change.

### What is free, and what to use

| Need | Free option | Notes |
|---|---|---|
| Hosting | Vercel Hobby | One user per team. Terms limit Hobby to personal, non-commercial use; a business CRM running real work is a commercial use. A test with fake data is a gray area: Given decides. |
| Database | Neon Free plan | Small storage, compute that sleeps when idle (first request after idle is slow), short point-in-time window. Use a separate database for previews. |
| Files | Cloudflare R2 or AWS S3 free tier | S3-compatible, so `STORAGE_DRIVER=s3` works. Both ask for a payment card at sign-up even when usage stays in the free allowance. Check bucket CORS and versioning. |
| Email | Resend Free plan, or Gmail SMTP | Resend without your own verified domain only delivers to the account owner's own address. To email other people, either verify a domain (the one cost: a domain, roughly a yearly fee) or set `SMTP_HOST=smtp.gmail.com` with a Google app password (free, daily send cap; the sender is the Gmail address). SMTP wins over Resend when `SMTP_HOST` is set. |
| Address | `<project>.vercel.app` | Set `APP_BASE_URL` to it. Google/Microsoft OAuth redirect addresses can use it. |
| Errors | Sentry free plan | Optional. |
| Scheduled jobs | See below | Hobby crons run once a day at most. |

### Scheduled jobs on the free plan

`vercel.json` holds three **daily** crons (a deployment with a more frequent cron is rejected on Hobby; Hobby also runs a daily cron at any time inside its hour, not exactly on the minute). That is too slow for mail sync, scheduled sends, chat notifications and sequences. Add a free external caller:

1. Create a free account at a cron service (for example cron-job.org).
2. Create a job: `GET https://<your-app>.vercel.app/api/cron/jobs`, every 5 minutes, request header `Authorization: Bearer <CRON_SECRET>` (the same value as in Vercel; store it in the service's secret field, never in a URL).
3. Optionally a second job for `/api/cron/notifications-sweep` every 30 minutes.
4. Check `/api/health`: `lastCompletedAt` must move every few minutes.

The route checks the secret and fails closed, so the address alone does nothing.

### Deploying if the GitHub repository is in an organisation

If Vercel Hobby will not import the private organisation repository (check at import time), deploy from this computer instead: `vercel` for a preview, `vercel --prod` for production, from the `dev-given` checkout. Pushes then do not deploy by themselves: someone runs the command.

### Limits (why this is a test setup)

- Hobby terms: non-commercial use. Moving to Pro (a monthly per-seat fee; check current price) is the normal step before real customers.
- Database sleeps and has small storage and a short restore window; real data needs a paid database tier or the AWS plan (decision 5 of 4 Nov).
- Jobs depend on a third-party free caller; if it stops, mail sync and scheduled sends stop (`/api/health` shows it).
- No SLA from any of the free plans.
