# FigBloom CRM

Core CRM data model and database foundation for FigBloom Digital Group
(Linear **FIG-438**), implementing the architecture and access-control
baseline from **FIG-436** (V1 Architecture & Tenant Model) and **FIG-437**
(Authentication, Organizations, Roles & Tenant Isolation), scoped by
**FIG-300** (MVP Scope) and **FIG-299** (Core CRM Data Model).

See `documents/` for the full planning trail (research, stakeholder
requirements, MVP scope, data model, architecture) and
`IMPLEMENTATION_NOTES.md` for the specific decisions made while turning
those documents into a running schema.

## Stack

- **Node.js + TypeScript**
- **PostgreSQL** with **Prisma** (schema + migrations + client)
- **Row-level security (RLS)** as a database-enforced, defense-in-depth
  tenant boundary, on top of application-level `organizationId` scoping
- **Vitest** for the automated test suite (migrations, seed data,
  relationships, tenant isolation, authorization foundation)

This is a database/data-access foundation only — there is no HTTP API or UI
yet. Those are FIG-439 and later.

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

Other scripts: `npm run typecheck`, `npm run lint`, `npm run format`,
`npm run migrate:dev` (interactive, for authoring new migrations),
`npm run migrate:deploy` (non-interactive, for CI/deploys).

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

## Repository layer

`src/repositories/*` contains a representative (not exhaustive) slice of
data-access functions — organizations, memberships/authorization
resolution, companies, leads (including the lead→deal conversion
workflow), and audit events — demonstrating the patterns FIG-439/440/441
should extend for the remaining entities (contacts, deals detail,
activities, tasks, communications, proposal references).
