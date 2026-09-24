# FIG-438 / FIG-439 Implementation Notes

Decisions made while turning FIG-436/437/299/300/297 into a running
application, per FIG-438 section 19 ("If a genuinely unresolved technical
decision is discovered ... document the decision ... and continue"). None
of these reopen the Organization = Tenant / User ≠ Membership / RBAC
baseline — they resolve things those documents left open.

The FIG-438 notes are below; FIG-439 notes are at the end of this file.

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

---

# FIG-439 Implementation Notes

FIG-439 ("Build the core screens and APIs to create, view, update, search,
and assign leads, contacts, and companies") required a decision FIG-436
had explicitly left open: "exact frontend/backend structure." Asked
directly, the answer was: build the real service/API layer *and* a real
(if minimal) UI now, rather than deferring the UI to a separate framework
decision. Chosen stack: **Next.js (App Router) + React**, added to the
existing TypeScript/Prisma project rather than a separate app/repo — it
reuses `src/db`, `src/repositories`, and `src/services` directly, and
matches the original CRM research document's own illustrative stack
("React/Next.js, Node.js").

## Service layer sits between repositories and routes/pages

FIG-436 section 10 describes an explicit Application/API Boundary
(Client -> Auth context -> API/Application service -> Org+permission
check -> Validation/business rules -> Data access -> Response). FIG-438
only had repositories (data access). FIG-439 adds `src/services/*`
specifically to be that boundary: every service function takes an
`AuthContext` and calls `requirePermission` / `requireOwnedRecordPermission`
(`src/auth/context.ts`) before calling a repository. Route handlers
(`src/app/api/**/route.ts`) and pages (`src/app/**/page.tsx`) call
services only — see README.md "Application layers."

## No real authentication exists yet, so a placeholder was built

FIG-437 section 18 explicitly defers "exact authentication provider" and
"session/token strategy" to a separate, not-yet-scheduled decision. Without
*something*, none of FIG-439's permission/ownership logic (leads.view.own,
leads.assign, etc.) could be exercised through actual HTTP requests or
screens. `src/auth/devSession.ts` is a signed cookie holding a userId, set
by picking a seeded dev user at `/dev-login` with **no password check at
all**. It is explicitly documented (in the file itself, and in README.md)
as not being the FIG-437 deliverable, and is designed to be replaced
wholesale rather than extended: every downstream consumer depends only on
`getCurrentUserId(): string | null`, never on how that value was produced.

## NotFoundError vs ForbiddenError: existence is not a secret within an organization

The first version of `leadService.getLead` masked "exists, but you don't
own it and lack leads.view.all" as a 404, on a "don't confirm a record
exists to someone unauthorized" instinct — but `updateLead` (via
`requireOwnedRecordPermission`) already threw 403 for the identical
situation, an inconsistency the test suite caught immediately (a test
expecting 404 got 403). Decided in favor of the simpler, more conventional
rule, applied uniformly across every lead-service function: **404 means
the record does not exist in the caller's organization at all** (wrong id,
or a different tenant); **403 means it exists but the caller's role or
ownership does not permit the action.** Existence-masking within one
organization's own CRM isn't a meaningful security boundary here — every
colleague already knows leads exist; `leads.view.own` is about workload
segregation, not secrecy.

## Duplicate detection warns; it never blocks

FIG-438 section 9 already established that company names, and contact
emails/phones, may legitimately repeat. FIG-439 extends this into an
explicit pattern used identically for Companies, Contacts, and Leads:
`create*` service functions always run a `findPossibleDuplicate*` query
alongside the actual create and return `{ record, possibleDuplicates }`;
the API/UI surfaces `possibleDuplicates` as a warning banner, but the
create always succeeds. There is no separate "check before submit" step
required in the UI, though a dedicated `check-duplicates` endpoint exists
for API consumers who want to warn before committing.

## Lead ownership defaults, and `leads.assign` is a distinct permission from edit

