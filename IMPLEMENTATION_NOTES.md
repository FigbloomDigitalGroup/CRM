# FIG-438 / FIG-439 Implementation Notes

Decisions made while turning FIG-436/437/299/300/297 into a running
application, per FIG-438 section 19 ("If a genuinely unresolved technical
decision is discovered ... document the decision ... and continue"). None
of these reopen the Organization = Tenant / User ≠ Membership / RBAC
baseline — they resolve things those documents left open.

The FIG-438 notes are below; FIG-439, FIG-440, FIG-441, and FIG-443 notes
follow, in order (FIG-442 was deferred — see the end of this file).

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

---

# FIG-440 Implementation Notes

FIG-440 ("Build deals, pipeline stages, and lead conversion") builds
directly on schema/permissions FIG-438 already seeded in anticipation of
it (`Deal`, `PipelineStage`, `LostReason`, the `deals.*`/`leads.convert`
permission catalog) — this ticket is almost entirely service/API/UI work,
following FIG-439's exact layering (`src/repositories/*` ->
`src/services/*` -> `src/app/api/**` / `src/app/**`).

## `convertLeadToDeal` moved from the Lead repository to the Deal repository

FIG-438 had put a minimal, representative `convertLeadToDeal` in
`src/repositories/leads.ts` (documented there as intentionally
incomplete — see the FIG-438 note above, "Lead→Deal conversion: what
FIG-438 implements vs. defers to FIG-440"). It now lives in
`src/repositories/deals.ts` instead: it *creates a Deal*, so the Deal
repository is its home even though it starts from a Lead id — this also
puts it next to `createDeal`, which deliberately has **no** `leadId`
parameter, so linking a Deal to its originating Lead (and stamping that
Lead's `convertedAt`) can only ever happen through this one function,
never as a side door via a bare `POST /deals { leadId }`.

## Company resolution for a lead converted with no company

FIG-438 explicitly deferred this ("inventing that resolution logic here
would be exactly the kind of speculative, ahead-of-scope implementation
FIG-438 section 3 warns against"). The FIG-440 resolution taken is
deliberately the smallest reasonable one, not a "create a company inline
from the lead's contact details" subsystem: `convertLeadToDeal` now
accepts an optional `companyId` override, used only when the lead has
none; `leadService.convertLead` requires the caller to supply one in that
case (via a company picker in the UI, `ConvertLeadControl.tsx`) or the
conversion is rejected with a `ValidationError`. Creating a *new* company
as part of conversion is not implemented — the caller must pick an
existing one first (e.g. via the Companies screen), which is consistent
with FIG-438's "duplicate company detection warns, never auto-creates."

## Deal outcome is derived from pipeline stage, not an independently-settable field

`Deal.outcome`/`wonAt`/`lostAt`/`lostReasonId` exist as real columns (with
a DB-level CHECK constraint from FIG-438: `deals_outcome_consistency_chk`),
but the FIG-440 service layer treats the *pipeline stage* as the single
source of truth for all four: moving a deal onto a stage flagged `isWon`
records WON, onto a stage flagged `isLost` requires a `lostReasonId` and
records LOST, and onto any other stage reopens it
(`dealService.ts#resolveOutcomeFields`). `updateDeal`'s client-facing input
type has no `outcome`/`wonAt`/`lostAt` fields at all, and `lostReasonId` is
only ever written as a value the outcome resolver computed — never a
direct pass-through of request body — so a client cannot PATCH a deal
straight to `{ outcome: "WON" }` without actually moving it through a
won-flagged stage. This was a deliberate design choice over letting the
UI set stage and outcome as two independent fields, which would let them
drift out of sync (a real risk the DB CHECK constraint alone doesn't fully
prevent, since it only enforces "LOST implies lostAt + lostReasonId," not
"outcome matches the current stage's isWon/isLost flags").

## Deal value masking reuses ownership, doesn't invent a new permission

FIG-438's `prisma/seedData.ts` comment already reconciles FIG-297 Q56/Q57
(Sales can see the value on deals they quote, but org-wide value
visibility needs `deals.view.value`). FIG-440 implements that exactly:
`dealService.ts#maskValue` returns the record with `value: null` and a
`valueMasked: true` flag whenever the caller lacks `deals.view.value` and
doesn't own the deal — applied uniformly to `getDeal`, `listDeals`,
`createDeal`, and `updateDeal`'s return values. The record itself is never
withheld (Delivery, which has `deals.view.all` but not `deals.view.value`,
still sees the deal exists, who owns it, its stage, and its expected close
date — just not the number), consistent with FIG-439's "existence isn't a
secret between colleagues" convention for `NotFoundError`/`ForbiddenError`.

## Proposal References: a minimal slice, on purpose

FIG-438 section 11 explicitly scoped `ProposalReference` as "reference
only," not a proposal-generation subsystem. FIG-440's AC lists "proposal
status" as one of a deal's tracked attributes, so a minimal
create/list/status-update slice was added
(`src/services/proposalService.ts`, nested under a deal:
`/api/orgs/[orgSlug]/deals/[dealId]/proposals`) rather than either
skipping it entirely or building document generation/e-signature/etc.
There's no `proposals.view.own`/`proposals.view.all` split in the FIG-437
permission catalog (just `proposals.view`/`proposals.manage`), so instead
of inventing a new permission dimension, proposal access reuses the
parent Deal's own/all ownership gate (`deals.view.*`/`deals.edit.*`) in
addition to the proposal permission itself — otherwise a Sales rep with
`proposals.manage` could read or write proposals on a colleague's deal by
guessing its id, which the Deal-level ownership check already exists to
prevent.

## What FIG-440 explicitly does not include

- **Company/contact creation during conversion.** See "Company resolution"
  above — an existing company must be picked, none is created inline.
- **Configurable pipeline stages via a settings UI.** The AC's "Pipeline
  stages are configurable per organization" is satisfied by the existing
  FIG-438 data model (`PipelineStage` is already per-organization, seeded
  per org, and gated behind `configuration.manage`) and surfaced read-only
  via `getFormReferenceData`; a dedicated stage-management screen (add/
  reorder/rename stages) was not built, as no FIG-440 AC calls for one and
  it would be speculative UI ahead of an actual settings-area ticket.
- **Full proposal generation/e-signature/document flow.** See "Proposal
  References" above.

## Manual end-to-end verification

Same approach as FIG-439 (dev server + a scripted HTTP walkthrough logging
in as all five seeded roles plus a second ad-hoc Sales user, driving every
route directly, not just the service layer): lead-to-deal conversion
(including the missing-company and already-converted rejection paths),
direct deal creation, ownership scoping between two Sales peers, deal
value masking for Delivery vs. Finance vs. the owner, won/lost pipeline
stage transitions (including the missing-lost-reason rejection and
reopening a closed deal), an outcome-bypass attempt via a raw PATCH, and
proposal reference create/status-update with the same ownership gate —
36 checks, all passing, plus targeted follow-up checks for page-level
rendering (dashboard, pipeline board, deal detail) across every role and a
nonexistent-deal-id 404. Unlike FIG-439, this pass did not surface any new
defects — the FIG-439 bug pattern (unguarded service calls crashing pages
for roles with no view permission) was already anticipated and guarded
for every new page from the start, having just been fixed three times over
in the previous ticket.

---

# FIG-441 Implementation Notes

FIG-441 ("Build activities, follow-up tasks, reminders, and audit history")
is the last of the FIG-436-through-FIG-441 chain before FIG-443
(dashboards/reporting), which depends on it. Like FIG-440, the schema
(`Activity`, `Task`, `Communication`, `AuditEvent`) and permission catalog
(`activities.*`, `tasks.*`, `audit.view`) already existed from FIG-438 —
this ticket is service/API/UI work plus, notably, actually *wiring up*
`recordAuditEvent`, which FIG-438 built but never called from anywhere.

## Activities and Tasks reuse the parent record's own view check, not a new permission

Both `activities.view`/`activities.create` and `tasks.view.own`/`.all` are
flat permissions in the FIG-437 catalog — they say nothing about *which*
Company/Contact/Lead/Deal the caller may attach an activity or task to.
Left unchecked, a Sales rep holding the flat `activities.create` could log
(and read back) an activity against a colleague's lead they have no
`leads.view.*` access to at all, purely by knowing its id — a real
authorization gap, not a hypothetical one, since `leads.view.own` exists
specifically to prevent that colleague from seeing the lead itself.
`src/services/recordAccess.ts#assertCanAccessLinkedRecords` closes this by
calling each parent's own service-layer view function
(`companyService.getCompany`, `contactService.getContact`,
`leadService.getLead`, `dealService.getDeal`) for every linked id before
the activity/task permission check runs — reusing the ownership scoping
that already exists there rather than inventing
`activities.view.own`/`.all` and `tasks.view.own`/`.all`-per-parent-type
permissions the catalog doesn't have. This is also why Delivery (no lead
permissions at all, but `deals.view.all`) can log a "handoff meeting"
activity against a Deal but not against a Lead — exactly the persona
boundary FIG-297 describes.

## Tasks have no `tasks.edit` permission — a judgment call, documented

The FIG-437 catalog defines `tasks.create`, `tasks.assign.own`,
`tasks.assign.any`, `tasks.view.own`, `tasks.view.all` — no edit/complete
permission at all. Per the "permission matrix is provisional" note above,
the judgment call made in `taskService.ts#canManageTask`: a task may be
updated (status changed, marked complete, edited) by its assignee, its
creator, or anyone holding `tasks.assign.any` (the same "can touch
anyone's tasks" breadth Management already has for assignment) — but
only after the caller passes the ordinary view check first. Reassigning
an *existing* task to someone else additionally requires
`tasks.assign.any` specifically, mirroring `leads.assign`'s separation
from edit; a caller with only `tasks.assign.own` can create a task
assigned to themselves but can never hand it to someone else.

## Task `completedAt`, like Deal `outcome`, is derived from status — never client-set directly

Same discipline as `dealService.ts#resolveOutcomeFields`
(FIG-440): `updateTask`'s service-facing input has a `status` field, and
`completedAt` is computed from it (`new Date()` when status becomes
`COMPLETED`, `null` for any other status) rather than accepted as a raw
value from the request body. Reopening a completed task (moving it back
to `IN_PROGRESS`) clears `completedAt` the same way reopening a deal
clears `wonAt`/`lostAt`.

## "Reminders" is the existing derived-overdue mechanism, not a new notification system

The ticket title mentions "reminders," but no FIG-299/FIG-436 source
document describes an actual notification/email/push delivery mechanism,
and no AC bullet asks for one — the AC instead says "due and overdue
follow-ups are visible to assignees and authorized managers," which
FIG-438's `Task.dueAt` + FIG-436 section 13's derived-overdue-state design
already covers by construction. Building an actual reminder-delivery
system (email/push notifications on a schedule) was treated as out of
scope: it would require a background job/scheduler and a notification
channel that no other part of this codebase has, and no document
describes wanting one for V1. "Reminders" is implemented as: overdue is
computed at query time (`repositories/tasks.ts#listTasks`'s `overdueOnly`
filter: `dueAt` in the past AND status still `PENDING`/`IN_PROGRESS`),
visible on the dashboard (an "N overdue task(s)" count linking to a
pre-filtered Tasks list) and on the standalone Tasks page's filter.

## Audit events: wiring up a table FIG-438 built but nothing called

`recordAuditEvent` existed since FIG-438 (append-only at the DB level —
`figbloom_app` has UPDATE/DELETE revoked on `audit_events`) but was never
invoked outside its own repository file or a test. FIG-441 wires it into
the mutations that are actually reachable through the app today and
plausibly "important" per the AC: `leadService.assignLead` (ownership
reassignment), `dealService.updateDeal` (only when a pipeline-stage
transition actually changes the outcome — not on every unrelated field
edit), and `companyService.updateCompany`/`contactService.updateContact`
(only when `ownerMembershipId` is present in the input and differs from
the current value). The last two have no UI control that drives an owner
change yet (FIG-439 never built one), but the repository-level capability
already exists and is exercised by the test suite directly, so auditing
it now costs nothing and avoids a silent gap the moment a future ticket
adds that control. Audit history itself is read-only, gated by
`audit.view` (Management-only in the FIG-438 seed), and surfaced on Lead
and Deal detail pages — not Company/Contact, since those have no
UI-reachable owner-change control yet either.

## Company and Deal get a real timeline; Lead gets one too; Contact does not

FIG-441's AC explicitly says "Customer and deal timelines show activities
in chronological order" — "Customer" per FIG-299/FIG-438 is Company
("Company remains the canonical account identity"), so the Company and
Deal detail pages both get `ActivityTimeline`. The Lead detail page also
gets one, even though the AC doesn't name Lead specifically: logging a
call or note against a lead being worked is one of the single most common
"log calls, meetings, emails, WhatsApp summaries, and notes" (AC1)
workflows in a sales process, and withholding it from the one screen
where that logging would actually happen during qualification would be a
strange, arbitrary gap. Contact does not get one — Contact is already the
secondary entity in this data model (per the FIG-438 note "Company remains
the canonical account identity"), and no AC bullet or source document
calls for a contact-level timeline; adding one would be scope creep with
no requirement behind it.

## What FIG-441 explicitly does not include

- **Communications.** The schema/permission catalog (`communications.view`/
  `communications.create`) already exists from FIG-438, but no FIG-441 AC
  bullet requires a separate channel-specific logging feature distinct
  from Activity — AC1's "log calls, meetings, emails, WhatsApp summaries,
  and notes" maps exactly onto `ActivityType`'s existing enum values
  (CALL/MEETING/EMAIL/WHATSAPP/NOTE/OTHER). Building a full parallel
  Communication CRUD+UI on top of that, with no AC asking for it, would be
  exactly the kind of unrequested feature addition FIG-438's own
  section 3 warns against. It remains schema/permission-ready for a
  future ticket if the team decides channel-specific (inbound/outbound)
  logging distinct from the Activity timeline is actually needed.
- **A real reminder-delivery mechanism.** See "'Reminders' is the existing
  derived-overdue mechanism" above.
- **Task/Activity sections on the Company or Contact detail pages** (Tasks)
  and **on the Contact detail page** (Activities). See the two notes above.
- **Audit history on Company/Contact detail pages.** See "Audit events"
  above — no UI-reachable mutation to audit there yet.

## Manual end-to-end verification

Same approach as FIG-439/440: dev server + an HTTP walkthrough script
logging in as all five seeded roles plus a second Sales user, driving
routes directly. Covered: activity creation rejected with no linked
record; chronological ordering; ownership-scoped read/write on a lead
(Sales2 blocked from a colleague's deal timeline); Delivery logging
against a deal it can view but not edit; Finance blocked from Activities
entirely; task creation with assignee defaulting/overridden per
`tasks.assign.own` vs `.any`; a non-assignee/non-creator colleague blocked
from completing someone else's task; the overdue filter; audit history
recording and retrieval, gated correctly by `audit.view`; and page
rendering (Tasks page, Deal/Company detail pages showing their new
sections) across every role with no crashes. 33/33 checks passed, plus
targeted follow-ups (dashboard overdue count, lead detail sections,
nonexistent-task 404) with no defects found.

---

# FIG-443 Implementation Notes

FIG-443 ("Build role-specific CRM dashboards and reporting") is almost
entirely aggregation and UI on top of what FIG-439/440/441 already built:
Leads/Deals/Tasks already have full service-layer own/all permission
scoping and (for deals) value masking, so "your actionable work" reuses
those services directly rather than re-deriving their authorization
logic. The genuinely new piece is `src/repositories/reporting.ts`'s
Prisma `groupBy`/`aggregate` queries for the six Management-facing
metrics the AC names.

## FIG-442 was deferred, not skipped

Sequencing so far had been strictly following the "blocks/blockedBy"
chain narrated in each report (FIG-439 -> FIG-440 -> FIG-441), which gave
the impression FIG-442 was next. It isn't, dependency-wise: FIG-442 only
`blockedBy`s FIG-436/437/439 (already done) and nothing else in the chain
depends on it. It was raised, and explicitly deferred by request, because
it's a different kind of ticket from every one built so far: a
public-facing, unauthenticated endpoint (a website contact form has no
CRM session), whereas every route built through FIG-441 assumes a
resolved org membership. That's a real design decision (API key? signed
webhook? something else?) which shouldn't be made silently on a
placeholder basis the way `dev-login` was for FIG-439 -- see the note at
the end of this file for what's still open there.

## "My work" is reuse, not new authorization logic

`reportingService.ts#getMyActionableWork` calls
`leadService.listLeads`/`dealService.listDeals`/`taskService.listTasks`
directly with new filter parameters (`createdAfter`, `stalledOnly`,
`dueAfter`/`dueBefore` -- added to their respective repositories this
ticket) rather than querying Prisma directly. This means the dashboard
automatically inherits every permission/ownership rule already tested in
FIG-439/440/441 (Sales sees only their own; Delivery has no lead access
at all; deal values stay masked for non-owners without
`deals.view.value`) instead of a second, parallel implementation of the
same rules that could drift out of sync. Each call is wrapped in
`ignoreForbidden()` so a role missing the underlying permission (Finance
has no `tasks.*`/`leads.*` at all) gets an empty section instead of a
500 for the whole dashboard.

## "Stalled deal" and "due today" are judgment calls, documented

Neither FIG-297 nor FIG-436 defines these precisely. Chosen definitions
(both are one-line, easily revisited if Michael/the team wants
different ones):

- **Stalled deal**: open (`outcome = OPEN`) and past its
  `expectedCloseDate`. An alternative considered was "no activity logged
  in N days," but that requires an arbitrary N and a join against
  Activity that adds real query cost for a metric whose only source
  document mention is the bare AC phrase "stalled deals" -- the
  close-date definition is simpler, already has a field for it, and is
  directly actionable (the rep quoted a date and missed it).
- **Due today**: `dueAt` within the caller's server-side "today" (UTC
  calendar day) and status still `PENDING`/`IN_PROGRESS`. No timezone is
  modeled anywhere in this schema yet (FIG-437 section 18 territory), so
  this is the same simplification every other date-handling code in the
  app already makes.

## Metric definitions: date-range semantics differ by metric, and that's deliberate

AC5 ("metric definitions are documented") is satisfied both in-product
(a "Metric definitions" panel on the Reports page) and here, because two
of the six metrics are date-ranged by a *different* timestamp than the
other four, which isn't obvious from the metric name alone:

- **Lead volume by source** and **Conversion**: scoped by the lead's
  `createdAt` -- "how many leads came in, and from where, during this
  window."
- **Won/Lost deals** and **Sales by service**: scoped by `wonAt`/`lostAt`
  -- "how much did we close during this window," regardless of when the
  underlying deal was first created (a deal opened three months ago that
  closed yesterday counts as yesterday's win, not three-months-ago's).
- **Pipeline value by stage**: deliberately *not* date-ranged at all --
  it's a snapshot of currently-open deals, since "what's in the pipeline
  right now" isn't a historical question the way the other five are.
- **Follow-up performance**: scoped by the task's `dueAt` -- "how did we
  do against what was due in this window."
- Conversion rate itself is defined as: of the leads *created* in the
  window, what fraction have `convertedAt` set *as of today* (not
  gated on the conversion itself having happened inside the window) --
  otherwise a lead created on day 1 of a 30-day window and converted on
  day 45 would never count as converted in any report, which would
  understate conversion for every window that doesn't happen to be
  open-ended.
- No explicit range defaults to the **last 30 days** (`dateTo` defaults
  to now, `dateFrom` to 30 days before that).

## Deal-value masking extends from records to aggregates

FIG-440 already masks `value` to `null` on an individual Deal for a
viewer without `deals.view.value` (Delivery: `deals.view.all` but not
`.view.value`). Aggregates can't be masked the same granular way -- a sum
either reflects real numbers or it doesn't -- so
`reportingService.ts#getOrganizationMetrics` nulls out every value-bearing
aggregate (won value, pipeline-by-stage sums, sales-by-service sums)
outright when the caller lacks `deals.view.value`, returning counts
unmasked. No seeded role currently exercises this branch (`reporting.view.all`
and `deals.view.value` are both Management-only today), but it's written
permission-first rather than role-name-first on purpose, the same
discipline used throughout this codebase, and is covered by a test that
manually strips the permission from an otherwise-real context to prove
the branch works before any future permission-matrix change might expose it.

## Two real bugs found by the manual walkthrough, not the unit tests

1. **`dealService.createDeal` 500'd whenever `expectedCloseDate` was
   provided.** Prisma's client throws (rather than coercing) when a
   DateTime-typed field is given a plain `"YYYY-MM-DD"` string instead of
   a full ISO-8601 datetime or a `Date` object. `updateDeal` already
   converted this correctly (`new Date(input.expectedCloseDate)`);
   `createDeal` never did. This bug has been *live since FIG-440* --
   `CreateDealForm.tsx`'s expected-close-date field has always sent a
   plain date string from an `<input type="date">` -- and neither
   FIG-440's nor FIG-441's automated tests or manual walkthroughs
   happened to create a deal with that field set, so it went unnoticed
   for two tickets until FIG-443's "stalled deal" test scenario needed a
   deal with a past expected close date. Fixed by applying the exact
   same `new Date(...)` conversion `createDeal` was missing; regression
   test added (`tests/dealService.test.ts`, "accepts a plain
   'YYYY-MM-DD' expectedCloseDate string").
2. **`getSalesByService` silently ignored the `serviceId` filter.**
   The repository function groups results *by* `serviceId` but never
   included it in the `where` clause, so filtering the Reports page by a
   specific service still returned every service's won-deal totals
   lumped together (or, worse, attributed to whichever single row the
   filter happened to still match). Every other filtered aggregate in
   the same file (`getDealOutcomeSummary`, `getPipelineValueByStage`)
   does include it -- this was a one-line omission, not a design gap,
   caught by the walkthrough's "filter by a nonexistent serviceId should
   return empty results" check, which returned real unfiltered data
   instead. Fixed by adding the missing `serviceId: filters.serviceId`
   line; regression test added (`tests/reportingService.test.ts`,
   "filters salesByService by serviceId").

Both bugs are further confirmation of the pattern noted in the FIG-439
section above: a green unit-test suite and clean typecheck/build had
already been reached before either was found, purely because no existing
test happened to exercise "create a deal with this specific optional
field set" or "filter this specific aggregate by the field it's grouped
by."

## Manual end-to-end verification

Same approach as every prior ticket: dev server + an HTTP walkthrough
script logging in as all five seeded roles plus a second Sales user.
First pass found the two bugs above (24/28 checks passed, all 4 failures
diagnosed: 2 real bugs, 1 test artifact from the dev database's
accumulated leftover data across every prior manual-walkthrough session
in this same `figbloom` org, 1 false positive from asserting against a
substring that also appears in the page's own "Metric definitions"
glossary text). Second pass, after fixing both real bugs and correcting
the one bad assertion: 28/28 checks passed, covering both report
endpoints, permission boundaries (Sales/Delivery/Restricted Technical/
Finance all correctly forbidden from the organization-wide report),
filter correctness, page rendering for every role, and the nav link's
permission-gated visibility.

## What's still open: FIG-442's authentication mechanism

FIG-442 needs a decision before it can be implemented: how does a public
website form authenticate to a secure lead-capture endpoint, when there's
no human session to resolve? Options raised: a static per-organization
API key (simplest, matches "secure integration path" in the AC, but is a
long-lived shared secret); a signed webhook (HMAC signature over the
payload, more correct for the "webhook" framing FIG-442's own title uses,
but more integration work for whoever builds the website side); or
building everything else (validation, duplicate handling, assignment
rules, failure logging/recovery) behind a route with the auth check
factored out, leaving the exact mechanism an explicit open decision for
Michael/the team to confirm -- the same "provisional, not final" pattern
already used for the FIG-437 permission matrix and the `dev-login`
placeholder. No option has been chosen yet.

---

# FIG-442 Implementation Notes

FIG-442 ("Build website lead capture API and assignment workflow") picks up
exactly where the FIG-443 note above left off: the authentication mechanism
decision. Resolved per FIG-438 section 19's "if a genuinely unresolved
technical decision is discovered... document the decision and continue" --
the same latitude every ticket in this chain has used for its own open
questions (stack choice, tenant-safety mechanism, permission matrix, etc.).

## Choosing the authentication mechanism: static API key over a signed webhook

Chosen: a static per-organization API key, sent as the `x-figbloom-api-key`
header (`src/auth/websiteApiKey.ts`). Reasoning:

- The two options on the table trade off differently for a **first-party**
  integration (FigBloom's own marketing site) than they would for a
  multi-tenant public API with untrusted third-party consumers. An HMAC
  signed-webhook scheme exists to let a *receiver* verify a sender it does
  not otherwise trust without sharing a bearer secret over the wire (the
  GitHub/Stripe webhook pattern) -- valuable when the payload travels through
  infrastructure you don't control. Here, FigBloom controls both ends (its
  own CRM and its own website backend), so that property buys nothing, at
  the cost of more integration work for whoever builds the website side
  (Q49 in the stakeholder questionnaire already treats "documented REST
  APIs and webhooks" as the selection bar, not a signature scheme
  specifically).
- The stakeholder questionnaire's own answer to Q47 describes the desired
  behavior as "auto-create, auto-stamp... unconditionally" -- a simple,
  reliable, low-ceremony integration was explicitly valued over one that's
  maximally defensible against a threat model (a compromised website
  backend) that a signed webhook does not fully solve either (whoever holds
  the signing secret can still forge requests).
- Only the SHA-256 **hash** of the key is ever persisted (`WebsiteApiKey.
  keyHash`); the plaintext is returned exactly once, at generation time,
  matching how most API-key providers handle this class of credential (a
  fast hash is appropriate here specifically because the key is
  high-entropy/machine-generated, unlike a human-chosen password where a
  slow hash defends against guessing).
- One active key per organization, no rotation-overlap window: rotating
  replaces the key outright. A low-traffic, single-consumer integration
  doesn't need the added complexity of multiple simultaneously-valid keys;
  the settings page (`/o/[orgSlug]/settings`) warns before regenerating for
  exactly this reason.
- The public route lives in its own namespace, `/api/public/orgs/[orgSlug]/
  leads`, deliberately separate from `/api/orgs/[orgSlug]/**` (which always
  assumes a resolved membership session via `resolveRequestContext`) so the
  session-based and API-key-based trust boundaries can never accidentally
  share authorization logic -- a route under the wrong namespace by mistake
  fails loudly (wrong function signature) rather than silently reusing the
  wrong auth check.
- Every authentication failure mode (unknown org slug, no key configured,
  wrong key, inactive organization) throws the *identical* generic message
  (`resolveWebsitePublicContext` in `src/auth/websiteApiKey.ts`). This is
  deliberately **stricter** than the "existence isn't a secret between
  colleagues" convention `leadService.ts` documents for authenticated,
  same-organization callers -- that convention is about people who already
  work together; this endpoint is reachable by anyone on the public
  internet, so leaking which organization slugs exist via a distinguishable
  error would be a real (if minor) information disclosure.

## Round-robin lead assignment: fixed policy, not a configurable rules engine

FIG-436 section 8 lists "assignment rules" as organization-configurable
data, and `OrganizationSetting` (added in FIG-438 specifically anticipating
this) is the schema hook for it. FIG-442 uses that hook only to persist the
round-robin **cursor** (`organization_settings` key
`website_lead_assignment_cursor`, defined in
`src/repositories/leadIngestion.ts` and pre-seeded by
`seedOrganizationDefaults` so a row always exists to lock) -- it does not
build a settings UI to *choose* a different assignment strategy. That
mirrors FIG-440's decision not to build pipeline-stage configuration UI:
the data model supports future configurability, but no ticket has asked for
the UI to actually change the rule, and building one speculatively would be
exactly the ahead-of-scope work FIG-438 section 3 warns against. The fixed
V1 policy is round-robin across active memberships whose role holds
`leads.edit.own` (today, exactly Sales) -- looked up by permission, not a
hard-coded `"SALES"` role key, so it keeps working if the permission matrix
changes later without a code change (the same discipline
`dealService.ts#resolveOutcomeFields` and the LeadStatus-key-avoidance note
above already apply elsewhere).

If an organization has zero active reps holding `leads.edit.own` (an
unusual/misconfigured state -- every seeded dev organization has at least
one Sales membership), the lead is created unowned (`ownerMembershipId:
null`) rather than the request failing; Management already sees it via
`leads.view.all` with a blank owner column, the same rendering the Leads
list already had for any other unowned lead.

## Round-robin concurrency safety: `SELECT ... FOR UPDATE` on the cursor row

Two website submissions arriving at nearly the same moment must not both
read the same "last assigned" cursor and hand the same rep two leads in a
row while skipping the next rep entirely. `pickNextAssignmentOwner`
(`src/repositories/leadIngestion.ts`) takes a row lock on the cursor's
`organization_settings` row (`FOR UPDATE`) inside the same transaction as
the rest of the ingestion, before reading it -- a second concurrent
submission's transaction blocks until the first commits, so the read
(cursor) -> compute (next rep) -> write (new cursor) sequence is atomic
with respect to other ingestions for the same organization. This is why the
cursor row is pre-seeded rather than created lazily on first use: `SELECT
... FOR UPDATE` locks nothing if the row doesn't exist yet, which would
reopen exactly the race this is meant to close for an organization's very
first website lead.

## Company/Contact resolution: reuse-by-match, not "warn and always create"

FIG-438/439 established a UI-facing pattern for Companies/Contacts/Leads:
duplicate detection always warns, but creation always proceeds, because a
human is present to look at the warning and decide. There is no human
present for an automated website submission, so
`src/repositories/leadIngestion.ts#ingestWebsiteLead` uses a different,
appropriately-adapted rule: the Contact is looked up by exact
(case-insensitive) email or phone match and *reused* if found (attaching
its existing Company if the new submission supplied one and the contact
had none yet); the Company is looked up by exact (case-insensitive) name
match and reused the same way. Only the Lead itself is unconditionally
created fresh on every submission -- each inbound inquiry is treated as a
new, real event worth tracking (matching Q47's "auto-create... every
time"), even from a contact who has submitted the form before, while
avoiding an ever-growing pile of duplicate Contact/Company rows that no one
would ever get a chance to warn about or merge.

## "Acknowledgement workflow" is an internal follow-up Task, not outbound email/SMS

The MVP scope document's Website Integration section (4.10) and the
stakeholder questionnaire's Q47 both use the word "acknowledgement," which
could mean an automated reply to the website visitor. This codebase has no
email/SMS-sending infrastructure anywhere, and FIG-441 already made the
equivalent call for "reminders" ("no AC bullet asks for [an outbound
notification/delivery mechanism]... building one was treated as out of
scope: it would require a background job/scheduler and a notification
channel no other part of this codebase has"). FIG-442 reuses that exact
precedent rather than reopening it: on a successful submission with an
assigned owner, `ingestWebsiteLead` creates a Task ("Follow up on new
website lead," due in 24 hours, `HIGH` priority, linked to the new Lead,
assigned to its owner) inside the same transaction. This surfaces
immediately in the owner's Tasks list and is covered by FIG-441's existing
overdue-task mechanism if it's missed -- "acknowledgement" is implemented as
"a tracked, time-boxed internal follow-up," not a message sent back to the
website visitor. `Task.assigneeMembershipId` and `.createdByMembershipId`
are both required, non-nullable columns with no "system" pseudo-membership
concept anywhere in this schema, so the task is recorded as self-assigned
by its owner (`createdByMembershipId = assigneeMembershipId`) -- the
closest honest attribution available without inventing new schema for a
single system-generated field. When there is no owner to assign (the
zero-active-reps edge case above), no task is created; there is no
membership to attach it to.

## Service/product interest: best-effort match, never a rejection reason

Q46 lists "Service required" as a field the website form may send, but the
value arrives as free text from a marketing site, not a validated selection
from this organization's actual Service catalog. `ingestWebsiteLead`
attempts a case-insensitive match against the catalog's `name`, or an
uppercased/underscored match against its `key` (so both `"CCTV"` and
`"cctv"` resolve, matching the seeded `Service.key` convention from
`organizationDefaults.ts`); an unmatched value does not fail the
submission -- the lead is still created, with the raw string preserved in
`qualificationData.unmatchedService` for a human to reconcile, consistent
with the "losing a lead to a strict form is the failure mode being
eliminated" reasoning already used for required-field choices below.

## Required fields: the smallest set that can ever be contacted back

Q46 lists many optional fields (budget, preferred contact method) that were
already marked "defer"/"skip" by the stakeholder answers themselves.
`src/services/websiteLeadService.ts#validateWebsiteLeadInput` requires only
`name` and *at least one of* `email`/`phone` -- literally the minimum
needed to ever follow up with this person -- and is deliberately forgiving
about everything else (an unrecognized service, missing UTM params) rather
than rejecting the request, because a public lead-capture form has no human
on the other end able to fix a validation error and resubmit.

## What FIG-442 explicitly does not include

- **A configurable assignment-rules engine or settings UI for it.** See
  "Round-robin lead assignment" above -- the fixed round-robin policy is the
  deliberately smallest reasonable V1 behavior; `OrganizationSetting` is
  used only for the round-robin's own cursor state.
- **Outbound acknowledgement email/SMS to the website visitor.** See
  "'Acknowledgement workflow'" above -- reuses FIG-441's precedent that a
  real notification-delivery mechanism is out of scope for this codebase.
- **Multiple simultaneously-valid API keys / a rotation overlap window.**
  One active key per organization; regenerating invalidates the previous
  key immediately. Revisit if a second real integration consumer appears.
- **A generic "create a company/contact from any external system" mapping
  layer.** This is deliberately specific to the one integration named in
  scope (a website lead form); FIG-437 section 18 already leaves other
  external systems (the stakeholder-mentioned e-commerce/property-management
  platforms) as separate, not-yet-scheduled decisions.
- **HMAC-signed webhook support as an alternative to the API key.** See
  "Choosing the authentication mechanism" above.

## Manual end-to-end verification

Same discipline as every prior ticket: dev server + a scripted HTTP
walkthrough, not just the unit-test suite. Covered, all passing: the
Settings page renders for Management and shows a permission-denied message
(not a crash) for Sales; key generation and regeneration through the
authenticated route; the public endpoint rejecting a missing key, a wrong
key, and an unknown organization slug all with the *same* error message
(no enumeration); required-field validation (400) without a key-check
bypass; a valid submission (200) that is then actually visible in
Management's Leads list by its company name and whose auto-created
follow-up task is visible in the Tasks list. 19/19 checks passed. The
automated suite additionally covers round-robin fairness and wraparound
across multiple Sales memberships (order-independent, since two
memberships created in the same test can tie on `createdAt`), the
unowned-lead fallback when no Sales membership exists, contact/company
reuse-by-match on a repeat submission (including case-insensitivity), best-
effort service matching, and that a key stops authenticating the moment it
is regenerated.
