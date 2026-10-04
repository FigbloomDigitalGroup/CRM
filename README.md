# FigBloom CRM

FigBloom Digital Group's internal CRM: leads, contacts, companies, deals
and pipeline, activities/tasks, audit history, role-specific dashboards and
reporting, and a public website lead-capture API.

See `documents/` for the planning trail (research, stakeholder
requirements, MVP scope, data model, architecture) and
`IMPLEMENTATION_NOTES.md` for the specific decisions made while turning
those documents into a running application.

## Stack

- **Next.js (App Router) + React + TypeScript** for the API routes and UI
- **PostgreSQL** with **Prisma** (schema + migrations + client)
- **Row-level security (RLS)** as a database-enforced, defense-in-depth
  tenant boundary, on top of application-level `organizationId` scoping
- **Vitest** for the automated test suite

## Local setup

Prerequisites: Node.js, Docker.

```bash
npm install

# Start local Postgres (dev DB on 55432; a second `figbloom_crm_test`
# database is created automatically for the test suite).
docker compose up -d

cp .env.example .env   # adjust APP_DB_PASSWORD if you want a non-default one

# Apply migrations, create the least-privilege app role, grant it table
# privileges, and seed roles/permissions + a dev FigBloom organization.
npm run db:setup
```

Run the test suite (spins up its own migrations/role/grants against the
separate `figbloom_crm_test` database — see `tests/globalSetup.ts`):

```bash
npm test
```

Run the app itself:

```bash
npm run dev   # http://localhost:3000, then visit /login
```

Sign in with any seeded dev user's email and the shared local-dev password
`figbloom-dev-local` (set in `prisma/seed.ts`). `/dev-login` also still
works in local development for quickly switching between roles without
typing a password each time — see "Authentication" below.

Other scripts: `npm run typecheck`, `npm run lint`, `npm run format`,
`npm run migrate:dev` (interactive, for authoring new migrations),
`npm run migrate:deploy` (non-interactive, for CI/deploys), `npm run build`
/ `npm run start` (production build/serve).

## Why there are two Postgres roles

Postgres row-level security has **no effect on the table owner or a
superuser**. The migration user (`DATABASE_URL`, the `figbloom` role in
local dev) owns every table and must stay privileged to run migrations —
so RLS would be a no-op if the application connected as that same role.

Instead, the application (and any RLS-dependent test) connects as a
separate, least-privilege `figbloom_app` role (`APP_DATABASE_URL`), created
by `npm run db:bootstrap-role` from the `APP_DB_PASSWORD` environment
variable — **never** from a value committed to source control. See
`scripts/db-admin.ts` and
`prisma/migrations/20260924081100_tenant_integrity_and_rls/migration.sql`.

## Tenant isolation, in three layers

1. **Composite tenant-integrity foreign keys.** Every organization-scoped
   parent table has a `UNIQUE (organization_id, id)` constraint, and every
   child reference to it gets an *additional* foreign key on
   `(organization_id, parent_id) -> parent(organization_id, id)`, so the
   database itself rejects any attempt to link a record to a parent in a
   different organization.
2. **Row-level security.** Every organization-scoped table has RLS enabled
   and forced, with a policy restricting rows to
   `organization_id = current_setting('app.current_organization_id')`.
   `src/db/orgScopedClient.ts` (`withOrgContext`) sets that session variable
   inside a transaction before running any query, and fails closed if it's
   ever missing.
3. **Application-level scoping.** Every repository function in
   `src/repositories/*` still takes and filters by `organizationId`
   explicitly. Layers 1–2 are the backstop for when this is missing, not a
   replacement for it.

## Application layers

`src/repositories/*` -> `src/services/*` -> `src/app/api/**/route.ts` /
`src/app/**/page.tsx`:

- **Repositories** (`src/repositories/*`) are thin, org-scoped data access
  — always take `organizationId` explicitly, always run through
  `withOrgContext`. No permission checks here.
- **Services** (`src/services/*`) are where RBAC is actually enforced:
  every function takes an `AuthContext` (a resolved active membership +
  its permission keys) and calls `requirePermission` /
  `requireOwnedRecordPermission` before touching data. Route handlers and
  pages call services, never repositories directly.
- **Routes/pages** (`src/app/**`) resolve the `AuthContext` via
  `resolveRequestContext(orgSlug)` and delegate. `NotFoundError` means the
  record doesn't exist in the caller's organization at all;
  `ForbiddenError` means it exists but the caller's role/ownership doesn't
  permit the action.

One route intentionally doesn't follow this layering:
`/api/public/orgs/[orgSlug]/leads` has no `AuthContext` at all (there's no
session to resolve) and is authenticated by an API key instead — see
"Website lead capture" below.

