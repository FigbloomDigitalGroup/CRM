# M17 lane A: support access, flags and limits, announcements (FIG-1183, FIG-1184, FIG-1185)

Backend only. The screens (PL7, PL12, PL13, OS2 to OS5) are on demo data until they are wired; the routes below are what they will call.
All of it is **V2**: every platform route answers the ordinary 404 below release V2 (`requirePlatformV2Api`), and every organisation route is gated
with `release.v2` (`FEATURE_UNAVAILABLE` for an organisation on an earlier release). None of the routes is in the frozen V1 contract
(`src/api/v2OperationsA.ts` lists them as left out, with the reason).

## B7.02 Flags and limits per organisation (FIG-1184)

**Flags.** A platform *override* of one of the organisation toggles in `TOGGLES`. The platform fixes it on or off; the organisation can no longer
change that toggle (`updateFeatureToggles` answers "managed by Figbloom", field code `MANAGED_BY_PLATFORM`). `null` gives the toggle back. An
override never beats the release: a V2 or V1.1 feature stays off in an organisation whose release has not reached it. Saved as one
`organization_settings` row (`platform_flag_overrides`); `loadFeatureConfig` reads it, `resolveFeature` applies it.

**Limits.** `seats`, `storageMb`, `apiCallsPerMonth`; empty means no limit. Saved as one row (`platform_limits`).

| Limit | Counts | Enforced in |
|---|---|---|
| seats | members who are ACTIVE or invited and not yet accepted | `inviteMember` (a new invitation; re-sending a pending one takes no seat), `reactivateMember` |
| storageMb | files that are uploading or ready | `createUpload` (the size the client declares; system-generated files are not blocked) |
| apiCallsPerMonth | calls counted per calendar month (UTC) in `organization_usage_counters` | `recordApiCall(organizationId)`, one atomic statement; **the API-token guard (FIG-805, lane C) must call it** |

Refusals are 403 `FORBIDDEN` (API calls: 429 `RATE_LIMITED`) with a friendly message that says what to do, for example "Your organisation is using
all 3 of its seats. Deactivate a member you no longer need, or ask Figbloom to add seats." A limit set below what is already used removes nothing and
only stops more being added.

**Routes** (platform): `GET /api/platform/organizations/{organizationId}/flags` (flags with default, organisation value, platform value and what is
in force; limits; usage; the last 25 changes) and `PATCH` the same path (`{ flags?, limits?, reason }`; needs `platform.flags.manage`, a fresh second
step and a reason of 5 to 500 characters). Reading and writing go through the schema-owner client for the settings rows and the counts, and return
numbers and switches only (a test asserts no record of the organisation appears).

**Audit.** One platform audit entry per flag or limit changed (`organization.flags.changed`, `organization.limits.changed`, metadata `key`, `from`,
`to`, plus the reason and the actor) and one line in the organisation's own history (`platform_flag.changed`, `platform_limit.changed`, no reason).
Setting a value to what it already is writes nothing.

## B7.03 Announcements and banners (FIG-1185)

`platform_announcements` (platform-owned, no organisation id; RLS forced with a policy for the platform role only; the tenant role has no privilege)
and `announcement_dismissals` (tenant table, RLS on the organisation, one row per member and announcement).

* An announcement has a kind (`MAINTENANCE`, `NEW_FEATURE`, `INCIDENT`), a severity (`INFO`, `WARNING`, `CRITICAL`), a window (at most 90 days), an
  audience (all organisations, or a list of up to 200 existing organisations) and a dismiss rule: `PERMANENT`, `DAILY` (comes back after 24 hours
  while live) or `NOT_DISMISSIBLE`. Unspecified, the rule follows the severity (INFO permanent, WARNING daily, CRITICAL not dismissible).
* Text is plain: title up to 120, body up to 1000 characters, control characters refused, nothing is interpreted as markup anywhere. The body is
  never copied into an audit entry.
* Platform routes (`platform.announcements.manage`; create, change and cancel need a fresh second step): `GET/POST /api/platform/announcements`,
  `GET/PATCH/DELETE /api/platform/announcements/{announcementId}` (DELETE cancels). A cancelled or expired announcement cannot be changed; a live
  one cannot have its start moved.
* Organisation routes (any active member, release V2): `GET /api/orgs/{orgSlug}/announcements` (live, for this organisation, not dismissed under the
  rule; critical first; the target list is never returned) and `POST /api/orgs/{orgSlug}/announcements/{announcementId}/dismiss` (an announcement
  that is not for the organisation is "not found"; a not-dismissible one is refused).
* The tenant feed reads the platform table through the schema-owner client with the organisation id in the query, the same pattern as the data
  requests. This relies on the owner role bypassing row-level security, as the rest of the platform console already does.

## B7.01 Support access, break-glass (FIG-1183)

Requirements R1 to R12 are in `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md` section 5. How each is met:

