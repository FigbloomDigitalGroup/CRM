# Figbloom CRM: MVP handover pack (FIG-1557, MVP-18)

State on **11 Nov 2026**. The live address is https://figbloom-crm.vercel.app. This pack is written for whoever receives the MVP (Michael, or someone he names): it should be enough to run, deploy, support and demo it. **No secrets belong in this document.** Lines marked **FILL IN** need a person to complete them. The live smoke test (MVP-16) results are added to section 0 when that test finishes; until then section 0 says what has and has not been checked.

This is a **test deployment on free plans with fake data**. It is not ready for real customers: see sections 6 and 7 for what changes first.

## 0. The live setup

| Item | State on 11 Nov 2026 |
|---|---|
| Address | `https://figbloom-crm.vercel.app` (free Vercel address, no custom domain). Production branch `dev-given`. Vercel's own login wall is on for preview deployments only. |
| Hosting | Vercel **Hobby (free)**, team "Given", project `figbloom-crm`, Node 22, functions in Frankfurt (`fra1`). Hobby is for personal, non-commercial use: a decision before real customers. |
| Database | Neon **free plan** through the Vercel Marketplace, PostgreSQL 18.6, Frankfurt. Two separate databases: production and preview. Roles `figbloom_app` (no superuser, no RLS bypass) and `figbloom_platform`. Row-level security checked on the hosted database. |
| Migrations | **89 of 90 applied.** On 10 Nov 8 migrations (`20261121090000` to `20261124100000`) had been missed, which broke the webhook and support-access jobs until they were applied. The newest, `20261125090000_sky_default_theme` (default theme becomes Sky), was merged on 10 Nov and is **not yet applied**: run section 4 "Run migrations" before relying on it. |
| Scheduled jobs | Vercel runs three **daily** crons (the Hobby limit). The real 5-minute runner is **cron-job.org** (free), calling `GET /api/cron/jobs` with the `Authorization: Bearer` header. Checked 10 Nov: the job queue runs and its jobs succeed. |
| Email (system) | Gmail SMTP from `givenjim04@gmail.com` with an app password stored in Vercel. Password reset arrives (confirmed 11 Nov). `/api/health` reports `email: ok`. |
| Email (support requests) | Resend free account, sender `onboarding@resend.dev`, inbox `givenjim04@gmail.com`. One real request arrived on 11 Nov with its reference in the subject (FIG-1524). |
| Files | **Temporary.** No bucket yet. Production uses the local driver on the server's scratch folder (`STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR=/tmp/figbloom-files`). Uploads (avatars, logos, attachments, imports, exports, quote PDFs) can **disappear within minutes or hours**. Antivirus is `builtin-only` (file-type checks and the EICAR test) under the risk acceptance in `docs/DECISIONS.md` section 7. A real bucket and scanner are MVP-07, planned for M16. |
| Platform admin | `givenjim04@gmail.com`, two-step sign-in. |
| First organisation | "Figbloom Digital Group" (`figbloom-digital-group`), Management user `givenjim04@gmail.com` (invite accepted 11 Nov). |
| Dev things | No dev account, dev chip or demo route in production. `ALLOW_DEV_ACCOUNTS`, `DEMO_SCREENS`, `NEXT_PUBLIC_DEMO_SCREENS` are not set. |
| Smoke test (MVP-16) | **Results to be added here when the run finishes.** |

## 1. What is in the MVP and what is not

Decision of Given, 9 Nov 2026 (`docs/DECISIONS.md` section 7).

| In the MVP | Not in the MVP (hidden, no dead links) |
|---|---|
| All of V1: leads, deals and handoffs, tasks and calendar, role homes and My metrics, search, notifications, companies and Customer 360, contacts, merge, conversations, renewals, payments, reports, settings, preferences, mobile and PWA | Support access (break-glass), flags and limits, announcements |
| V1.1 on the real API: platform console, two-step sign-in, organisation switcher, quotes and approvals, catalogue, pipelines and stage rules, forecast and targets, chat, mail and calendar connections, assistant, command palette, Help, saved views, sequences, web forms, business-card capture, support requests by email | E-signature page, deposit request |
| Platform sign-in and verify pages, first-admin bootstrap | Roles and field-access editor, developers (API tokens, webhooks), public API, Swahili, churn hints |