Coverage: Companies, Contacts, and Leads have full CRUD + search +
duplicate detection + a UI, including lead ownership/assignment. Deals have
full CRUD, a pipeline board grouped by stage, lead-to-deal conversion, and
won/lost-outcome recording — see "Deal outcomes" below. Proposal
References are a minimal create/list/status-update slice scoped to a
single deal, not a full proposal-generation subsystem. Activities and
Tasks have full CRUD + a timeline/list UI, linked to any of
Company/Contact/Lead/Deal — see "Activities and Tasks" below. Audit
history is recorded for ownership changes and deal outcome changes, and
surfaced read-only on Lead and Deal detail pages for `audit.view` holders.
Communications (FIG-598) have full CRUD + a timeline UI on Company,
Contact, Lead, and Deal detail pages, plus a "send and log email" action
that sends real mail through the same SMTP infrastructure as every other
outbound email in this project — see "Communications" below.
CompanyService has full CRUD + UI on the Company detail page ("Services"),
gated by its own `company_services.view`/`.manage` permissions. The 5
controlled reference-data catalogs (Pipeline Stages, Lead Sources, Lead
Statuses, Lost Reasons, Services) have a management UI on the Settings page
(FIG-599) — see "Reference data and website lead assignment" below.
`/reports` gives every
role with a reporting permission a personal "actionable work" view, and
gives `reporting.view.all` holders organization-wide metrics with
owner/source/stage/service/date-range filters — see "Reports" below.

## Deal outcomes are driven by pipeline stage, not set directly

`Deal.outcome`/`wonAt`/`lostAt`/`lostReasonId` only change as a side effect
of moving a deal onto a different `PipelineStage`
(`src/services/dealService.ts#resolveOutcomeFields`): a stage flagged
`isWon` records WON, a stage flagged `isLost` requires a `lostReasonId` and
records LOST, and any other stage reopens the deal. The service layer never
accepts `outcome` as a raw client-supplied field — a deal can't be marked
won or lost without actually moving it through a won/lost-flagged stage.

## Deal value visibility

The owner of a deal can always see the value they themselves quoted
(`deals.view.own`/`deals.edit.own`); seeing another member's deal value
requires the dedicated `deals.view.value` permission. A caller with
`deals.view.all` but not `deals.view.value` still sees every deal, just
with `value` masked to `null` (`valueMasked: true` on the response) rather
than the record being withheld outright.

## Activities and Tasks share one ownership check

Both link to an arbitrary subset of Company/Contact/Lead/Deal, and both
have their own flat permission that says nothing about *which* records the
caller may touch. `src/services/recordAccess.ts#assertCanAccessLinkedRecords`
re-runs each linked parent's own service-layer view check
(`companyService.getCompany`, `leadService.getLead`, etc.) rather than
inventing a parallel ownership model, so holding the flat permission alone
isn't enough to read or write against a record you can't otherwise see.
Tasks have no dedicated `tasks.edit` permission — a task can be updated by
its assignee, its creator, or anyone holding `tasks.assign.any` (see
`src/services/taskService.ts#canManageTask`).

## Reports

`/o/[orgSlug]/reports` (`src/services/reportingService.ts`) has two parts,
gated independently:

- **Your actionable work** — due-today follow-ups, overdue tasks, new
  leads, and stalled deals. Shown to anyone holding `reporting.view.own`
  or `.all`; each sub-section reuses the existing
  `leadService`/`dealService`/`taskService` own/all scoping and value
  masking rather than re-deriving it, so it degrades per-role
  automatically (a role with no `tasks.*`/`leads.*` permission simply sees
  those sections empty).
- **Organization metrics** — lead volume by source, conversion rate,
  won/lost deals, pipeline value by stage, sales by service, and
  follow-up performance, filterable by owner/source/stage/service/date
  range. Gated by `reporting.view.all` (Management only); value-bearing
  aggregates are nulled out (not the whole metric withheld) for a caller
  without `deals.view.value`. Metric definitions are documented in-page.

## Website lead capture

`POST /api/public/orgs/[orgSlug]/leads` lets FigBloom's public website send
form submissions straight into the CRM as leads, with no CRM session
involved — a separate, differently-authenticated namespace from every
other route under `/api/orgs/[orgSlug]/**`. Authenticated by a static
per-organization API key (`x-figbloom-api-key` header), generated and
rotated from `/o/[orgSlug]/settings` (Management only) — see that page for
the exact request shape. Only `name` and one of `email`/`phone` are
required; everything else (company, service interest, message, UTM
params) is best-effort and never blocks the submission. Accepted
submissions are round-robin assigned to an active rep and get an
auto-created follow-up task. See `IMPLEMENTATION_NOTES.md` for why a
static key was chosen over a signed webhook.