| # | Met by | Test |
|---|---|---|
| R1 own record | table `support_access_grants`: organisation, requesting admin, reason, ticket, scope, minutes, decision, window | R1 and R2 |
| R2 approval | trigger `support_access_grants_guard` allows PENDING to APPROVED or DENIED only for the tenant side (and the owner), and APPROVED to ACTIVE only for the platform side (inside the `support_access_*` functions); PENDING to ACTIVE does not exist for anyone. One open request per organisation (partial unique index) | "the database itself refuses..." |
| R3 window | 30, 60 or 120 minutes from the moment it is **opened**; `support_access_read` compares the clock on every read; a request lapses after 24 hours, an approval after one hour unopened; the job `support_access.expire` (every 5 minutes) only tidies and notifies; a window cannot be rewritten or extended | R3 |
| R4 read-only | the platform role has **no privilege on the grants table or the page-view log** (they carry an organisation id, so they are tenant tables: `platformIdentityFoundation` still holds) and nothing on any tenant record; it only has EXECUTE on seven `support_access_*` functions (request, list, get, page views, open, end, read); the read function only SELECTs | R4 and R5 |
| R5 masking | the function names its columns. Deals return stage, outcome, company and dates, never value, currency, notes or custom fields; no payment, cost or margin table is touched; notes are not returned for any record. Emails and phones are masked (`j***@x.com`, `***54`) unless the request asked to unmask contact details, which Management approves knowingly (the card shows it). Money is never shown either way | R4 and R5 |
| R6 no `adminDb` | the platform side never uses `adminDb`: every platform read and write is a `SECURITY DEFINER` function (`support_access_request`, `_list`, `_get`, `_page_views_for`, `_open`, `_end`, `_read`) that the platform role may execute and the tenant role may not; the read function sets the organisation context from the grant so row-level security applies to that one organisation. The trigger tells the platform from the tenant by the database role and a transaction marker only those functions set | R6 and R12 |
| R7 logged twice | `support_access_page_views` (append-only, readable by the organisation: who, what, how many rows) and a platform audit entry per read, refused read, request, open and end, each with the reason and the ticket; the organisation's own audit has the lifecycle | R7 |
| R8 step-up to open | `POST .../open` needs a fresh second step; only the admin who asked may open | "the routes" |
| R9 banner and notices | `GET /api/orgs/{orgSlug}/support-access/banner` (every member sees a running session; Management also gets the reason, the ticket and the waiting request); every active Management member is notified (in app, and email under their own settings) when a request arrives, a session starts and it ends | R9 |
| R10, R11 | declared-outage access (B3) is **not built**: it needs the incident marker flow and a two-admin rule and is not in B7.01's scope | n/a |
| R12 isolation | a grant for A returns none of B's records; the platform role cannot read a tenant table; B cannot see or decide A's grants | R6 and R12 |

**States.** `PENDING` to `APPROVED` (Management) to `ACTIVE` (the requesting admin opens it) to `ENDED`; `DENIED`; `CANCELLED` (the admin withdraws);
`EXPIRED`. Management can end a session or withdraw an approval at any moment.

**Routes** (platform, `platform.support.request`, V2): `GET/POST /api/platform/support-access` (request needs a fresh second step),
`GET /api/platform/support-access/{grantId}`, `POST .../open` (fresh second step), `POST .../end` (ends a session or withdraws a request),
`GET .../read?resource=COMPANIES|CONTACTS|LEADS|DEALS|TASKS&limit=&offset=` (up to 50 per page). (Organisation, release V2):
`GET /api/orgs/{orgSlug}/support-access` (history, `security.manage`), `GET .../banner`, `GET .../{grantId}` (with the page-view log),
`POST .../{grantId}/decision` (`{ decision: "approve" | "deny", note? }`), `POST .../{grantId}/end`.

## Decisions taken without being asked (reversible)

1. Duration counts from **opening**, not from approval, so the approver's wait does not eat the window; an approval left unopened for an hour lapses.
2. Scope is a list of five kinds of record (companies, contacts, leads, deals, tasks). Settings, files, notes and anything financial are not
   reachable at all, whatever the scope.
3. "Unmask" covers contact emails and phones only. Money has no unmasked mode.
4. Expiry is a per-organisation job on the job framework (every 5 minutes) rather than a platform-wide sweep; reads never depend on it.
5. Platform overrides can be set for any toggle, including ones whose release has not arrived; they take effect when the release does.
6. Limits sit in `organization_settings`; only API calls need a table (`organization_usage_counters`).
7. Limit refusals reuse the existing error codes (`FORBIDDEN`, `RATE_LIMITED`) because the V1 code list is frozen; the stable field is the message.

## Gaps and notes for the gate (G3.01)

* The OpenAPI v2 operations for these routes are not written: they are listed as left out of the V1 contract. They join the V2 contract at the freeze.
* `tests/apiWalkV11.test.ts`, `tests/tenantAttackV11.test.ts` and the access matrix walk every organisation route: the five support-access routes
  and two announcement routes are new organisation routes, so the matrix JSON and the V2 world need the usual regeneration. The new tables are in
  `EXCLUDED_TABLES` of `organisationExportTables.ts`.
* New migrations: `20261121090000_org_usage_counters`, `20261121100000_platform_announcements`, `20261121110000_support_access`; `scripts/db-admin.ts`
  revokes INSERT and DELETE on grants and all writes on the page-view log from the tenant role (the platform role gets only `platform_announcements`, a
  platform-owned table; `tests/platformIdentityFoundation.test.ts` lists it with the other console tables).
* The functions and the tenant isolation of the grants table rely on the schema owner bypassing row-level security (superuser or `BYPASSRLS`), as every
  other owner-connection operation of the platform console already does.
* Local tests that backdate a grant step around the write-once trigger with `SET LOCAL session_replication_role = replica` (needs a superuser;
  the local and CI database user is one).
* Usage numbers are read live (seats and storage are counted, not cached); fine at this size, cache them if the console polls.
* Not built: declared-outage access (R10), the e-mail wording for the three notices beyond the generic template, and the screens.

Tests: `tests/platformFlagsLimits.test.ts` (13), `tests/platformAnnouncements.test.ts` (12), `tests/supportAccess.test.ts` (20).
