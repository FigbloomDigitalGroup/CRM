# Figbloom CRM: MVP handover pack (FIG-1557, MVP-18)

Drafted 9 Nov 2026, updated the same day with the live setup. Target hand-over: 11 Nov 2026. **Still a draft until the smoke test (MVP-16) is done: section 0 lists what has been checked on the live site and what has not.** Every line marked TO CONFIRM must be checked before Given signs. No secrets belong in this document.

## 0. The live setup on 9 Nov 2026

Checked from outside, on https://figbloom-crm.vercel.app, unless marked "not checked":

| Item | State |
|---|---|
| Address | `https://figbloom-crm.vercel.app` (the free Vercel address; no custom domain yet). Production branch `dev-given`; Vercel's own login wall is on for preview deployments only |
| Hosting | Vercel **Hobby (free)** plan, team "Given", project `figbloom-crm`, Node 22, functions in Frankfurt (`fra1`). The Hobby terms are for personal, non-commercial use: a decision for Given before real customers |
| Database | Neon (through the Vercel Marketplace), **free plan**, PostgreSQL 18.6, Frankfurt. Two separate databases: production and preview. All 81 migrations applied; roles `figbloom_app` and `figbloom_platform` created; five roles and 89 permissions seeded; no dev data. The app role is not a superuser, has no RLS bypass, sees 0 leads with no organisation set, and cannot read the platform identity table. We developed and tested on PostgreSQL 16; the suites that were run on 18 are listed in `docs/M14_TEST_REPORT.md` |
| `/login`, `/platform/sign-in`, `/platform/accept-invite`, `/platform/verify` | Answer 200. `/sign/<anything>` answers 404 (signing is V2) |
| `/api/health` | `status: ok`, `appRole: ok` (the app connects as the restricted role). **`email: misconfigured`** until the sender password is added |
| Scheduled jobs | Vercel runs three **daily** crons (the free plan allows nothing more frequent). All three endpoints answer 401 without the secret and 200 with it; the platform audit-log check passed. **Not set up:** a free outside caller for `/api/cron/jobs` every 5 minutes (cron-job.org account needed) |
| Platform admin | The first platform admin (`givenjim04@gmail.com`) was created and has signed in with two-step |
| Organisations and users | **None yet.** Not created: needs the first Management user's email |
| Email | Sender will be `givenjim04@gmail.com` through Gmail SMTP with an app password. The password is **not added yet** (needs the phone). `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`, `EMAIL_FROM` are set |
| Files | **No bucket**, deferred by Given. File uploads show an error until a bucket and the risk acceptance in `docs/DECISIONS.md` 7.6 exist |
| Not checked | Smoke test on the live site (MVP-16); mail or calendar connection with real accounts; Playwright on the live address; the full route walk against the hosted database (it passed locally; it needs a faster link, see `docs/M14_TEST_REPORT.md` section 5) |

## 1. What is in the MVP and what is not

Decision of Given, 9 Nov 2026 (`docs/DECISIONS.md` section 7).

| In the MVP | Not in the MVP (hidden, no dead links) |
|---|---|
| All of V1: leads, deals and handoffs, tasks and calendar, role homes and My metrics, search, notifications, companies and Customer 360, contacts, merge, conversations, renewals, payments, reports, settings, preferences, mobile and PWA | Support access (break-glass), flags and limits, announcements |
| V1.1 on the real API: platform console, two-step sign-in, organisation switcher, quotes and approvals, catalogue, pipelines and stage rules, forecast and targets, chat, mail and calendar connections, assistant, command palette, Help, saved views, sequences, web forms, business-card capture, support requests by email | E-signature page, deposit request |
| Platform sign-in and verify pages, first-admin bootstrap | Roles and field-access editor, developers (API tokens, webhooks), public API, Swahili, churn hints |

Roles: Management, Sales, Delivery, Finance, Restricted Technical, and the separate Platform Super Admin. There is no Customer Support role (decision 12, 5 Nov 2026): tenants send support requests by email from Help.

Quotes: the Send button emails through the system sender (`EMAIL_FROM`), not through the seller's own mailbox. Sending from the seller's mailbox is a known gap (`docs/M13_CLOSEOUT.md`).

## 2. Architecture on Vercel