Assignment itself is a configurable on/off switch (FIG-599, same settings
page, "Lead assignment"): round-robin (the default) or leave every new
lead unassigned for manual triage. This is a fixed choice between two
modes, not a rules engine (by source/territory/etc. -- still FIG-436, not
built here).

Abuse protection (FIG-594) always applies: per-key and per-IP rate
limiting (429, tunable via `WEBSITE_LEAD_RATE_LIMIT_*` in `.env.example`),
a request-body size cap, and field length limits. Allowed origins, a
honeypot field, and Cloudflare Turnstile captcha are each optional,
configured per key from the same settings page, and off unless you turn
them on. Every attempt -- accepted or rejected -- shows up in that page's
"Recent activity" table. A key can be rotated (replaced immediately) or
revoked outright (disabled, no replacement) from there too.

## Reference data (FIG-599)

The 5 organization-configurable catalogs behind Lead/Deal/Company
dropdowns -- Pipeline Stages, Lead Sources, Lead Statuses, Lost Reasons,
Services -- have a management UI on `/o/[orgSlug]/settings`
(`configuration.manage`, Management only): add, rename, reorder
(move up/down), and deactivate/reactivate each entry; Pipeline Stages also
edit `probability`/`isWon`/`isLost`, Services also edit `category`.

Deactivating never deletes anything and can never orphan a record: every
one of these catalogs is referenced from Lead/Deal/Company by a foreign
key that's either `onDelete: Restrict` (the ones that are required, e.g.
`Lead.leadStatusId`) or `onDelete: SetNull` (the optional ones) -- a true
hard delete was never on the table. `isActive` only gates which values a
*new* record can pick; an existing record keeps showing its value
regardless, and the settings UI shows how many records currently use each
entry before you deactivate it. `CustomerLifecycleState` is the same shape
but wasn't part of this ticket's acceptance criteria, so it's still
seed-only.

## Notifications and outbound delivery

Email (real SMTP once configured, otherwise logged -- same pattern as
password-reset/invite mail) covers three things (FIG-597):