Roles: Management, Sales, Delivery, Finance, Restricted Technical, and the separate Platform Super Admin. There is no Customer Support role (decision 12, 5 Nov 2026): members send support requests by email from Help.

Quotes: the Send button emails through the system sender, not the seller's own mailbox (`docs/M13_CLOSEOUT.md`).

## 2. Architecture on Vercel

```
Browser / phone (PWA)
      |
Vercel Hobby (Next.js 15, production branch dev-given; other branches = previews)
      |-- Vercel Cron, daily (Hobby limit) -> /api/cron/jobs 02:00, /api/cron/notifications-sweep 02:30, /api/cron/platform-maintenance 03:00 UTC
      |-- cron-job.org, every 5 minutes (outside caller) -> /api/cron/jobs with the secret in an Authorization header
      |-- Neon free, Frankfurt, plain PostgreSQL: pooled URL for the app, direct URL for migrations. Roles figbloom_app (RLS) and figbloom_platform.
      |-- Files: temporary local scratch folder (lossy). Target: S3-compatible bucket, signed links.
      |-- Email: Gmail SMTP (invites, resets, notifications, quotes); Resend API (support requests)
      |-- Sentry (errors, optional), Google / Microsoft OAuth (mail and calendar, not set up), Anthropic API (assistant, optional)
```

Row-level security keeps organisations apart. The app sets the organisation per transaction, so pooled connections are safe. Details: `docs/DEPLOYMENT.md` ("Vercel MVP deployment"), `docs/VERCEL_SETUP.md`.

## 3. Environment variables

The full table (every variable, Production and Preview, who supplies it) is in `docs/DEPLOYMENT.md`, "Environment variable reference". Values live **only** in the Vercel project settings (Settings, Environment Variables) and the owner's password manager. This is the set in use on production today (names only):

