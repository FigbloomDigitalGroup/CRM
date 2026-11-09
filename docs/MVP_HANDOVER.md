# Figbloom CRM: MVP handover pack (FIG-1557, MVP-18)

Drafted 9 Nov 2026. Target hand-over: 11 Nov 2026. **This is a draft: the hosted parts (Vercel, Neon, bucket, Resend, domain) were not created when it was written. Every line marked TO CONFIRM must be checked against the live setup before Given signs.** No secrets belong in this document.

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
      |-- Vercel Cron -> /api/cron/jobs (5 min), /api/cron/notifications-sweep (30 min), /api/cron/platform-maintenance (daily)
      |-- PostgreSQL (Neon, plain Postgres): pooled URL for the app, direct URL for migrations. Roles figbloom_app (row-level security) and figbloom_platform.
      |-- S3-compatible bucket (signed links; uploads go straight to the bucket)
      |-- Resend (invites, resets, notifications, quotes, support requests)
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

Vercel plan: a **Pro** plan is needed. The Hobby plan only allows daily cron jobs, so the 5-minute jobs (mail sync, scheduled sends, chat notifications, sequences) would not run.

## 5. Credentials hand-over (who holds what)

No secrets in this document. Each item is handed over in the owner's password manager, with a second person named.

| Item | Owner today | Hand-over step | Second holder |
|---|---|---|---|
| Vercel team and project | TO CONFIRM | Add the receiving owner as team Owner | TO CONFIRM |
| Neon project (production and preview) | Michael (TO CONFIRM) | Transfer or add an Owner; rotate the database passwords after hand-over | TO CONFIRM |
| S3 bucket and access keys | TO CONFIRM | New access key for the receiver; delete the old one | TO CONFIRM |
| Resend account, API key, sending domain | Michael | Add the receiver; rotate the key | TO CONFIRM |
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
- Restore drill on the hosted database (`docs/BACKUP_RESTORE.md` section 10).
- V1.1 formal gates (M15: full regression and role matrix report, platform console threat model, contract freeze, Michael's sign-off) run after launch. The minimum checks before launch are in `docs/MVP_GATES.md`.
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
