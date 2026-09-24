# FIG-438 Implementation Notes

Decisions made while turning FIG-436/437/299/300/297 into a running schema,
per FIG-438 section 19 ("If a genuinely unresolved technical decision is
discovered ... document the decision ... and continue"). None of these
reopen the Organization = Tenant / User ≠ Membership / RBAC baseline —
they resolve things those documents left open.

## Stack choice

No code existed before this issue, and FIG-436 section 24 / FIG-437 section
18 explicitly leave "exact database engine and ORM" and "exact hosting"
open. Chosen: **TypeScript + PostgreSQL + Prisma**. Rationale: the original
CRM research document's own "Build a Custom CRM" option names
"React/Next.js, Node.js ..., PostgreSQL, REST APIs" as the illustrative
stack, and FIG-299/437 both mention "Prisma schema" and "Supabase" by name
as things this document is *not yet* (implying they were already on the
table). Supabase's local dev stack (Postgres + RLS + GoTrue) was also found
already running locally for other FigBloom projects on this machine,
reinforcing that Postgres + RLS is the org's established pattern. A plain
Postgres + Prisma setup was used rather than the full Supabase CLI/stack to
keep FIG-438 focused on the data model itself; the RLS approach used here
(session-variable-based policies) is portable to a managed Supabase
Postgres later with no schema changes.

## Tenant-safety mechanism: composite FKs + RLS, not one or the other

FIG-438 section 7 suggests several mechanisms ("composite foreign keys ...
database policies/RLS ... or equivalent"). Both were implemented rather
than choosing one:

- **Composite FKs** (`(organization_id, parent_id) -> parent(organization_id, id)`)
  are the primary, always-on guarantee: they protect every role, including
  migrations/seeds/admin tooling, and require no session state.
- **RLS** is the defense-in-depth layer for the actual application
  connection, per FIG-437 section 16 ("Defense in Depth: Application
  authorization should be complemented by database controls where
  supported"). It only takes effect for the non-owner `figbloom_app` role
  (see README "Why there are two Postgres roles").

Single-column FKs (Company -> Organization, etc.) are expressed directly in
`prisma/schema.prisma`; the composite tenant-integrity FKs, CHECK
constraints, and RLS policies are hand-written raw SQL in
`prisma/migrations/20260924081100_tenant_integrity_and_rls/migration.sql`,
because Prisma's schema language cannot express a composite relation where
one of the two key fields (`organizationId`) is required while the other
(e.g. `companyId`) is optional — see the comment at the top of that
migration file for the full reasoning.

## App-role credential handling

FIG-437 section 6 / FIG-438 section 17 require that credentials never live
in source control. The `figbloom_app` role's password is never written into
a migration; `npm run db:bootstrap-role` (`scripts/db-admin.ts`) creates or
updates it from the `APP_DB_PASSWORD` environment variable at
provisioning time. The migration only grants privileges to the role *by
name*, defensively (`IF EXISTS`), so schema migrations remain independent
of whether the role has been bootstrapped yet in a given environment.

## Roles are global, not organization-configurable

FIG-436 section 8's configuration table lists pipeline stages, lead
sources, services, lost reasons, lifecycle states, and assignment rules as
*organization-configurable business data*, but lists RBAC itself as an
*application/security rule* in the same table. `Role` is therefore a global
catalog (5 fixed V1 rows), not per-organization data — consistent with
"Do not invent additional business roles" (FIG-438 section 2).

## Permission matrix is provisional

FIG-437 section 18 explicitly lists "Final permission matrix" as an open
decision pending confirmation by Michael/the project lead. `prisma/seedData.ts`
seeds a 46-permission catalog and a role→permission mapping that is the
smallest reasonable reading of FIG-437 section 9 combined with FIG-297 Q56 —
not an approved matrix. One explicit reconciliation was needed: FIG-297 Q56
says Sales "cannot see cost or margin figures" while Q57 says "deal values
... Management + Finance only." FIG-299 does not model margin/cost as CRM
fields at all, so the resolution taken is that Sales gets `deals.view.own` /
`deals.edit.own` (they view/edit the value on deals they own, since they're
the ones quoting it) but not `deals.view.value` (organization-wide
value visibility, used for aggregate reporting) — see the comment block at
the top of `prisma/seedData.ts`.

## Customer Lifecycle State lives on Company, not a new `customers` table

FIG-438 section 4 explicitly forbids a duplicate generic `customers` entity.
`CustomerLifecycleState` is a controlled value referenced by
`Company.lifecycleStateId` — Company remains the single canonical account
identity, consistent with FIG-299 section 7 and the V1 B2B model FIG-297
describes (FigBloom mostly sells to organizations).

## Deal Pipeline Stage seed values split from Lead Status at the qualification boundary

FIG-299 section 6 gives one combined chain: *Lead → Qualified Lead →
Contacted → Needs Identified → Solution Presented → Proposal → Negotiation
→ Closed/Won*. FIG-438's canonical model (section 4) requires Lead Status
and Deal Pipeline Stage to be two separate catalogs (AC3), so this chain had
to be split somewhere. The split point used: everything through
"Needs Identified" became `LeadStatus` values (matching FIG-299 section
5.2's own explicit Lead Status list, which already includes "Needs
Identified"); everything from "Solution Presented" onward became
`PipelineStage` values, since a Lead only converts to a Deal once qualified.
Seeded stages: Solution Presented → Proposal Sent → Negotiation → Closed
Won / Closed Lost.

## Lead Temperature is a native enum, not a controlled-value table

Unlike Lead Source/Status, Pipeline Stage, Lifecycle State, and Lost
Reason — which are all organization-configurable per FIG-436 section 8 —
Lead Temperature is fixed at exactly HOT/WARM/COLD in every source document
(FIG-297 Q14, FIG-299 section 5.1) with no suggestion of per-organization
customization, so it is a Postgres/Prisma enum rather than a table.

## Activities/Communications require a linked record; Tasks do not

FIG-438 section 10 describes Activities and Communications as
relationship-timeline entries, and FIG-299 lists their "related" fields
without marking any as mandatory. The judgment call made: an Activity or
Communication with no Company/Contact/Lead/Deal is meaningless (nothing to
show a timeline for), so both have a CHECK constraint requiring at least
one; a Task is allowed to stand alone (e.g. a personal reminder with no
linked CRM record yet), so it has no such constraint.

## Deal outcome consistency is a CHECK constraint, Lead status is not

`deals_outcome_consistency_chk` requires `wonAt` when `outcome = WON`, and
both `lostAt` and `lostReasonId` when `outcome = LOST` (FIG-297 section 7,
"Are reasons for lost deals recorded?"). This is safe to express as a fixed
Postgres CHECK because `DealOutcome` is a small native enum. No equivalent
constraint was added for a lead being "Lost", because `LeadStatus` is
organization-configurable data (FIG-436 section 8) — a CHECK hard-coding a
specific status key (e.g. `'LOST'`) would silently stop working the moment
an organization renames or reconfigures that status, which is exactly the
kind of hard-coded business rule FIG-438 section 6 warns against.

## Lead→Deal conversion: what FIG-438 implements vs. defers to FIG-440

`src/repositories/leads.ts#convertLeadToDeal` is a real, tested
implementation of the *data-model* guarantees FIG-436 section 12 requires
(application-level workflow, not a bare status flip; carries owner/service/
notes context forward; applies a configured initial stage; duplicate
conversion prevented via the `(organizationId, leadId)` unique constraint on
Deal). It deliberately does **not** implement company/contact resolution
for a Lead that has no `companyId` yet (it throws
`LeadMissingCompanyError` instead) — FIG-436 section 26 assigns "deal,
pipeline, ownership, and lead-conversion architecture" business rules to
FIG-440, and inventing that resolution logic here would be exactly the kind
of speculative, ahead-of-scope implementation FIG-438 section 3 warns
against ("Do not create unnecessary speculative entities").

## Repository layer scope

FIG-438's deliverable is the database model and migrations, not a complete
service layer. `src/repositories/*` covers organizations, memberships/
authorization resolution, companies, leads (incl. conversion), and audit
events — enough to exercise and test every acceptance criterion (RLS,
composite FKs, permission boundaries) end-to-end through real code, not
just raw SQL. Contacts, deals (beyond conversion), activities, tasks,
communications, and proposal references have full schema/constraint
coverage and are exercised directly via Prisma in the test suite, but don't
yet have their own repository modules — those follow the exact same
`withOrgContext` pattern and are FIG-439+ scope.

## Migration "rollback"

Prisma Migrate is a roll-forward tool; it does not generate reversible
down-migrations by default. FIG-438 section 16 asks for "rollback/down
migration works where supported" — the implementation decision is to treat
this as "provision a fresh database and re-run `prisma migrate deploy` from
migration 1" (Prisma's own documented recovery pattern) rather than
hand-authoring bespoke `down.sql` for two migrations. `tests/migrations.test.ts`
verifies the roll-forward path (clean apply, in order, safe to re-deploy);
see its docstring for the full reasoning.

## Seed users are internal dev fixtures, not customer data

`prisma/seed.ts` creates five `dev.<role>@figbloom.local` users (one per V1
role) purely so a developer has something to log in as once auth exists.
FIG-438 section 15's warning against "fake business data that could be
mistaken for real customer data" is about fabricated Companies/Contacts/
Leads/Deals — this seed deliberately creates none of those.