A newly created lead defaults `ownerMembershipId` to its creator unless the
creator has `leads.assign` and explicitly names someone else
(`leadService.createLead`). Reassigning an *existing* lead's owner is
gated by `leads.assign` specifically — not `leads.edit.own`/`leads.edit.all`
— matching the FIG-438 seed (Management has `leads.assign`; Sales does
not) and directly implementing FIG-439's "Leads can be assigned and
reassigned according to permissions."

## What FIG-439 explicitly does not include

- **Lead-to-deal conversion UI.** The underlying `convertLeadToDeal`
  function already exists (built in FIG-438 to exercise the data model);
  FIG-436 section 26 assigns the actual deal/pipeline/conversion
  *workflow* to FIG-440, so no "Convert to Deal" button was added to the
  lead detail page — adding one now would be scope creep across ticket
  boundaries.
- **Company/contact resolution for an unlinked lead.** Same reasoning:
  `convertLeadToDeal` still requires a lead to already have a `companyId`;
  inventing "create a company from this lead's contact" logic is FIG-440's
  job, not FIG-439's.
- **A hidden nav for permissions the role lacks** was added as a UX
  nicety (`src/app/o/[orgSlug]/layout.tsx`), but every page still enforces
  its own check server-side regardless of what the nav shows (FIG-437
  section 10: UI hiding is not a security boundary) — confirmed by visiting
  each restricted page directly by URL, not just by clicking through nav.

## Bugs found only by actually running the app, not by the unit-test suite

The automated test suite (62 tests, all passing) exercises the service
layer directly with valid, well-formed inputs and mocked-out ownership
scenarios. Running the real app end-to-end (dev server + a scripted
walkthrough logging in as all five seeded roles, exercising create/list/
assign/reassign through the actual HTTP routes and pages) surfaced three
defects the unit tests had not covered, all now fixed with regression
tests added:

1. **Dashboard, and separately the Leads list page, crashed with a 500**
   for Delivery, Finance, and Restricted Technical — none of those three
   roles have *any* `leads.view.*` permission (correctly, per FIG-297 Q56:
   "Finance ... Cannot browse open pipeline or unqualified leads"), and
   `listLeads()` fails closed by throwing `ForbiddenError` rather than
   returning `[]`. Both pages assumed every role could at least call it.
   Fixed by gating the call behind a `canViewLeads` check, same pattern
   already used for Contacts/Companies on those pages.
2. **Lead, Company, and Contact detail pages** had the same unguarded-call
   problem for their respective `get*` service calls — visiting one
   directly by URL as a role without view rights, or a Sales user visiting
   a lead they don't own, crashed with a 500 instead of showing a
   permission-denied message. Fixed with the same try/catch pattern,
   using `notFound()` for genuine `NotFoundError` and an inline message for
   `ForbiddenError`.
3. **`assignLead` silently no-op'd on a missing/empty target id** instead
   of rejecting the request. Prisma treats an `undefined` value in a
   `where` filter as "omit this condition" and in a `data` update as
   "leave this field unchanged" — both correct behaviors for intentionally
   partial input, but wrong here, where the caller must always supply a
   real id. A malformed assign request (e.g. a client bug resolving the
   target membership id) would have silently left ownership unchanged
   while returning a 200. Fixed by validating the id is a non-empty string
   before it reaches either Prisma call; added a regression test
   (`tests/leadService.test.ts`, "rejects assigning a lead with a missing
   ownerMembershipId") that an earlier version of the suite did not have,
   since every existing test happened to always pass a real,
   well-formed-but-possibly-wrong id, never a missing one.

This is the concrete justification for FIG-438/439 section 21's "Actually
execute the available checks... do not simply report that something
'should work'": a fully green unit-test suite plus a clean `tsc`/`next
build` had already been reached before any of these three bugs were
found, purely because none of the unit tests happened to construct these
specific "well-typed but semantically incomplete" inputs (a role with zero
lead permissions viewing any lead-bearing page at all; a missing rather
than merely-wrong owner id). The manual end-to-end pass is not a formality
on top of the automated suite — it found real, user-facing defects the
automated suite had a coverage gap for, and each one became a permanent
regression test afterward.
