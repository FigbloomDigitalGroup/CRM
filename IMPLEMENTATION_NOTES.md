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

## Member/role administration (FIG-593)

`membership.manage` and `role.assign` existed as permission keys with
nothing enforcing them -- the only way to add a second user was
`scripts/manual-add-second-sales-user.ts`, a one-off script. `/o/[orgSlug]/
settings`'s new "Members" section and `src/services/membershipService.ts`
close that: invite, change role, deactivate, reactivate, all
permission-checked and audited (`membership.invited`/`reinvited`/
`invite_accepted`/`role_changed`/`deactivated`/`reactivated`).

Invites go through a real acceptance step rather than granting access
immediately, using `Membership.status = PENDING` (a third state alongside
ACTIVE/INACTIVE) plus an invite token directly on the `Membership` row
(`inviteTokenHash`/`inviteTokenExpiresAt`) -- same generate-random/hash-
and-compare pattern as sessions and the website API key, one row per
membership rather than a separate token table, since an invite only ever
activates the exact membership it was issued for. `resolveActiveMembership`
only ever matches ACTIVE, so a pending invite grants zero access on its
own, closing the loop with FIG-437's "missing or invalid context fails
closed" rule.

One acceptance endpoint (`authService.ts#acceptMembershipInvite`) handles
both a brand-new invitee (no password yet -- one is required and set) and
an existing user being invited to a second organization (already has a
password -- none is required or touched). The password is validated
*before* the single-use token is consumed: doing it the other way around
would leave the membership activated but the account permanently
unreachable if validation failed, since the link can't be retried once
burned. `getInviteInfo` is a separate, non-consuming read used only to
decide whether `/accept-invite` shows a password field, so loading the
page never spends the token.

Re-inviting an email with a still-pending invite regenerates and resends
the token rather than erroring -- a real conflict (already an active
member) still does. Deactivating/changing the role of the organization's
last active Management member is blocked
(`membershipService.ts#assertNotLastActiveManagement`); reactivating
requires `joinedAt` to already be set (they accepted once before) --
someone who never accepted should be re-invited instead, not reactivated.

## Abuse protection on the public website endpoint (FIG-594)

The API key alone (FIG-442) only answers "is this caller allowed at all,"
not "is this caller behaving reasonably" -- FIG-594 adds the second half,
all inside `submitWebsiteLead` (`src/services/websiteLeadService.ts`), with
one log table doing double duty as both the audit trail and the data rate
limiting counts against, rather than standing up a separate in-memory or
Redis-backed counter this project has nowhere durable to keep otherwise
(see the "Basic brute-force throttling" note under "Real authentication,"
above, for the same reasoning applied to login).

Every attempt is written to `WebsiteLeadRequestLog` in a `finally` block
-- exactly one row per request, whatever the outcome -- via the schema-
owner `adminDb` connection, the same exception already used for the
Organization/WebsiteApiKey lookups that happen alongside it (no RLS
context exists yet at this point in the request). `figbloom_app` (the
role the authenticated monitoring view in `/o/[orgSlug]/settings` reads
through) has INSERT/UPDATE/DELETE revoked on this table outright, not just
UPDATE/DELETE like `audit_events` -- it never writes here at all, only
reads. That revoke is repeated in `scripts/db-admin.ts#grantRole`, which
otherwise re-grants full privileges on every table each time it runs; this
was caught before it shipped by noticing `audit_events` already needed the
same treatment there.

Rate limiting counts by `keyHash` (the full SHA-256 hash of whatever key
was submitted, valid or not), not the short `keyPrefix` shown in the
settings UI -- the prefix only has a few random characters of real entropy
and could group unrelated keys into the same bucket by chance. The
per-key and per-IP limits are read live from the environment
(`WEBSITE_LEAD_RATE_LIMIT_*`, `.env.example`) rather than frozen
constants, defaulting to 20/IP and 60/key per 60-second window -- mainly so
tests can set a tiny window/limit instead of firing dozens of real
requests, but it also means ops can retune them without a code change.