```
Browser / phone (PWA)
      |
Vercel (Next.js 15, production branch dev-given; other branches = previews)
      |-- Vercel Cron (daily, free plan) -> /api/cron/jobs, /api/cron/notifications-sweep, /api/cron/platform-maintenance
      |-- Free outside caller (cron-job.org, to set up) -> /api/cron/jobs every 5 minutes, with the secret in a header
      |-- PostgreSQL (Neon, plain Postgres): pooled URL for the app, direct URL for migrations. Roles figbloom_app (row-level security) and figbloom_platform.
      |-- S3-compatible bucket (not set up yet; signed links; uploads go straight to the bucket)
      |-- Email: Gmail SMTP for now (Resend is the option for a real domain): invites, resets, notifications, quotes, support requests
      |-- Sentry (errors)
      |-- Google / Microsoft OAuth (mail and calendar), Anthropic API (assistant)
```

Row-level security keeps organisations apart; the app sets the organisation per transaction, so pooled connections are safe. Details: `docs/DEPLOYMENT.md` ("Vercel MVP deployment"), `docs/VERCEL_SETUP.md`.

## 3. Environment variables

One table, with where each is set and who supplies it: `docs/DEPLOYMENT.md`, section "Vercel MVP deployment". Must **not** be set in production: `ALLOW_DEV_ACCOUNTS`, `DEMO_SCREENS`, `NEXT_PUBLIC_DEMO_SCREENS`, `NEXT_PUBLIC_PREVIEW_CHIPS`. Must be set in Production: `FIGBLOOM_ENVIRONMENT=production`. File scanning: `ANTIVIRUS_MODE=builtin-only` only after Given and Michael sign `docs/DECISIONS.md` section 7.6.

## 4. How to deploy, roll back, migrate, run jobs

| Task | How |
|---|---|
| Deploy | Push to `dev-given` (production) through a pull request. Other branches get a preview URL. Previews must use a separate preview database, never production. |
| Roll back the app | Vercel, Deployments, previous good deployment, Promote to Production. Code only. See `docs/BACKUP_RESTORE.md` section 10 for the expand-and-contract rule. |
| Run migrations | Never automatic. Before the deploy that needs them: `npm run migrate:deploy:direct` with `DIRECT_URL` set to the direct (non-pooled) database URL. Check `prisma migrate status`. Take a manual dump first for destructive changes. |
| Trigger jobs by hand | `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/jobs` (also `/api/cron/notifications-sweep`, `/api/cron/platform-maintenance`). Job list: `docs/JOBS.md`. |
| Health | `/api/health` (database, email, storage, last job completion). |
| First admin | `npm run platform:bootstrap-admin <email> <name>` against the production database; one-time set-up link. Walk-through: `docs/PLATFORM_BOOTSTRAP.md`. |
| Incidents, secrets rotation | `docs/RUNBOOKS.md`. |

Vercel plan: the project runs on the free **Hobby** plan. It only allows daily cron jobs, so the 5-minute jobs (mail sync, scheduled sends, chat notifications, sequences) need either the free outside caller (section 0) or a Pro plan. Hobby is also limited to personal, non-commercial use.

## 5. Credentials hand-over (who holds what)

No secrets in this document. Each item is handed over in the owner's password manager, with a second person named.

| Item | Owner today | Hand-over step | Second holder |
|---|---|---|---|
| Vercel team and project | Given (Vercel team "Given", Hobby) | Add the receiving owner as team Owner (the Hobby plan allows one user: moving to Pro is needed for a second) | TO CONFIRM |
| Neon projects (production and preview, created through the Vercel Marketplace) | Given's Vercel team (Michael to confirm the choice) | They live under the Vercel integration: add an Owner in Vercel; rotate the database passwords after hand-over (`scripts/db-admin.ts` sets them) | TO CONFIRM |
| S3 bucket and access keys | Not created (deferred) | New bucket and key when files are switched on | TO CONFIRM |
| Gmail sender (`givenjim04@gmail.com`) and its app password | Given | The app password is the only secret; create a new one, delete the old one in Google Account, App passwords | TO CONFIRM |
| Resend account, API key, sending domain | Not used for now (option for a real domain) | Add the receiver; rotate the key | TO CONFIRM |
| Google and Microsoft OAuth apps | Michael | Add the receiver as an owner of each app | TO CONFIRM |
| Anthropic API key | Michael | Issue a new key to the receiver | TO CONFIRM |
| Sentry | TO CONFIRM | Add the receiver as Owner | TO CONFIRM |
| Domain and DNS | Michael | Transfer or delegate DNS | TO CONFIRM |
| Encryption keys (`TWO_STEP_ENCRYPTION_KEY`, `INTEGRATION_ENCRYPTION_KEY`), `CRON_SECRET` | Generated at setup | Stored only in Vercel and the password manager. Losing `TWO_STEP_ENCRYPTION_KEY` locks everyone out of two-step; losing `INTEGRATION_ENCRYPTION_KEY` disconnects every mailbox. | Two named holders |