- **New lead assignment** -- the assignee gets an in-app notification (bell
  icon, top bar) and an email, whether they were assigned manually
  (`/o/[orgSlug]/leads`' assign control) or picked up automatically by the
  website lead-capture round-robin.
- **Task due/overdue** -- generated by `npm run notifications:sweep`
  (`scripts/notifications-sweep.ts`), since nothing in a request/response
  cycle "notices" a task crossing into due or overdue on its own. There's
  no scheduler in this project's deployment, so this script needs to be
  invoked on an interval by whatever recurring-task mechanism your host
  provides -- see `docs/DEPLOYMENT.md`, "Scheduled jobs."
- **Website enquiry acknowledgement** -- a one-off email to the enquirer
  themselves (no CRM account, so no in-app notification), off by default,
  toggled per organization from `/o/[orgSlug]/settings`.

Every user controls their own email/in-app preference per notification
type from Settings — "Notification preferences" (self-service, every
active member, no permission required beyond being one). A delivery that
fails is retried with backoff by the same sweep script, up to 5 attempts,
and the failure reason is kept on the delivery row
(`NotificationDelivery.lastError`) rather than silently dropped.

SMS/WhatsApp is architecturally supported (a `NotificationDelivery` row
with `channel: SMS` goes through the exact same create/attempt/retry path
as email) but not wired to a real provider -- no account exists for this
project, so it logs instead of actually sending, the same documented gap
as Sentry (FIG-595) and captcha before a secret is configured (FIG-594).
See `src/notifications/sms.ts`.

## Data import/export (CSV)

Companies, Contacts, and Leads each have a CSV import on their list page
(Management only, `companies.import`/`contacts.import`/`leads.import`):
pick a file, map its columns to CRM fields (pre-filled with a best-effort
guess from the file's own header names), choose what to do with a likely
duplicate (skip it, or create anyway), and import. References by name
(company, lead status/source, service interest, lifecycle state) and by
email (owner) are resolved against this organization's own data — an
unresolvable reference fails just that row, with a reason, rather than the
whole file; the row-level error report is downloadable as its own CSV.
Every import run is audited as one event with its outcome counts, not one
event per row.

Companies, Contacts, Leads, and Deals each have a CSV export on their list
page; Reports has one on `/o/[orgSlug]/reports` (`export.bulk`, in addition
to `reporting.view.all`). Export reuses each entity's existing service-layer
`list*` function, so permission scoping (own vs. all) and deal value
masking apply to an export exactly as they do to the UI — exporting never
reveals a value the exporter couldn't already see on screen. The response
streams as it's generated rather than building the whole file in memory
first.

There's no job queue in this project, so very large imports/exports are
handled directly rather than handed off to a background worker: import
streams the uploaded file row-by-row (memory never scales with file size)
up to a configurable row ceiling (`IMPORT_MAX_ROWS`, default 20,000); export
streams its response as it serializes. See `IMPLEMENTATION_NOTES.md` --
"Data import/export (FIG-596)" -- for the full reasoning.

## Communications

Every Company, Contact, Lead, and Deal detail page has a Communications
section (`communications.view`/`.create`), alongside Activities: logging a
communication never sends anything (a record of a call, a meeting, or an
email that happened outside the CRM), while "Send email" actually sends
real mail -- through the same SMTP-or-log infrastructure as password-reset
and notification emails -- and logs the result as a side effect. A send
that genuinely fails (SMTP configured but the attempt errors) is never
logged, so there's no false record of mail that didn't go out.

Inbound email -- someone replying to a contact outside the CRM -- is
BCC-to-CRM style: a per-organization token
(`/o/[orgSlug]/settings`, "Inbound email") authenticates a webhook
(`POST /api/public/orgs/[orgSlug]/communications/inbound`) that a real
inbound-email provider (Postmark/Mailgun/SendGrid inbound parse) would be
configured to call. It matches the sender's email against an existing
Contact and logs it there (and on that contact's company, if any); a
sender matching no contact is simply not logged, not an error. No real
inbound-email provider account exists for this project -- see
`docs/DEPLOYMENT.md` -- so nothing calls this webhook yet, but it's a real,
tested endpoint ready to be wired to one.

CompanyService (`company_services.view`/`.manage`) tracks which of
FigBloom's services a company holds, independent of any single deal, on
the Company detail page's "Services" section.

## Authentication

`/login` is real: email + password, checked against a bcrypt hash
(`src/auth/password.ts`), backed by a revocable, DB-stored session
(`src/auth/session.ts`) — not a stateless token, so a password reset or a
manual revoke actually invalidates it immediately. `/forgot-password` and
`/reset-password` cover account recovery (and doubles as how a user with no
password yet sets their first one). `/signup` creates the account and signs
the caller in, but grants no organization access on its own — actual
Membership creation is still the admin/approved-process step FIG-437
describes (see "Member administration," below), so a fresh signup lands on
a clear "no access yet" message rather than the `figbloom` dashboard.
Password-reset emails send over real SMTP once `SMTP_HOST` is set
(`.env.example`); with nothing configured, the reset link is logged
server-side instead, which is what local dev and the test suite run
against today. See `IMPLEMENTATION_NOTES.md` — "Real authentication
(FIG-592)" — for the provider decision and everything else.

## Member administration

`/o/[orgSlug]/settings` (Members section, `membership.view`/`.manage` +
`role.assign`) is the real add/invite/deactivate/role-change path — the
one-off `scripts/manual-add-second-sales-user.ts` is now only a shortcut
for local dev, not the only way in. Inviting someone creates a `PENDING`
membership and emails (or, with no SMTP configured, logs) an
`/accept-invite` link; nothing in `resolveActiveMembership` matches
`PENDING`, so the invite grants zero access until accepted. The
organization's last active Management member can't be deactivated or
reassigned away from Management — see `IMPLEMENTATION_NOTES.md` —
"Member/role administration (FIG-593)" — for the rest.

`/dev-login` (`src/auth/devSession.ts`) is a separate, no-password
placeholder that still exists purely for quickly switching between the
seeded dev users while developing locally. It's hard-disabled outside
`NODE_ENV=development` — the page 404s and the API route rejects requests,
both checked at request time, and the page is additionally baked into a
static 404 at production build time. Nothing outside `src/auth/` depends on
which login path was used, only on the `userId: string | null` that
`getCurrentUserId()` / `resolveRequestContext()`
(`src/auth/requestContext.ts`) produce.

## CI, Docker, and deployment

`.github/workflows/ci.yml` runs lint, typecheck, migrations, and the full
test suite against a real Postgres service container on every PR and push
to `main`, plus a separate job that builds the Docker image itself.
`Dockerfile` builds a single image that serves both the running app and
the one-off deploy admin commands (`migrate:deploy`,
`db:bootstrap-role`/`db:grant-role`) — see `docker/entrypoint.sh`.
`GET /api/health` checks real database connectivity, not just that the
process is up; structured logs go to stdout via `pino`
(`src/lib/logger.ts`). None of this is written-and-hoped: the image was
actually built and run against this project's own dev Postgres, and the
backup/restore procedure below was actually executed, not just described.

See `docs/DEPLOYMENT.md` for the full deploy sequence, the staging/
production environment split, every required env var, secrets handling,
and the verified backup/restore procedure.
