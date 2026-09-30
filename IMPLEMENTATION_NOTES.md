# Implementation notes

Decisions made while building this out that weren't fully pinned down by
the source docs (FIG-436/437/297/299/300), grouped by ticket. The
Organization = Tenant / User != Membership / RBAC baseline from those docs
is not reopened anywhere below — these are the things they left open.

## Stack

TypeScript + PostgreSQL + Prisma, Next.js (App Router) + React for the
API/UI layer, added to the same project rather than a separate app. Postgres
+ RLS was already the pattern in use on other FigBloom projects on this
machine; Prisma keeps schema and migrations in one place without pulling in
a full Supabase CLI stack this project doesn't otherwise need.

## Tenant isolation: composite FKs + RLS, both, not either/or

Every organization-scoped table gets two independent guarantees:

- A composite FK `(organization_id, parent_id) -> parent(organization_id, id)`
  on top of Prisma's normal single-column FK. This is always on, for every
  role, including migrations and seed scripts — it can't be bypassed by
  forgetting a `WHERE` clause.
- Row-level security, scoped by a `app.current_organization_id` session
  variable, as the defense-in-depth layer for the app's own DB connection.
  RLS only applies to the non-owner `figbloom_app` role (see README — "Why
  there are two Postgres roles"); the migration/seed connection is the
  schema owner and bypasses it, which is expected and used sparingly and
  deliberately (`src/db/adminClient.ts`).

Prisma's schema language can't express the composite FK (one side is
required, the other optional), so that part — plus the CHECK constraints
and RLS policies — is hand-written SQL in
`prisma/migrations/20260924081100_tenant_integrity_and_rls/migration.sql`.

## Roles are a fixed global catalog, not per-organization

Five roles (Management, Sales, Delivery, Finance, Restricted Technical),
seeded once, shared across every organization. Business configuration
(pipeline stages, lead sources, lost reasons, etc.) is per-organization;
RBAC itself isn't.

## Permission matrix is provisional

`prisma/seedData.ts` seeds a permission catalog and role mapping that's a
reasonable starting point, not a signed-off matrix — flag anything that
looks wrong and it's a one-line change. One reconciliation worth knowing
about: Sales can view/edit the value on deals they own (`deals.edit.own`)
but doesn't get `deals.view.value`, which is org-wide value visibility used
for aggregate reporting (Management/Finance only).

## Lead Temperature is an enum; other classifications are org-configurable tables

Lead Source/Status, Pipeline Stage, Customer Lifecycle State, and Lost
Reason are all per-organization tables so they can be renamed/reconfigured
without a migration. Lead Temperature (Hot/Warm/Cold) is a fixed Postgres
enum — every source document treats it as fixed, and there's no config
table sitting unused for it.

## Deal outcome is derived from pipeline stage, never set directly

`Deal.outcome`/`wonAt`/`lostAt`/`lostReasonId` all come out of
`dealService.ts#resolveOutcomeFields`, driven entirely by which
`PipelineStage` the deal is on (`isWon`/`isLost` flags). The API has no
`outcome` field a client can set — a deal can't be marked won/lost without
actually moving it onto a stage flagged that way. Same discipline applies
to `Task.completedAt`, derived from `status`.

## Deal value masking

`dealService.ts#maskValue` nulls out `value` (and flags `valueMasked: true`)
for any caller without `deals.view.value` who also doesn't own the deal.
The record itself is never hidden — Delivery, for example, still sees a
deal exists, its owner, and its stage, just not the number. Aggregate
reports do the same at the sum level (`reportingService.ts`).

## 404 vs 403

404 means the record doesn't exist in the caller's organization at all
(wrong id, or someone else's tenant). 403 means it exists but the caller's
role/ownership doesn't permit the action. Applied uniformly across every
service — existence isn't treated as a secret between colleagues in the
same org (see the different rule for the public website endpoint, below).

## Duplicate detection warns, never blocks — except on the public endpoint

Creating a Company/Contact/Lead through the UI always runs a
`findPossibleDuplicate*` check alongside the create and surfaces it as a
warning; the create still succeeds either way, since a human is present to
look at the warning. The website lead-capture endpoint has no human on the
other end, so it does the opposite: it looks up an existing Contact by
email/phone and an existing Company by name and reuses them if found,
rather than warning. Every submission still creates a new Lead, though —
each inbound enquiry is a real event worth tracking even from a repeat
contact.

## Lead-to-deal conversion

`convertLeadToDeal` (`src/repositories/deals.ts`) applies a configured
initial pipeline stage, carries owner/service/notes forward, and is the
only path that can link a Deal to its originating Lead — there's no
`POST /deals { leadId }` side door. A lead with no company yet requires the
caller to supply one at conversion time (via a company picker in the UI);
creating a new company inline isn't supported — pick an existing one first.

## Activities/Tasks check the linked record's own permissions

`activities.create`/`tasks.create` are flat permissions that say nothing
about which Company/Contact/Lead/Deal the caller may attach to. Without an
extra check, someone with the flat permission could read/write an activity
against a record they otherwise have no view access to, just by knowing
its id. `src/services/recordAccess.ts#assertCanAccessLinkedRecords` closes
that by re-running each linked record's own service-layer view check before
allowing the activity/task write.

## "Reminders" is the existing overdue mechanism, not a notification system

There's no email/push infrastructure anywhere in this codebase, and nothing
in the source docs asks for scheduled delivery. "Reminders" is: `Task.dueAt`
in the past + status still open = overdue, computed at query time and
surfaced on the dashboard and the Tasks page filter. The same call applies
to the website endpoint's "acknowledgement" step (see below) — it creates
an internal follow-up task, not an outbound email/SMS to the visitor.

## Audit history

`recordAuditEvent` is append-only (`figbloom_app` has UPDATE/DELETE revoked
on `audit_events` at the DB level) and wired into the mutations that
actually change ownership or a deal's outcome. Read access is gated by
`audit.view` (Management only) and surfaced on Lead/Deal detail pages.

## Reporting

`reportingService.ts#getMyActionableWork` reuses
`leadService`/`dealService`/`taskService`'s existing own/all scoping
directly rather than re-deriving it, so the dashboard automatically
inherits every ownership rule already enforced elsewhere. "Stalled deal"
(open + past expected close date) and "due today" are both one-line,
easily-revisited definitions, not something either source doc pins down
precisely.

Metric date ranges aren't all scoped the same way, worth remembering when
reading the Reports page: lead volume/conversion are scoped by the lead's
`createdAt`; won/lost deals and sales-by-service are scoped by
`wonAt`/`lostAt`; pipeline value by stage is a live snapshot with no date
range at all.

## Website lead capture (FIG-442)

Public, unauthenticated form submissions need a different trust model than
every other route in this app, which all assume a resolved membership
session. Chosen: a static per-organization API key
(`x-figbloom-api-key` header, `src/auth/websiteApiKey.ts`), over a signed
webhook — both ends of this integration (FigBloom's CRM and FigBloom's own
website) are controlled by the same team, so an HMAC scheme mainly adds
integration work for the website side without a real security win here.
Only the key's SHA-256 hash is stored; the plaintext is shown once, at
generation time, on `/o/[orgSlug]/settings` (Management only). One active
key per organization — regenerating replaces it immediately, no overlap
window.

The endpoint lives at `/api/public/orgs/[orgSlug]/leads`, deliberately in
its own namespace, separate from every session-authenticated
`/api/orgs/[orgSlug]/**` route. Every failure mode (bad key, unknown org
slug, no key configured yet) returns the identical generic 401 — stricter
than the 404/403 convention above, since this endpoint is reachable from
the public internet and a distinguishable error would leak which org slugs
exist.

Lead assignment is a fixed round-robin across active memberships holding
`leads.edit.own` (looked up by permission, not a hard-coded role name), not
a configurable rules engine — there's no ticket asking for a settings
screen to change the assignment strategy, so one wasn't built. The
round-robin cursor is a single `OrganizationSetting` row, row-locked
(`SELECT ... FOR UPDATE`) inside the same transaction as the lead create,
so two submissions arriving at once can't assign the same rep twice in a
row. If an organization somehow has no eligible rep, the lead is created
unowned rather than the request failing.

"Acknowledgement" is a 24-hour follow-up Task assigned to the new lead's
owner, not an outbound email — see "Reminders," above. A submitted
`service` value is matched against the org's Service catalog best-effort
(case-insensitive name or key); an unmatched value doesn't reject the
submission, it's kept on the lead for a human to reconcile. Required
fields are deliberately minimal — `name`, and at least one of
`email`/`phone` — since there's no one on the other end of a public form
to fix a validation error.

## Real authentication (FIG-592)

FIG-437 left the exact authentication provider as an open implementation
decision ("Exact authentication provider," "Exact session/token strategy" —
section 18). Chosen: in-house email/password, not NextAuth/Clerk/Supabase --
this project has zero external-service dependencies anywhere else, the
RBAC/tenant model it has to resolve into is already fully custom, and it's
currently a single-organization internal tool where a vendor dependency
buys little. `/dev-login` (`src/auth/devSession.ts`) remains only as a
local-development convenience and is hard-disabled outside development
(`NODE_ENV === "production"`, checked in the page, the API route, and — via
`notFound()` at build time — baked into the production build itself; see
`src/app/dev-login/page.tsx`).

Sessions (`src/auth/session.ts`) are DB-backed, not a signed/stateless
token: a random 32-byte token is handed to the client, only its SHA-256 hash
is stored (same pattern as the website API key), and revocation is just
updating a row. This is what makes "sessions can be revoked" possible at
all — a password reset revokes every other session for that account
(`authService.ts#resetPassword`), rather than waiting one out.

One reset-token flow (`src/auth/passwordResetToken.ts`) serves both "forgot
password" and "set a first password" — `User.passwordHash` is nullable
specifically so a user can exist (via Membership creation) before any
password exists yet, matching FIG-437's own account-creation model, which is
admin/membership-driven rather than public self-service signup.

`/signup` (`authService.ts#signup`) exists for account creation directly
from the login page, but it only creates the `User` row and signs the
caller in — it grants no organization access. FIG-437 treats Membership
creation as an admin/approved-process action (`addMembership` in
`src/repositories/memberships.ts`), and signup doesn't shortcut that by
attaching a role itself. A freshly-signed-up user with no membership yet
sees the org layout's existing "no active membership" message rather than
either being denied a login outright or silently granted access to
`figbloom`.

Every login/reset failure mode returns one generic message
(`authService.ts`) — this endpoint is public and internet-reachable before
any session exists, so it gets the stricter enumeration-resistant treatment
used for the FIG-442 website endpoint, not the looser "existence isn't
secret between colleagues" convention used inside already-authenticated
services.

Password-reset email delivery is real, via `nodemailer`
(`src/auth/email.ts`), once `SMTP_HOST` and friends are set (`.env.example`)
— no code change needed to switch it on. With nothing set, it falls back to
logging the reset link server-side instead, so the flow stays testable
without credentials; this is the state local dev and the test suite run in
today, since this project has no real SMTP provider account of its own to
default to. The fallback and the real path are both exercised:
`tests/authEmail.test.ts` verifies the composed message via an injected
fake transport, and the real, unmocked `sendPasswordResetEmail` (no
override) was separately confirmed to send successfully over a live SMTP
connection using a disposable Ethereal test account during development —
the transport code itself is proven working end-to-end, not just mocked.

Basic brute-force throttling (rate limiting / lockout) was deliberately not
added — it isn't in FIG-592's acceptance criteria, and doing it properly
needs shared state (Redis or similar) this project doesn't otherwise use.
Revisit if this goes internet-facing for real external users.

`resolveRequestContext`/`getCurrentUserId` (`src/auth/requestContext.ts`)
take an optional `CookieReader` override for exactly this reason: `cookies()`
from `next/headers` only works inside a real Next.js request, so every
other test in this suite exercises auth via `createTestContext`
(`tests/helpers/fixtures.ts`), a shortcut straight to
`resolveActiveMembership` that never actually goes through this module.
`tests/requestContext.test.ts` closes that gap directly — a fake
`CookieReader` drives the exact same function every real route calls,
covering a real session resolving to its membership, a revoked/garbage
session, an unknown org slug, no membership in that org, and the
dev-session fallback being honored outside production but never inside it.
No route or page passes this override; production behavior is unchanged.

## Known non-obvious fixes

- Dates from an `<input type="date">` (`"YYYY-MM-DD"`) need an explicit
  `new Date(...)` conversion before Prisma will accept them into a
  DateTime column — `createDeal` was missing this even though `updateDeal`
  had it; both now convert consistently.
- Every page that calls a `leads.view.*`/`deals.view.*`-gated service must
  guard the call for roles with zero permission in that area (they throw
  `ForbiddenError` rather than returning an empty list) — missing this
  guard was a repeat 500 across the dashboard, Leads list, and each detail
  page early on; the pattern is now applied everywhere a page calls a
  permission-gated list/get.
- Local dev/hot-reload leaks a new Prisma connection pool per file save
  unless the client is cached on `globalThis` — both `adminDb` and the
  org-scoped client do this (see their file headers).

## Deliberately not built

- A settings UI for configuring pipeline stages, lead-assignment rules, or
  anything else the schema already supports per-organization — nothing in
  scope has asked for one yet.
- Full proposal generation/e-signature — `ProposalReference` is reference-
  only by design.
- A separate Communications CRUD/UI distinct from Activities — the
  Activity type enum already covers every channel named in scope.
- Any outbound notification delivery (email/SMS/push) — nothing in this
  codebase sends anything; every "reminder"/"acknowledgement" is an
  in-app, queryable state instead.
- Multiple simultaneously-valid website API keys, or HMAC-signed webhook
  support as an alternative — revisit if a second real integration
  consumer shows up.
- Self-service account creation/signup, SSO, and login rate-limiting — see
  "Real authentication (FIG-592)," above, for why.