## 6. Known gaps (honest list)

Not done and not waived (`docs/V1_QUALITY_GATE.md`, `docs/DECISIONS.md` section 6):

- Kenya Data Protection Act registration and lawyer review; processor agreements.
- Independent penetration test.
- Production antivirus host: the MVP runs with the built-in file-type checks only, under the risk acceptance in `docs/DECISIONS.md` section 7.6 (to be signed).
- Off-site encrypted backups with two key holders; on-call names.
- Restore drill on the hosted database: see `docs/BACKUP_RESTORE.md` section 10 for the result (a drill with a very small amount of data; no real data exists yet).
- Free plans: Vercel Hobby (non-commercial terms), Neon free (small storage, compute that sleeps when idle so the first request after a pause is slow, a short point-in-time restore window: the exact window was not checked), Gmail sending limits, and a third-party free caller for the 5-minute jobs. Fine for a test with fake data; not for real customers.
- Hosted isolation: the cross-organisation checks passed on the hosted database except the full route walk, which timed out from Kenya (`docs/M14_TEST_REPORT.md` section 5).
- V1.1 gates (M15): the role matrix and tenant-isolation tests and the platform console security review are in `docs/PERMISSION_MATRIX_REPORT_V1_1.md`, `docs/TEST_REPORT_V1_1.md` and `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md`. The performance review and contract freeze (G2.03), and Michael's sign-off (G2.04), are still open.
- Mail and calendar connections were not tried end to end against real Google and Microsoft accounts.
- Quote Send goes out from the system address, not the seller's mailbox.
- V2 items above are hidden, not built.
- Any waived gate: see `docs/RESTRUCTURE_LOG.md`.

## 7. Demo script (about 20 minutes per role)

Set-up: sign in as platform admin (two-step), create a demo organisation in the console, invite a Management user, accept the invite. Then, as Management, create the other four users in Settings, Team. Create demo records **through the product** (the dev seed does not run in production). Use fictional names only.

| Role | Walk-through |
|---|---|
| Management | Home and My metrics; Settings (team, pipelines and stage rules, catalogue, approval rules); Reports; Audit log; Approvals inbox; Data requests |
| Sales | Create a lead, qualify it, convert to a deal, move stages (a stage rule blocks one move with a reason), build a quote with a catalogue item, send it, mark Won, handoff; tasks and calendar; chat; Ask Figbloom; saved view |
| Delivery | Open the handoff, Customer 360, record extras, renewals, tasks. Show that payments and deal values are not visible |
| Finance | Payments tracker, record a payment, reports; show masking on deals |
| Restricted Technical | Show the explained "no access" pages and the small set of screens allowed |
| Platform admin | Sign-in with two-step, organisations list, suspend and reactivate, system health, audit log |

Phone: install the PWA, capture a business card, queue an offline note and sync it.

## 8. Guides

Role guides and training: `docs/guides/` (`management.md`, `sales.md`, `delivery.md`, `finance.md`, `technical.md`, `admin.md`, `first-run-checklist.md`, `training-plan.md`). Other references: `docs/DEPLOYMENT.md`, `docs/RUNBOOKS.md`, `docs/PLATFORM_BOOTSTRAP.md`, `docs/BACKUP_RESTORE.md`, `docs/SUPPORT_BY_EMAIL.md`, `docs/API_REFERENCE.md`.

## 9. Sign-off

Given has read this: ____________  Date: ________
Michael has a copy: ____________  Date: ________
