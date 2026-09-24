# FigBloom CRM

Core CRM foundation for FigBloom Digital Group: the database/tenant model
from **FIG-438**, lead/contact/company management from **FIG-439**,
deals/pipeline/lead-conversion from **FIG-440**, and
activities/tasks/audit history from **FIG-441**, implementing the
architecture and access-control baseline from **FIG-436** (V1 Architecture &
Tenant Model) and **FIG-437** (Authentication, Organizations, Roles &
Tenant Isolation), scoped by **FIG-300** (MVP Scope) and **FIG-299** (Core
CRM Data Model).

See `documents/` for the full planning trail (research, stakeholder
requirements, MVP scope, data model, architecture) and
`IMPLEMENTATION_NOTES.md` for the specific decisions made while turning
those documents into a running application.

## Stack

- **Next.js (App Router) + React + TypeScript** for the API routes and UI
- **PostgreSQL** with **Prisma** (schema + migrations + client)
- **Row-level security (RLS)** as a database-enforced, defense-in-depth
  tenant boundary, on top of application-level `organizationId` scoping
- **Vitest** for the automated test suite (migrations, seed data,
  relationships, tenant isolation, authorization foundation, service-layer
  permission enforcement)

FIG-442 (website lead capture API) and FIG-443 (dashboards/reporting) build
on top of this.

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
npm run dev   # http://localhost:3000, then visit /dev-login
```

`/dev-login` is a placeholder, no-password login — pick one of the five
seeded dev users (one per V1 role) to explore the app as that role. See
"Dev login" below before treating this as real authentication.

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
   parent table has a `UNIQUE (organization_id, id)` constraint. Every
   child reference to it gets an *additional* foreign key on
   `(organization_id, parent_id) -> parent(organization_id, id)`, so the
   database itself rejects any attempt to link a record to a parent in a
   different organization — this cannot be bypassed by an application bug.
2. **Row-level security.** Every organization-scoped table has RLS enabled
   and forced, with a policy restricting rows to
   `organization_id = current_setting('app.current_organization_id')`.
   `src/db/orgScopedClient.ts` (`withOrgContext`) sets that session variable
   inside a transaction before running any query, and fails closed
   (returns/affects zero rows) if it's ever missing.
3. **Application-level scoping.** Every repository function in
   `src/repositories/*` still takes and filters by `organizationId`
   explicitly. Layers 1–2 are the backstop for when this is missing, not a
   replacement for it.

## Application layers

`src/repositories/*` -> `src/services/*` -> `src/app/api/**/route.ts` /
`src/app/**/page.tsx`, matching FIG-436 section 10's request flow:

- **Repositories** (`src/repositories/*`) are thin, org-scoped data access
  — always take `organizationId` explicitly, always run through
  `withOrgContext`. No permission checks here.
- **Services** (`src/services/*`) are where FIG-437's RBAC is actually
  enforced: every function takes an `AuthContext` (a resolved active
  membership + its permission keys) and calls `requirePermission` /
  `requireOwnedRecordPermission` before touching data. Route handlers and
  pages call services, never repositories directly.
- **Routes/pages** (`src/app/**`) resolve the `AuthContext` via
  `resolveRequestContext(orgSlug)` and delegate. `NotFoundError` means the
  record doesn't exist in the caller's organization at all; `ForbiddenError`
  means it exists but the caller's role/ownership doesn't permit the action
  (existence isn't treated as secret between colleagues in the same org —
  see `src/services/leadService.ts`).

Coverage is representative, not exhaustive: Companies, Contacts, and Leads
(including lead ownership/assignment — FIG-439's scope) have full CRUD +
search + duplicate detection + a UI. Deals also have full CRUD, a pipeline
board grouped by stage, lead-to-deal conversion, and won/lost-outcome
recording (FIG-440's scope) — see "Deal outcomes are driven by pipeline
stage" below. Proposal References have a minimal create/list/status-update
slice scoped to a single deal, deliberately not a full proposal-generation
subsystem (FIG-438 section 11). Activities and Tasks (FIG-441's scope) have
full CRUD + a timeline/list UI, linked to any of Company/Contact/Lead/Deal;
see "Activities and Tasks share one ownership check" below. Audit history
is recorded for lead/deal/company/contact ownership changes and deal
outcome changes, and surfaced read-only on Lead and Deal detail pages for
`audit.view` holders. Communications have full schema/constraint coverage
but no service/API/UI layer — see "What FIG-441 explicitly does not
include" in `IMPLEMENTATION_NOTES.md`.

## Deal outcomes are driven by pipeline stage, not set directly

`Deal.outcome`/`wonAt`/`lostAt`/`lostReasonId` can only change as a side
effect of moving a deal onto a different `PipelineStage` (see
`src/services/dealService.ts#resolveOutcomeFields`): a stage flagged
`isWon` records WON, a stage flagged `isLost` requires a `lostReasonId` and
records LOST, and any other stage reopens the deal. The API/service layer
never accepts `outcome` as a raw client-supplied field, so a deal can't be
marked won or lost without actually moving it through a won/lost-flagged
stage — the stage is the single source of truth, avoiding two
independently-settable fields (a status flag and a stage) going out of
sync.

## Deal value visibility

FIG-297 Q56 ("Sales cannot see cost/margin figures") and Q57 ("deal values
are Management + Finance only") are reconciled the same way FIG-438 does:
the owner of a deal can always see the value they themselves quoted
(`deals.view.own`/`deals.edit.own`), but seeing another member's deal value
requires the dedicated `deals.view.value` permission. A caller with
`deals.view.all` but not `deals.view.value` (Delivery, in the FIG-438 seed)
still sees every deal, just with `value` masked to `null` and a
`valueMasked: true` flag on the response rather than the record being
withheld outright.

## Activities and Tasks share one ownership check

Both link to an arbitrary subset of Company/Contact/Lead/Deal, and both
have their own flat permission (`activities.*`/`tasks.*`) that says
nothing about *which* records the caller may touch. Rather than inventing
a parallel ownership model for each,
`src/services/recordAccess.ts#assertCanAccessLinkedRecords` reuses each
parent's own service-layer view check (`companyService.getCompany`,
`leadService.getLead`, etc.) — the same place lead/deal ownership scoping
already lives — so a Sales rep can't read or write an activity/task
against a colleague's lead just because they hold the flat permission.
Tasks have no dedicated `tasks.edit` permission in the FIG-437 catalog
(only create/assign/view); a task may be updated by its assignee, its
creator, or anyone holding `tasks.assign.any` — see
`src/services/taskService.ts#canManageTask` for the reasoning.

## Dev login (not real authentication)

`src/auth/devSession.ts` is a signed-cookie placeholder with **no password
check** — it exists only so FIG-439's permission/ownership logic can be
exercised through real HTTP requests and real screens before FIG-437's
actual auth provider (OAuth/SSO/etc., still an open decision) is chosen and
built. Visit `/dev-login`, pick a seeded user, done. It must be replaced
wholesale, not extended, when real auth lands — nothing downstream depends
on its internals, only on the `userId: string | null` it produces
(`getCurrentUserId()` / `resolveRequestContext()` in
`src/auth/requestContext.ts`).