| Group | Variables | Type in Vercel | Holder |
|---|---|---|---|
| Environment | `FIGBLOOM_ENVIRONMENT=production`, `ACTIVE_RELEASE=v1.1`, `APP_BASE_URL`, `TRUSTED_PROXY_HOPS=1`, `SENTRY_ENVIRONMENT` | Config | Given |
| Database | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and the `POSTGRES_*`, `PG*` variables (set by the Neon integration), `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL` | Config (integration), Secret (the two app URLs) | Given |
| Secrets | `CRON_SECRET`, `TWO_STEP_ENCRYPTION_KEY`, `INTEGRATION_ENCRYPTION_KEY` | Secret | Given, two named holders |
| System email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`, `EMAIL_FROM` (Config); `SMTP_PASS` (Secret: Gmail app password) | Mixed | Given |
| Support email | `RESEND_API_KEY`, `SUPPORT_EMAIL_FROM`, `SUPPORT_INBOX_EMAIL` | Secret | Given |
| Files (temporary) | `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR=/tmp/figbloom-files`, `STORAGE_SIGNING_SECRET`, `ANTIVIRUS_MODE=builtin-only` | Secret / Config | Given |

Gotcha learned on 10 Nov: a value piped in from a Windows shell can carry a hidden line break (`local` became `local` plus a newline and the app did not recognise it). Type values in the Vercel form or send them with no trailing newline, and check with a page load after the redeploy.

Must **not** be set in production: `ALLOW_DEV_ACCOUNTS`, `DEMO_SCREENS`, `NEXT_PUBLIC_DEMO_SCREENS`, `NEXT_PUBLIC_PREVIEW_CHIPS`. Environment variable changes take effect only after a redeploy.

## 4. How to deploy, roll back, migrate, run jobs

| Task | How |
|---|---|
| Deploy | Merge a pull request into `dev-given`; Vercel builds and promotes it to production (about 6 minutes). Other branches get a preview URL that must use the preview database. To apply changed environment variables without a code change: Vercel, Deployments, latest deployment, Redeploy (or `vercel redeploy <deployment-url> --environment production`). |
| Roll back the app | Vercel, Deployments, previous good deployment, Promote to Production. Code only. `docs/BACKUP_RESTORE.md` section 10 has the expand-and-contract rule for migrations that already ran. |
| Run migrations | Never automatic. From a trusted computer with `DIRECT_URL` set to the **direct** (non-pooled) owner URL: `npm run migrate:deploy:direct`, then **`npm run db:grant-role`** (needs `DATABASE_URL`, `APP_DB_PASSWORD`, `PLATFORM_DB_PASSWORD` for the same database; it gives the app roles rights on the new tables), then `npx prisma migrate status`. **Do this before or straight after every deploy that adds a migration.** The 10 Nov incident: 8 migrations were on `dev-given` but not on Neon, so webhooks and support-access jobs failed with "relation does not exist". Check: compare the count in `prisma/migrations/` with `select count(*) from _prisma_migrations`. |
| Trigger jobs by hand | `curl -H "Authorization: Bearer $CRON_SECRET" https://figbloom-crm.vercel.app/api/cron/jobs` (also `/api/cron/notifications-sweep`, `/api/cron/platform-maintenance`). A good answer is JSON with `ran`, `succeeded`, `failed`, `missedRuns`. Job list: `docs/JOBS.md`. |
| Look at failed jobs | Table `background_jobs` (`type`, `status`, `attempts`, `last_error`). A job that fails three times is `DEAD`. |
| Health | `/api/health`: database, email, last sweep. `notificationsSweep.lastCompletedAt` is the later of the older sweep record and the newest successful `notifications.sweep` background job (fixed 11 Nov 2026, D-4), so it moves about every 15 minutes while cron-job.org calls `/api/cron/jobs`. A failed sweep shows a generic message in `lastError`, never the job's own error text. |
| Logs | `vercel logs -p figbloom-crm --scope given04 -e production --since 30m` (the CLI must be logged in; pass `-p` and `--scope` when the folder is not linked). |
| First admin | `npm run platform:bootstrap-admin <email> <name>` against the production database; one-time set-up link. `docs/PLATFORM_BOOTSTRAP.md`. |
| New organisation | `scripts/provision-organization.ts` (run locally against production, no mail settings, so the invite link is printed, not emailed) or the platform console. |
| Incidents, secret rotation | `docs/RUNBOOKS.md`. |

**Plans.** Vercel Hobby allows one cron run per day per entry, so the 5-minute work (mail sync, scheduled sends, chat notifications, sequences) depends on **cron-job.org**, a third-party free service: if that account is lost, those jobs stop (daily runs continue). Pro would let `vercel.json` hold the real 5-minute schedule.

## 5. Credentials hand-over (who holds what)

No secrets in this document. Each item is handed over through the owner's password manager, with a second person named.

| Item | Owner today | Hand-over step | Second holder |
|---|---|---|---|
| Vercel team and project | Given (team "Given", Hobby) | Add the receiving owner as team Owner. Hobby allows one user: a second user needs Pro. | **FILL IN** |
| Neon projects (production and preview, via the Vercel Marketplace) | Given's Vercel team | Add an Owner in Vercel; rotate the database passwords after hand-over (`scripts/db-admin.ts` sets them) | **FILL IN** |
| cron-job.org account (the 5-minute caller) | Given | Share the login or recreate the job under the new owner (URL, 5-minute schedule, `Authorization: Bearer` header with `CRON_SECRET`) | **FILL IN** |
| Gmail sender and its app password | Given (`givenjim04@gmail.com`) | Create a new app password under the new sender, put it in Vercel as `SMTP_PASS`, delete the old one in Google Account, App passwords | **FILL IN** |
| Resend account and API key | Given (free account, test sender) | Create the receiver's account, verify the sending domain, issue a new key, rotate `RESEND_API_KEY` | **FILL IN** |
| S3 bucket and access keys | Not created | New private bucket and key when files are switched on (`docs/DEPLOYMENT.md`, "Files") | **FILL IN** |
| Google and Microsoft OAuth apps | Not created | Create the apps, register `${APP_BASE_URL}/api/integrations/oauth/callback`, add the receiver as owner | **FILL IN** |
| Anthropic API key (assistant, card reader) | Not set | Issue a key and set `ANTHROPIC_API_KEY` | **FILL IN** |
| Sentry | **FILL IN** | Add the receiver as Owner | **FILL IN** |
| Domain and DNS | Not set | Transfer or delegate DNS (section 7) | **FILL IN** |
| `CRON_SECRET`, `TWO_STEP_ENCRYPTION_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET` | Generated at setup | Stored only in Vercel and the password manager. Losing `TWO_STEP_ENCRYPTION_KEY` locks everyone out of two-step; losing `INTEGRATION_ENCRYPTION_KEY` disconnects every mailbox. | Two named holders |

