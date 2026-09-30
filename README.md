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
Communications have full schema/permission coverage but no service/API/UI
layer yet — the Activity type enum already covers every channel in scope,
so a separate Communications UI hasn't been built. `/reports` gives every
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

Abuse protection (FIG-594) always applies: per-key and per-IP rate
limiting (429, tunable via `WEBSITE_LEAD_RATE_LIMIT_*` in `.env.example`),
a request-body size cap, and field length limits. Allowed origins, a
honeypot field, and Cloudflare Turnstile captcha are each optional,
configured per key from the same settings page, and off unless you turn
them on. Every attempt -- accepted or rejected -- shows up in that page's
"Recent activity" table. A key can be rotated (replaced immediately) or
revoked outright (disabled, no replacement) from there too.

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