A wrong/missing key is still logged against the *organization the request
targeted* (resolved by slug independently of the key check, purely for
logging), not left with a null organization -- otherwise every bad-key
attempt against a real org's slug would be invisible in that org's own
monitoring view, which defeats the point of "visible for monitoring." This
doesn't change what an unauthenticated caller sees back: the external
error is exactly as generic either way, only the org's own RLS-scoped
internal view gets more complete.

The honeypot check (optional per key, `WebsiteApiKey.honeypotFieldName`)
returns the endpoint's normal `{"status": "created"}` shape with no lead
created, rather than an error -- a honeypot only works if whatever filled
it in believes it succeeded. Captcha (optional, `WebsiteApiKey.captchaSecret`)
calls Cloudflare Turnstile's real `siteverify` endpoint
(`src/auth/captcha.ts`); a network failure talking to Turnstile fails
closed (rejects the submission) rather than treating captcha as
unconfigured. Allowed origins (optional, `WebsiteApiKey.allowedOrigins`)
checks the Origin header, falling back to Referer's origin, only when the
list is non-empty -- the documented integration pattern is server-to-
server and may send neither header at all, so an unconfigured key must
keep accepting requests with no origin, not start rejecting them.

Key revocation (`WebsiteApiKey.revokedAt`) is new and distinct from
rotation: rotating always leaves a new working key behind, revoking leaves
none. Regenerating after a revoke clears it -- generating a new key is an
unambiguous request for a working integration again.

## CI, Dockerfile, and deployment (FIG-595)

Chosen: a platform-agnostic Docker image (`Dockerfile`) plus GitHub
Actions CI (`.github/workflows/ci.yml`), rather than committing to a
specific hosting vendor this project has never used before -- see
`docs/DEPLOYMENT.md` for the full reasoning and the deploy sequence
itself. GitHub Actions specifically because this repo already lives on
GitHub (`git remote -v`); that part wasn't a real decision.

One image serves both the running server and the one-off deploy admin
commands (`migrate:deploy`, `db:bootstrap-role`, `db:grant-role`), gated
behind a `RUN_MIGRATIONS_ON_START` flag in `docker/entrypoint.sh` so a
multi-replica deploy doesn't race every replica into running migrations
concurrently on startup. This meant NOT using Next's `output: "standalone"`
trimming, which would have dropped the Prisma CLI and `tsx` those admin
commands need -- a deliberate tradeoff of image size for a single,
simpler image that can do both jobs.

CI runs a real Postgres service container, not a stub -- RLS and the
composite tenant-integrity FKs are the point of this schema, so a fake
database would test nothing that actually matters here. GitHub Actions
service containers don't support the docker-compose-style init-script
volume mount local dev uses for the second (test) database
(`docker/init-test-db.sql`); CI creates it with an explicit `psql`
step instead.

Structured logging (`src/lib/logger.ts`, `pino`) replaced every bare
`console.error` in a route's unhandled-error fallback. A real
error-tracking service (Sentry or similar) needs a real account/DSN this
project doesn't have -- the same documented-gap pattern as SMTP (FIG-592)
and captcha (FIG-594) -- so it's left as a clear next step (it would hook
in at the same `logger.error` call sites), not faked.

Everything in this ticket that could be verified for real, was, rather
than written and assumed correct: the Docker image was actually built and
run against this project's own dev Postgres (migrations applied, the role
was bootstrapped/granted, the server answered `/api/health`, served
`/login`, and completed a real login, all from inside the container), and
the backup/restore procedure in `docs/DEPLOYMENT.md` is the exact `pg_dump`/
`pg_restore` sequence that was run, with row counts and the RLS flag
checked on the restored database.

The live Cloudflare Turnstile network calls proving captcha verification
really works (FIG-594) were originally left inside the permanent test
suite (`tests/websiteAbuseProtection.test.ts`) -- directly in tension with
this ticket's own "reliable CI on every PR" goal, since a third-party
network hiccup would then fail CI for a reason having nothing to do with
this codebase. Fixed here by mocking `fetch` in the permanent suite
(matching the pattern `tests/authEmail.test.ts` already used for the real
SMTP send in FIG-592: prove it live once during development, keep only a
mocked version in the suite that actually gates every PR).