## 6. Known gaps (honest list)

Waived or accepted for the test (`docs/DECISIONS.md` sections 6 and 7). **Given recorded the sign-offs on Michael's behalf on 10 Nov 2026; Michael has not signed them himself.** He should read section 7 of that file.

- **Files are not durable** (temporary scratch folder, section 0). Do not rely on uploads. No real antivirus host (built-in checks only).
- **Two background jobs need a storage setting:** `files.purge` and `privacy.retention` failed with "STORAGE_DRIVER must be set" on 10 Nov, before the temporary storage setting existed (11 Nov). They should now succeed; confirm in `background_jobs` after the next daily run. If `STORAGE_DRIVER` is ever removed they fail again.
- **`/api/health` sweep field** (fixed 11 Nov 2026, D-4): it now follows the newest successful `notifications.sweep` job as well as the older record.
- **One migration pending on production:** `20261125090000_sky_default_theme` (section 0).
- **Restore window on Neon free:** Given confirmed a restore window exists. **FILL IN the exact window (hours or days) from the Neon console, Backup and Restore.** A restore drill on the hosted database was done on 9 Nov with very little data (`docs/BACKUP_RESTORE.md` section 10); one harmless message about Neon-internal default privileges appears on restore.
- **Free plans:** Vercel Hobby (non-commercial terms; daily crons only), Neon free (small storage, compute sleeps when idle so the first request after a pause is slow), Gmail sending limits, Resend test sender (delivers only to the account owner), a third-party free caller for the 5-minute jobs. Fine for fake data, not for real customers.
- Kenya Data Protection Act registration and lawyer review; processor agreements; independent penetration test; off-site encrypted backups with two key holders; on-call names (`docs/V1_QUALITY_GATE.md`, `docs/DECISIONS.md` section 6).
- Hosted isolation: the cross-organisation checks passed on the hosted database except the full route walk, which timed out from Kenya (`docs/M14_TEST_REPORT.md` section 5).
- V1.1 gates: G2.03 (performance review and contract freeze) and G2.04 (Michael's sign-off) are open and owned by M15/M16 (`docs/PERMISSION_MATRIX_REPORT_V1_1.md`, `docs/TEST_REPORT_V1_1.md`, `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md`, `docs/V11_TEST_REPORT.md`).
- Mail and calendar connections were not tried end to end with real Google and Microsoft accounts (no OAuth apps yet).
- Quote Send goes out from the system address, not the seller's mailbox.
- V2 items in section 1 are hidden, not built for this release. Any waived gate: `docs/RESTRUCTURE_LOG.md`.

## 7. Changeover checklist: from the test setup to real use

Do these in this order when testing is over.

1. **Domain.** Add the company domain in Vercel (Settings, Domains) and the DNS records it shows. Set `APP_BASE_URL=https://<domain>` in Production and redeploy. Check invite and reset links point to it.
2. **System email.** Replace the Gmail setup with a sender on the company domain: either Resend's SMTP relay (`smtp.resend.com`, no code change) or another provider. Update `SMTP_*` and `EMAIL_FROM`, delete the Gmail app password in Google Account.
3. **Support email.** In Resend, add and verify the Figbloom domain (SPF, DKIM, DMARC). Set `SUPPORT_EMAIL_FROM` to an address on it (for example `support@<domain>`) and `SUPPORT_INBOX_EMAIL` to Michael's support mailbox. Create a new Resend key under the real account and replace `RESEND_API_KEY`. Send one test request.
4. **Files.** Create the private S3 bucket (`docs/DEPLOYMENT.md`, "Files: bucket, CORS, versioning, limits"), set `STORAGE_DRIVER=s3` and the `S3_*` variables, **remove** `STORAGE_LOCAL_DIR` and `STORAGE_SIGNING_SECRET`, redeploy, and test an upload, a download and the cross-organisation file check. Decide on a ClamAV host or renew the risk acceptance, then remove `ANTIVIRUS_MODE`.
5. **OAuth.** If mail and calendar are wanted: create the Google and Microsoft apps, register `https://<domain>/api/integrations/oauth/callback`, set the client ids and secrets, and connect one real mailbox.
6. **5-minute jobs.** Either keep cron-job.org (change its URL to the new domain) or move to Vercel Pro and put the 5-minute schedule back in `vercel.json`.
7. **Plans.** Vercel Hobby is non-commercial: move to Pro before real customers. Neon free: move to a paid plan or to AWS (plain PostgreSQL, so a dump and restore; `docs/BACKUP_RESTORE.md` section 8), then check backup retention.
8. **Accounts.** Remove the test users and "Smoke Test Org B" if present, rotate every secret that appeared in a screenshot or chat, and follow section 5 for the hand-over of each account.
9. **Sign-offs.** Michael reads `docs/DECISIONS.md` section 7 and records his own line; the on-behalf-of entries by Given stay as history.

## 8. Demo script (about 10 minutes, five roles plus platform admin)

Set-up (once, about 10 minutes): sign in as platform admin (two-step), open the console, create a demo organisation, invite a Management user, accept the invite. As Management, create the other four users in Settings, Team. Create demo records **through the product** (the dev seed never runs in production). Use fictional names only. Remember uploads are not durable.

| Minutes | Role | Show |
|---|---|---|
| 0-2 | Management | Home and My metrics; Settings (team, pipelines and stage rules, catalogue, approval rules); Reports; Audit log; Approvals inbox |
| 2-4 | Sales | Create a lead, qualify it, convert to a deal, move stages (a stage rule blocks one move with a reason), build a quote from the catalogue, send it, mark Won, handoff; tasks and calendar; Ask Figbloom; a saved view |
| 4-5 | Delivery | Open the handoff, Customer 360, record extras, renewals, tasks. Show that payments and deal values are not visible |
| 5-6 | Finance | Payments tracker, record a payment, reports; show masking on deals |
| 6-7 | Restricted Technical | The explained "no access" pages and the small set of screens allowed |
| 7-8 | Any member | Help, Contact support: send a request and show the email arriving with its reference |
| 8-9 | Platform admin | Sign in with two-step, organisations list, suspend and reactivate a test organisation, system health, audit log |
| 9-10 | Phone | Install the PWA, capture a business card, queue an offline note and sync it |

Longer, role-by-role walkthroughs (20 minutes each): `docs/guides/`.

## 9. Guides

Role guides and training: `docs/guides/` (`management.md`, `sales.md`, `delivery.md`, `finance.md`, `technical.md`, `admin.md`, `first-run-checklist.md`, `training-plan.md`). Other references: `docs/DEPLOYMENT.md`, `docs/VERCEL_SETUP.md`, `docs/RUNBOOKS.md`, `docs/PLATFORM_BOOTSTRAP.md`, `docs/BACKUP_RESTORE.md`, `docs/SUPPORT_BY_EMAIL.md`, `docs/JOBS.md`, `docs/API_REFERENCE.md`.

## 10. Sign-off

Given has read this: ____________  Date: ________
Michael has a copy: ____________  Date: ________
