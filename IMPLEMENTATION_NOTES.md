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

## Notifications and outbound delivery (FIG-597)

Three genuinely different kinds of "notify someone" ended up sharing one
mechanism (`Notification` + `NotificationDelivery`), rather than three
parallel ones:

- **Directly triggered, one-shot**: a lead gets reassigned (manually via
  `leadService.assignLead`, or automatically by the website lead-capture
  round-robin in `leadIngestion.ts`). Fires exactly once, from the exact
  code path that made it true.
- **Proactively scanned**: a task crosses into "due today" or "overdue."
  Nothing in a request/response cycle notices this on its own -- it has to
  be scanned for, which is what `scripts/notifications-sweep.ts` is.
- **No internal recipient at all**: the website-enquirer acknowledgement.
  This is why `NotificationDelivery.notificationId` is nullable -- a
  delivery with no parent `Notification` is exactly this case, not an
  error state.

**Idempotency is a partial unique index, not a blanket one** -- this was
the one real design bug caught before it shipped (see the test
"notifies again when the same lead is reassigned back to a previous
owner"). A single `@@unique([organizationId, membershipId, type,
entityType, entityId])` across all three `NotificationType` values would
have silently swallowed a *second* `LEAD_ASSIGNED` notification when a
lead bounces back to a previous owner -- correct for "this task is overdue"
(a fact that becomes true once and stays true) but wrong for "you were
assigned this lead" (a discrete event that can legitimately recur for the
same lead+person pair). Fixed with a partial index,
`WHERE type IN ('TASK_DUE', 'TASK_OVERDUE')`, invisible to `schema.prisma`
for the same reason the composite tenant-integrity FKs are (Prisma's
schema DSL can't express an index `WHERE` clause) -- see the migration's
own header comment.

**Preferences are two independent axes, not one on/off switch**: disabling
"in-app" for a notification type doesn't stop the underlying
`Notification` row from being created (it's still the dedup ledger the
sweep script depends on, and may still back an email) -- it's filtered out
at read time in `listMyNotifications`/`getMyUnreadNotificationCount`
instead. Disabling "email" skips queuing a `NotificationDelivery`
entirely. No preference row existing for a (membership, type) pair means
"both on" -- the same "off unless configured" shape as `WebsiteApiKey`'s
abuse-protection fields -- so introducing this table needed no backfill
for existing memberships.

**No job queue, so retries are a plain polling column, not a queue
message**: `NotificationDelivery.nextAttemptAt` + `status` is what
`scripts/notifications-sweep.ts` polls (`status IN (PENDING, FAILED) AND
next_attempt_at <= now()`), with exponential-ish backoff
(`computeNextAttemptDelayMs`) capped at 24h and a `maxAttempts` ceiling
(default 5) past which a delivery is marked `EXHAUSTED` rather than
retried forever. The sweep script itself is genuinely new infrastructure
this project didn't have before (see "Deliberately not built," below, and
`docs/DEPLOYMENT.md`'s "Scheduled jobs") -- it has to be invoked on an
interval by whatever recurring-task mechanism the eventual deploy host
provides, since FIG-595 deliberately kept this project's deployment
platform-agnostic and nothing in a single-image, no-sidecar deployment
runs anything periodically on its own.

**Links inside notification emails use a real `APP_BASE_URL` env var,
not the per-request origin** `sendPasswordResetEmail`/
`sendMembershipInviteEmail` use (`buildResetUrl`/`buildAcceptUrl`,
constructed in the route handler from `new URL(request.url).origin`).
Those two are always triggered synchronously from within an HTTP request;
a notification can be generated by a script with no request in scope at
all (the due/overdue sweep), so there's no origin to derive it from.

**SMS/WhatsApp (ticket AC: optional) is wired exactly as far as it can be
without a real account** -- `src/notifications/sms.ts` mirrors
`src/auth/email.ts`'s SMTP-or-log fallback shape (an injectable
`SmsTransport`, an `isSmsConfigured()` check, a log line instead of a real
send when unconfigured), and a `NotificationDelivery` with
`channel: SMS` goes through the identical create/attempt/retry path as
email. What's missing is a real provider SDK (Twilio, Vonage, WhatsApp
Business API, ...), which needs a real account this project doesn't have
-- the same documented-gap pattern as Sentry (FIG-595) and Cloudflare
Turnstile before a secret exists (FIG-594). Internal notifications
(lead-assigned, task due/overdue) are email-only in this release, matching
the ticket's own acceptance criteria wording ("in-app and email"); only the
website acknowledgement actually exercises the SMS path (when the enquirer
gave a phone but no email).

## Communications and CompanyService (FIG-598)

Communication and CompanyService existed in the schema with zero code
behind them -- this ticket built the full service/repository/route/UI
layer for both, directly templated on Activity (the closest existing
analog: same optional Company/Contact/Lead/Deal linkage,
`assertCanAccessLinkedRecords` reused as-is) rather than inventing new
patterns.

**"Permission-gated and audited" put a real audit event on a bare create,
which had no precedent.** Every other `recordAuditEvent` call site in this
codebase is on a mutation with a meaningful before/after (ownership
reassignment, deal outcome change) -- Activity creation itself has never
been audited. Communication's AC explicitly asked for audit on create, so
`communicationService.createCommunication`/`sendAndLogEmail` both call
`recordAuditEvent` with `action: "communication.logged"` and a `newValue`
snapshot (channel, direction, subject, linked ids), no `previousValue` --
the create itself is the event. This is new ground, not a pattern this
ticket could copy.

**"Send and log emails from a lead/contact/deal" reuses FIG-592/597's
SMTP-or-log transport, not a new one.** `src/notifications/email.ts` grew
one more function, `sendComposedEmail`, that -- unlike every other function
in that file -- takes caller-authored subject/body instead of a fixed
template, since this is a human composing a real message, not a system
notification. `communicationService.sendAndLogEmail` treats a thrown send
as fatal: no Communication is logged for an email that didn't actually go
out, which would be a false record, worse than no record. (A "logged"
send includes the no-SMTP-configured console-log fallback, same as every
other email in this project -- that's a legitimate, intentional dev-mode
"send," not a failure.)

**"Mailbox sync or BCC-to-CRM" -- chose BCC-to-CRM, and built the real
parts of it that don't require a third-party account.** Full mailbox
OAuth sync (Gmail API / Microsoft Graph) needs a registered OAuth app,
real user consent flows, and token-refresh infrastructure this project has
nothing of. BCC-to-CRM (receiving mail via a real inbound-email provider's
webhook -- Postmark/Mailgun/SendGrid inbound parse) is the lighter-weight
of the two and was built for real: `src/auth/inboundEmailKey.ts` (a
second, separate credential from `WebsiteApiKey` -- different trust
boundary, same generate/hash/compare/revoke shape),
`src/services/inboundEmailService.ts`, and a genuinely working webhook
route that matches the sender against an existing Contact and logs an
inbound Communication. What's missing is the one piece that needs a real
account: an actual inbound-email provider configured with real DNS/MX
records to call this webhook. Same documented-gap pattern as Sentry
(FIG-595), the SMS provider (FIG-597), and captcha before a secret exists
(FIG-594) -- this is wired end-to-end and was tested with a synthetic
payload shaped like what a real provider sends, not faked.

**`Communication.authorMembershipId` became optional mid-ticket.** The
schema had it as a required field, copied from Activity's own
`authorMembershipId`. Building the inbound webhook surfaced the problem:
an email logged by the webhook has no CRM user to attribute it to at all
-- there was no reasonable value to put there (a designated "system"
membership would misattribute authorship to a human who didn't do
anything). Fixed with a migration making the column nullable
(`communications` only; Activity's stays required, since every Activity
create path has a real acting user). Every other create path (manual log,
"send and log email") still always stamps the caller's own membership --
only the inbound path leaves it null, and the UI already renders that as
"(inbound)" rather than a blank.

**A new `company_services.view`/`.manage` permission pair, not reused
`companies.view`/`.edit`.** Delivery and Finance both already have
`companies.view` but not `.edit`, and both plausibly want to see which
services a customer holds (delivery for handoff context, finance for
billing/renewals) without gaining company-edit rights. Giving
CompanyService its own permission area matches this project's existing
granularity (Activities & Tasks, Proposals, Finance, Communications
already each got their own) rather than overloading Company's.

**CompanyService has no delete, only status transitions** (ACTIVE ->
COMPLETED/CANCELLED, with `endDate` stamped automatically when leaving
ACTIVE) -- same reasoning as Deal outcomes: a service a company once held
is still true history, not something to erase. `companyId`/`serviceId`
are immutable once linked; re-pointing a record at a different
company/service would be "end this one, start another," not an edit.

**The inbound-email token is delivered via a `token` query param, not a
header.** Every other per-organization credential in this project
(website API key, now inbound email) is sent as a request header -- but a
header only works if the caller can set one, and most inbound-email-parse
providers let you configure an arbitrary destination URL for their
webhook, not always custom headers. The query param works with the
lowest common denominator; `x-figbloom-inbound-key` is still accepted too,
for a provider that does support custom headers.

## Reference data and website lead assignment (FIG-599)

**One generic repository/service for 5 near-identical catalogs, instead of
5 copy-pasted files.** LeadSource, LeadStatus, PipelineStage, LostReason,
and Service share the same shape (`id`/`organizationId`/`key`/`name`/
`description`/`sequence`/`isActive`) plus a small set of per-catalog extras
(PipelineStage's `probability`/`isWon`/`isLost`, Service's `category`).
`src/repositories/referenceCatalogs.ts` dispatches to the right Prisma
delegate through one `CatalogKey`-keyed lookup (an explicit, contained
`as unknown as` cast at that single boundary -- every caller outside this
file only ever sees the typed `CatalogEntry` shape), and
`src/services/referenceCatalogService.ts` is the one place permission
checks, key-collision handling, and audit events live for all 5. This is
the rare case where the generic version is actually simpler than 5
hand-written copies, not premature abstraction -- the 5 catalogs are
identical in everything that matters for CRUD/reorder/deactivate.

**`Service` didn't have a `sequence` column before this ticket** -- the
other 4 catalogs did, Service only had `category`. The AC asks for reorder
on all 5, so a migration added it, backfilled per-organization by existing
`createdAt` order (not left at a meaningless `0` for every row) --
see `prisma/migrations/20261004090000_service_sequence`.

**"Deactivating a value in use is handled safely" was already true before
this ticket, by construction -- this ticket surfaces it, not fixes it.**
Every FK from Lead/Deal/Company into these 5 catalogs is already either
`onDelete: Restrict` (the required ones, e.g. `Lead.leadStatusId`,
`Deal.pipelineStageId`) or `onDelete: SetNull` (the optional ones) -- true
hard deletion was never possible, and `isActive` already existed on every
one of these models from their original migration. So "deactivate safely"
reduces to: never add a hard-delete path (there isn't one, and this ticket
doesn't add one), and show the caller how many records currently
reference an entry before they deactivate it (`countCatalogEntryUsage` --
informational only, never blocking; an existing record keeps its value
regardless of the flag).

**Reorder is a single up/down swap, not a drag-and-drop reindex.**
`moveCatalogEntry` swaps `sequence` with the adjacent entry in display
order and no-ops at either boundary. No drag-and-drop library exists
anywhere else in this project, and a full "accept an arbitrary new order"
endpoint would need to validate the submitted id list exactly matches the
existing set -- solving a problem the ticket's "reorder" language doesn't
actually require. Two buttons per row, one swap per click.

**Website lead assignment became a single on/off switch, not a rules
engine.** The code already had a comment acknowledging "assignment rules
are meant to be org-configurable eventually (FIG-436), but no rules engine
exists yet" (`src/repositories/leadIngestion.ts`). Building a real rules
engine (by source, territory, service, etc.) is a materially bigger
ticket than this one's AC asks for ("configurable in settings"), so this
ticket adds exactly one configurable choice -- round-robin (the existing
behavior, still the default) or leave unassigned for manual triage --
stored the same way as FIG-597's acknowledgement toggle
(`OrganizationSetting` JSON value, `getWebsiteAssignmentSetting`/
`setWebsiteAssignmentSetting` in `integrationService.ts`, gated by the
same `configuration.manage` permission as the rest of that file). A missing
setting row defaults to `"ROUND_ROBIN"`, so every already-provisioned
organization's behavior is unchanged until someone opts into the other
mode.

**Reused `configuration.manage` rather than adding a new permission.**
That permission's own seed description already said "Manage controlled
reference data (lead sources, pipeline stages, etc.)" -- it existed since
an earlier ticket but was only ever wired to the website/inbound-email
integration settings. This ticket is what actually connects it to the
reference-data catalogs its description already named.

**`CustomerLifecycleState` is the same shape as the 5 catalogs above but
was left out.** It's not named in this ticket's acceptance criteria
("pipeline stages... lead sources, lead statuses, lost reasons, and
services"), so it stays seed-only/read-only for now -- extending
`referenceCatalogs.ts` to cover it later is a small, mechanical addition
if a future ticket asks for it.

## Contact/Company timelines, tasks, audit, and broader audit coverage (FIG-600)

**Company's Activity timeline, Task section, and Audit history already
existed; only Contact's and Company's Task section were actually
missing.** Before reading the code, this looked like a 4-section gap
across two pages. In practice Company already had `ActivityTimeline` and
`AuditHistory` wired (from FIG-441), just a `TaskSection` short of
complete; Contact had none of the three at all. The real gap was smaller
than the ticket's framing suggested -- worth checking what already exists
before assuming a ticket's acceptance criteria describe a blank slate.

**"Activities across their leads and deals" required a real aggregation
query, not just pointing the existing generic timeline at a new
`parentField`.** `ActivityTimeline`/`TaskSection`/`AuditHistory` were
already fully generic (their `parentField` union already included
`"companyId" | "contactId"`), so the mechanical wiring was trivial -- but
`activityService.listActivitiesForCompany`/`listActivitiesForContact`
previously only returned Activities with a *direct* `companyId`/
`contactId` link, which in practice is almost nothing: a rep logs a call
against the Lead or Deal they're working, not against the Company/Contact
record itself. Fixed by resolving every Lead/Deal id under the Company
(`companyId`) or Contact (`contactId` on Lead, `primaryContactId` on
Deal) and querying Activities with an `OR` across direct link + those
lead/deal ids (`listActivitiesForTimeline` in
`src/repositories/activities.ts`). Tasks were NOT given this treatment --
the AC's wording for Tasks ("created and viewed from contact and company
pages") is narrower than Activities' ("across their leads and deals"), so
Task sections on Company/Contact pages only show directly-linked tasks,
already fully supported by the existing schema/service layer with zero
changes needed there.

**The aggregation had to re-derive own-vs-all visibility itself, rather
than reusing `listLeads`/`listDeals` directly.** `ListLeadsFilters`/
`ListDealsFilters` don't support filtering by `companyId`/`contactId` (Lead
has no such filter at all; Deal only has `companyId`, not a contact
equivalent), so routing through the existing list services wasn't a
drop-in. Instead, `activityService.ts`'s `visibleLeadAndDealIds` queries
`adminDb.lead`/`adminDb.deal` directly (same "service layer reaches
`adminDb` for a narrow scoped lookup outside the main repository surface"
pattern already used by `dealService.ts`'s pipeline-stage lookup and
`taskService.ts`'s assignee lookup), then applies the same
`leads.view.own`/`.all` and `deals.view.own`/`.all` logic `listLeads`/
`listDeals` already enforce. Getting this right mattered: without it, a
Sales rep who can only view their own leads would see a colleague's
private lead's activity log leak into a shared Company's timeline --
exposure the Lead's own detail page would 403 them for directly. Verified
live: a second Sales rep could not see a peer's lead activity on a shared
company's page, while Management (which holds `leads.view.all`) could.

**Broadening audit coverage used one shared diff helper
(`src/services/auditDiff.ts`) across all four services, rather than
reimplementing the same before/after comparison four times.**
`diffAuditedFields(before, patch, fields)` normalizes `Date` ->
ISO string, `Prisma.Decimal` -> number, and numeric-looking strings ->
number before comparing, so re-submitting a deal's unchanged value in a
different string format doesn't produce a spurious audit event. It
returns `null` (no event) when none of the *tracked* fields actually
changed, so an edit that only touches notes/description stays silent --
matching the existing precedent (`deal.outcome_changed` already only
fires when the outcome itself flips, not on every deal edit).

**What got added per entity, and what didn't:**
- `leadService.updateLead` previously recorded **zero** audit events at
  all (only `assignLead`, a separate function, audited ownership). Now
  also audits `leadStatusId`/`leadSourceId`/`temperature`/`lostReasonId`/
  `companyId`/`contactId` changes as a single `lead.updated` event.
- `dealService.updateDeal` previously only audited outcome flips. Now
  also audits `primaryContactId`/`serviceId`/`value`/`currency` as
  `deal.updated` -- and `pipelineStageId` too, but **only** when the move
  didn't also flip the outcome (open -> open), so a won/lost transition
  isn't logged twice across two different events for the same field.
- `companyService.updateCompany`/`contactService.updateContact`
  previously only audited `ownerMembershipId`. Now also audit `name`/
  `lifecycleStateId` (Company) and `firstName`/`lastName`/`companyId`
  (Contact) as `company.updated`/`contact.updated`.
- Untouched on purpose: notes/description/phone/email/website/location on
  every entity -- "broaden... to other *important* field changes," not
  every field. These are cosmetic/contact-detail edits, not the kind of
  qualification/lifecycle/ownership signal the rest of this audit trail
  already tracks.

## Archive/restore, merge, inline conversion, and data deletion (FIG-601)

**Soft-delete reused the existing `archivedAt`-style pattern, not a new
status enum.** `Lead`/`Contact`/`Company`/`Deal` each got one nullable
`archivedAt DateTime?` column -- the same shape `Service.isActive`
established in FIG-436, just a timestamp instead of a boolean so "when"
is free. Every list query (`listCompanies`/`listContacts`/`listLeads`/
`listDeals`) and both duplicate-detection functions
(`findPossibleDuplicateCompanies`/`findPossibleDuplicateContacts`) got an
`archivedAt: null` filter by default, with an explicit `includeArchived`
opt-in on the list side. No hard-delete path was added anywhere in the
product -- this ticket's "delete" is entirely soft.

**Archive/restore permissions mirror each entity's existing granularity,
not a single new blanket permission.** Lead and Deal already have an
own/all split for view/edit (`leads.edit.own`/`.all`,
`deals.edit.own`/`.all`) because an individual rep can act on their own
record without Management; archiving a dead lead/deal you own is the same
shape of action, so `leads.archive.own`/`.all` and
`deals.archive.own`/`.all` mirror that split exactly
(`requireOwnedRecordPermission`, same helper `updateLead`/`updateDeal`
already use). Contact and Company have never had an own/all split for
anything (`contacts.edit`/`companies.edit` are flat), so
`contacts.archive`/`companies.archive` stayed flat too, rather than
inventing ownership semantics these two models have never had.

**Merge is a single repository transaction per entity
(`mergeCompanies`/`mergeContacts`), not a generic "reassign any FK"
utility.** Company and Contact each have a different, fixed set of child
tables to reassign (Company: Contact/Lead/Deal/Activity/Task/
Communication/CompanyService; Contact: Lead/Deal(as `primaryContactId`)/
Activity/Task/Communication) -- different enough field names
(`companyId` vs. `contactId` vs. `primaryContactId`) that a shared generic
version would need almost as much per-entity special-casing as just
writing both out, the same call made for the reference-catalog dispatcher
in FIG-599 not applying here. Both follow the identical shape: reassign
every child with `updateMany`, then archive the loser with
`mergedIntoId` set, all in one `withOrgContext` transaction so a failure
partway through leaves nothing half-reassigned. Lead and Deal have no
merge action -- the AC only asked for "merge duplicate contacts/
companies," and a duplicate Lead/Deal is just archived instead (there's
no obvious "child record" story for merging two Leads the way there is
for a Company's Contacts/Deals).

**Restoring a merged record does not undo the merge.** `restoreCompany`/
`restoreContact` just clear `archivedAt`/`mergedIntoId` -- the Contacts/
Leads/Deals/etc. that were reassigned during the merge stay with whatever
they were merged into. Un-reassigning them back would need to record
*which specific rows* moved and when (a merge log), which the AC's
"preserving activities, tasks, and history" didn't ask for -- it asked
for the history to survive the merge, not for the merge to be perfectly
reversible. Restoring a merged record un-hides an now-empty shell, that's
all; documented as such on both services' doc comments.

**Lead-to-deal conversion's inline company/contact creation lives inside
`convertLeadToDeal`'s existing transaction, not as a separate
`createCompany`/`createContact` call beforehand.** Calling the existing
`companyService.createCompany`/`contactService.createContact` first and
then passing the resulting id through would work, but splits one logical
operation ("convert this lead, creating whatever's missing along the
way") across two transactions -- a failure in the deal-creation half would
leave an orphaned Company/Contact nobody asked for. Creating them with
`tx.company.create`/`tx.contact.create` directly inside
`convertLeadToDeal`'s existing `withOrgContext` block keeps "convert" one
atomic unit, at the cost of bypassing `createCompany`'s/`createContact`'s
own duplicate-detection warnings -- acceptable here since the caller is
explicitly asserting "there is no existing record," not asking "is there
maybe one already."

**Inline-created company/contact backfill the Lead itself, not just the
Deal.** Without this, a Lead converted via `newCompany`/`newContact`
would end up permanently showing "(no company/contact)" everywhere else
in the product (its own detail page, any report grouping by company)
even though its Deal clearly has one -- confusing and inconsistent. The
final `tx.lead.update` that stamps `convertedAt` also sets
`companyId`/`contactId` when they were newly created (never overwriting
one the Lead already had).

**GDPR/Kenya DPA erasure is a standalone admin script
(`scripts/erase-data-subject.ts`), never a web route or product
button.** This is a deliberate scope decision, not a shortcut: a real
erasure request needs identity verification and a legal-basis check that
happen entirely outside this codebase (who is this person, are they who
they say, is there a reason to retain some of their data anyway) -- see
`docs/DATA_DELETION_REQUESTS.md` for that process. A self-service "Erase"
button would make it too easy to skip straight past that judgment, the
same reasoning that kept `scripts/notifications-sweep.ts` and
`scripts/db-admin.ts` as scripts rather than routes, just for a much
higher-stakes action. The script itself still runs through the normal
`withOrgContext`-scoped, RLS-enforced connection, not the schema-owner
one -- its only privilege over a logged-in request is that nobody is
logged in.

**Erasure is scoped to Contact only -- Company is explicitly out of
scope, and this is a legal distinction, not a technical limitation.**
GDPR/the DPA protect natural persons' personal data; a Company is a
business entity. Deleting one also hits a real database constraint
either way: `Deal.companyId` is required with `ON DELETE RESTRICT`, so
Postgres itself refuses to delete a Company that still has any Deal --
exactly right, since Deal/financial records usually need to survive for
a different legal reason (tax/accounting) than the one that justifies
erasing a person's contact details. Building Company erasure later would
mean deciding what happens to those Deals first, not a mechanical copy of
the Contact path.

**The erasure audit event is written *before* the delete, not after.**
`AuditEvent.entityType`/`entityId` are plain strings with no FK (so a
row pointing at a since-deleted Contact is valid and expected -- this is
also why `audit_events` is append-only at the database level, see
`prisma/migrations/*_tenant_integrity_and_rls`), but the event still
needs the Contact's own fields (name/email/phone) to be a useful
processing record, and those are only available before the row is gone.

## UI component and e2e test coverage (FIG-602)

**The ticket's premise -- "Playwright is installed" -- was wrong, and
worth checking before writing a single spec.** `package-lock.json`
listed `@playwright/test` only as an *optional peer dependency of
Next.js itself* (its own built-in test-mode support), not an actual
project devDependency -- `node_modules/@playwright` didn't exist.
`npx playwright --version` appeared to work regardless, which is exactly
the kind of false signal that would have led to writing specs against a
tool that silently wasn't really part of this project. Installed for
real: `@playwright/test`, plus `@vitest/coverage-v8` and
`@testing-library/react`/`jest-dom`/`user-event`/`jsdom` for component
tests -- all pinned to versions compatible with the already-installed
`vitest@2.1.9`/`vite@5.4.21` (`@vitejs/plugin-react@^4`, not latest's
`^6`, which requires `vite@^8`).

**Component tests share the existing `vitest.config.ts`, not a second
config file.** The one real wrinkle: the integration suite needs
`environment: "node"` (no DOM, talks to real Postgres) while component
tests need a DOM. Vitest's `environmentMatchGlobs` option assigns
`jsdom` to `tests/components/**` specifically and leaves every other test
file on `node`, in one config, rather than maintaining a second
`vitest.config.ts` + a `vitest.workspace.ts` to stitch them together --
simpler for a project with only four component test files so far.
`tests/components/setupComponentTests.ts` (only applied there, via
`setupFiles`) wires up `@testing-library/jest-dom`'s matchers and
`cleanup()`s the DOM after each test; the integration suite's own
`tests/setup.ts` stays untouched.

**Four components were chosen to cover distinct *shapes* of control, not
just "four forms picked at random": `ArchiveControl`
(simplest -- single-purpose action button with two states),
`MergeControl` (a two-click confirm flow -- state machine, not just a
fetch), `TaskSection` (a list + create form + inline per-row status
change, and a permission-conditional field), `CatalogEditor` (the most
complex -- add form, inline edit, reorder, deactivate, all in one
component). Each test stubs `fetch` (`vi.stubGlobal`) and mocks
`next/navigation`'s `useRouter` rather than hitting a real server --
component tests verify "this control calls the right endpoint with the
right body and renders the response correctly," which is a different
claim from "the endpoint itself behaves correctly" (already the
integration suite's job) or "the whole page works end-to-end" (the e2e
suite's job, below). All three layers exist because each answers a
question the others structurally can't.

**A real, pre-existing UI bug was caught while writing the e2e lead-
conversion spec, not invented for the test to catch.**
`ConvertLeadControl.tsx` (FIG-601) had both of its "use existing company"/
"create new company" radio inputs nested inside one shared `<label>`.
HTML only forwards a label's click to the *first* labelable descendant,
so clicking the "Create a new company" text actually toggled the wrong
radio -- harmless if you click directly on the input itself (most
manual testing does), but broken for anything relying on
label-click-forwarding, including Playwright's own `getByLabel(...).check()`
and a sighted user clicking the text rather than the tiny input circle.
Fixed by giving each radio its own `<label>` (`src/app/o/[orgSlug]/leads/[leadId]/ConvertLeadControl.tsx`).
This is exactly the kind of bug a real browser-driving e2e test catches
that no amount of service-layer integration testing ever could.

**E2E specs use real `/login` (email + password), not `/dev-login`.**
`/dev-login`/`/api/dev-session` are hard-disabled whenever
`NODE_ENV === "production"` (see "Real authentication (FIG-592)," above)
-- and the e2e suite runs against a real `next build`/`next start`, the
same artifact `docs/DEPLOYMENT.md` describes shipping, not `next dev`.
Every seeded dev user already has a real, shared password
(`DEV_FIXTURE_PASSWORD` in `src/auth/devAccounts.ts`) specifically so the
real login form can be used in automation without a secrets dance --
`e2e/helpers.ts#loginAs` drives that form for every spec, including the
login spec itself testing both a success and a wrong-password rejection.

**The lead-lifecycle flow is one chained test, not six separate ones.**
Login, create lead, assign, convert, move stage, log activity, and
complete task are listed in the AC as a sequence because they *are* one
-- splitting them into isolated tests would mean each one reconstructing
all the prior steps' state just to reach its own starting point, for no
real isolation benefit (Playwright already serializes specs with
`workers: 1`). The whole chain runs as Management rather than swapping
sessions between Sales and Management mid-test: Management alone holds
every permission the chain touches (create/assign/convert/edit-all,
company/contact create, activity/task create), so there's no reason to
split the login just to prove ownership moved -- the "assign" step
itself still reassigns to a different real member (`dev.sales@...`) and
asserts the change persisted after a reload, not just that the `<select>`
changed locally.

**Website lead capture gets its own spec because it has no literal page
to click through.** The public endpoint
(`POST /api/public/orgs/[orgSlug]/leads`) exists to be called by an
*external* website's own backend (see README.md, "Website lead
capture") -- there's nothing in this app's own UI that submits to it.
The spec instead drives the real boundary on both sides: generates a
real website API key through the actual Settings UI
(`RegenerateWebsiteKeyButton`, including handling the
`window.confirm()` it shows when a key already exists -- Playwright
dismisses dialogs by default, which would otherwise silently abort the
click), POSTs to the real public endpoint with Playwright's `request`
fixture (a real HTTP call, not a mock), then confirms the resulting Lead
is visible through the real Leads UI. The submitted name is deliberately
one word: the Lead list shows/searches the resulting Contact's *first*
name only (`splitName` in `src/repositories/leadIngestion.ts` splits on
the first space), so a multi-word name wouldn't match in either the
search box or the rendered link text.

**Coverage thresholds were measured, not guessed.** Ran
`npm run test:coverage` once with a placeholder threshold, read the real
numbers (35.77% lines/statements, 61.32% functions, 75.09% branches
across `src/**`), then set the actual thresholds a few points below each
(`vitest.config.ts`) -- comfortably passing today, but a real regression
(someone deleting tests, or adding a large untested module) still trips
it. The low lines/statements number is structural, not a gap to chase
down: most of `src/app/**` (every `page.tsx`, every `route.ts`, every
client component without its own test) reads as 0% in this report purely
because V8 coverage is process-local to whatever ran the code, and that
code only ever actually runs inside the e2e suite's separate Playwright-
driven process -- which this Vitest-level report structurally cannot see,
not because that code is untested in practice. Excluding `src/app/**`
from the coverage `include` entirely was considered (it would make the
percentage look much healthier) and rejected: that's most of the
application, and hiding it from the number would make "coverage
reporting" a cosmetic exercise rather than an honest one.

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

- A self-service "Erase my data" button/route, or Company erasure --
  FIG-601's GDPR/DPA path is a standalone admin script scoped to Contact
  only; see that section above for why both are deliberate.
- Undoing a Company/Contact merge -- restoring a merged record un-hides
  the shell, it doesn't pull back the Contacts/Leads/Deals/etc. that were
  reassigned (FIG-601).
- A full website-lead-assignment rules engine (by source, territory,
  service, etc.) — FIG-599 built a single round-robin/unassigned switch,
  not this; still tracked as FIG-436.
- A management UI for `CustomerLifecycleState` — same shape as the 5
  catalogs FIG-599 covers, but not named in that ticket's AC.
- Full proposal generation/e-signature — `ProposalReference` is reference-
  only by design.
- Multiple simultaneously-valid website API keys, or HMAC-signed webhook
  support as an alternative — revisit if a second real integration
  consumer shows up.
- Self-service account creation/signup, SSO, and login rate-limiting — see
  "Real authentication (FIG-592)," above, for why.