## Data import/export (FIG-596)

`*.export` permission keys (`leads.export`, `contacts.export`,
`companies.export`, `deals.export`, `export.bulk`) already existed in the
seed data with no code behind them. The matching `*.import` keys
(`companies.import`, `contacts.import`, `leads.import`) didn't exist at all
and were added here, deliberately Management-only like their export
counterparts: bulk-importing is an org-wide write (not scoped to "my own
records" the way `leads.create` is), and the ticket itself frames it as a
one-off data-migration task, not day-to-day rep activity. Deals were left
out of import on purpose — the acceptance criteria only lists companies,
contacts, and leads for import, and a Deal already has enough
cross-references (company, pipeline stage, owner, and optionally a
converting Lead) that force-fitting it through the same generic CSV-row
engine would have meant reimplementing `convertLeadToDeal`'s rules rather
than reusing them.

No CSV library existed in this project; added `csv-parse` and
`csv-stringify` (same maintainer, same conventions, both support a
streaming Node API). No job-queue infrastructure exists either (no Redis,
no background worker — the same constraint noted for rate limiting in
FIG-594), which shaped both ends of this ticket:

- **Import** streams the uploaded file row-by-row through `csv-parse`
  (`src/lib/csv.ts#parseCsvRows`) and writes in small concurrent batches
  (`src/lib/asyncBatch.ts`), so memory never scales with file size. The
  actual backstop against a runaway request is a row-count ceiling
  (`IMPORT_MAX_ROWS`, default 20,000 — see `.env.example`), not a timeout:
  there's nowhere to hand a bigger job off to, so the honest answer is a
  documented limit rather than a queue this project doesn't have.
- **Export** streams its HTTP response via `csv-stringify`
  (`src/lib/csv.ts#csvResponseStream`), so the response starts flowing
  before serialization finishes. The underlying DB query itself is still
  one bulk fetch (reusing each entity's existing `list*` service function,
  so scoping/masking/permission rules are inherited for free rather than
  re-derived) — genuinely cursor-paginated reads from the database are a
  real next step if an organization's record count ever grows far past
  what a single query comfortably returns, but that's not this project's
  scale today. The **Reports** export is the one exception that isn't
  streamed at all: it's a handful of small aggregate tables, not a
  per-record dataset, so building the whole CSV in memory
  (`src/services/exportService.ts#exportReportsCsv`) isn't the kind of
  "large file" this ticket is about.

Column mapping happens client-side without a second upload: the browser
reads only the file's first ~64KB to extract header names
(`src/components/csvHeaderPreview.ts`), the user maps CRM fields to those
headers (pre-filled with a best-effort name match), and the real file is
then posted once, mapping included, as `multipart/form-data`.

Duplicate handling reuses the existing `findPossibleDuplicate*` repository
functions (Companies, Contacts, Leads) that duplicate-detection already
added — the default is to skip a row that matches, with an explicit
`duplicateStrategy: "create"` override per import run (not per row; a
mixed per-row choice wasn't asked for and would have meant a second UI
pass per ambiguous row).

A row-level problem (missing required field, an unresolvable lookup like a
company/lead-status/owner name or email that doesn't match anything in
this organization, an invalid temperature value) never aborts the whole
file — it's collected into an error report (row number + reason) returned
alongside the summary counts, capped at 500 reported rows so a
systematically-broken file doesn't blow up the response. The whole-job
outcome (counts, not the row-level error list) is what's audited —
`companies.imported`/`contacts.imported`/`leads.imported`, one event per
import call — rather than one audit row per imported record, which
would have made a large import's own audit trail the thing that scales
badly.

Export gating is deliberately layered, not substitutive: `exportDealsCsv`
still calls `dealService.listDeals`, so a caller needs both the `.export`
permission *and* whatever `.view.*` the underlying service already
requires, and still gets `maskValue`'s existing value-masking applied per
row for free. Every seeded role that currently has `.export` also already
has full `.view.all` (Management only), so this layering doesn't change
today's behavior — it just means the masking rule still holds correctly
if a future role is ever given export without full value visibility,
instead of silently leaking values the UI would have hidden.

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
