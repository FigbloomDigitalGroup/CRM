# Platform identity foundation (FIG-1135, B6.03)

The Platform Super Admin is a separate identity from every tenant user. It has no organisation, no membership and no tenant permission. It cannot read tenant business data, and the database enforces that, not only the application code. Design reference: PL15.

## What exists

| Piece | Where |
|---|---|
| Identity table (`platform_identities`, now with `status` and `last_sign_in_at`) | migration `20261022140000` (FIG-1196) and `20261104090000_platform_identity_foundation` |
| Session type (`platform_sessions`, hashed token, revocable, 4 h idle and 12 h absolute) | same migration; `src/auth/platformSession.ts` |
| Permission keys (`platform.*`, a catalogue apart from the tenant keys) | `src/auth/platformPermissions.ts` |
| Dedicated database role `figbloom_platform` | migration (created NOLOGIN), `scripts/db-admin.ts` (login, password, grants) |
| Platform database client | `src/db/platformClient.ts` (needs `PLATFORM_DATABASE_URL`; fails closed) |
| Operational counts view `platform_organization_counts` | migration; read by `src/services/platformOverviewService.ts` |
| Routes: `GET /api/platform/me`, `GET /api/platform/organizations` | `src/app/api/platform/` (door: `_lib/platformRoute.ts`) |
| Console door | `src/app/platform/requireConsole.ts` |

## How the walls work

1. **No tenant privilege for the platform role.** (Some platform operations do run on the owner connection; see "Owner-connection operations" below.) `figbloom_platform` holds privileges on exactly three objects: `platform_identities`, `platform_sessions` (select, insert, update, delete) and the counts view (select). `db:grant-role` revokes everything else from it each time it runs, and default privileges grant it nothing, so a new tenant table is denied to it automatically.
2. **RLS as the second wall.** Every tenant table has row-level security forced, and the platform role is never named in a tenant policy. The platform tables have RLS forced too, with a policy for the platform role only; the tenant role `figbloom_app` is revoked from them and has no policy.
3. **Counts only.** The view lists its columns one by one: organisation id, slug, name, status, created date, and counts of members, active members, companies, contacts, leads and deals. No customer name, deal value, payment, cost or free text. It runs as the schema owner (which bypasses RLS, like `adminDb`), so the platform role can see a number without being able to read the rows behind it.
4. **Separate sessions.** A platform session token is looked up only in `platform_sessions`, under the cookie `figbloom_platform_session`. The tenant path (`resolveRequestContext`) never reads that cookie, and the platform path never reads a tenant session. A tenant user, a Management user included, gets the ordinary 404 on every `/api/platform/*` route; a platform admin missing a key gets 403 naming the key.
5. **No data keys.** There is no `platform.*` key that reads a customer record, a deal value, a payment or a cost (DECISIONS 4.7). `platform.support.request` only lets an admin ask an organisation for time-boxed access (B6.12).

## Dev-only things stay dev-only

The dev Super Admin (FIG-1196) still signs in with the dev cookie, only when `NODE_ENV=development` and `ALLOW_DEV_ACCOUNTS=true`. `resolvePlatformContext` tries a platform session first, and a bad platform session is never rescued by the dev cookie. The production boot guard is unchanged. Nothing in this issue creates a platform identity in production (no migration or production seed inserts one).

## Setting it up

Add to `.env` (see `.env.example`): `PLATFORM_DB_PASSWORD`, `PLATFORM_DATABASE_URL`, `TEST_PLATFORM_DATABASE_URL`. Then `npm run migrate:deploy`, `npm run db:bootstrap-role` and `npm run db:grant-role` (or `npm run db:setup`). The test run derives its platform URL from `TEST_DATABASE_URL` when `TEST_PLATFORM_DATABASE_URL` is not set, so existing CI needs no change. In production the password comes from the secret manager.

The schema owner must bypass RLS (it already has to, for `adminDb`); the counts view relies on that.

## Owner-connection operations

The platform database role has no tenant privilege, but a few platform-console operations cannot work with that: they have to read or change tenant rows across organisations, so they run through `adminDb`, the schema-owner connection that bypasses RLS. Authorisation for them is the application check (`requirePlatformApi` with the named `platform.*` key, plus "verify it's you" where noted), not the database. They are not SECURITY DEFINER functions yet. The G2.02 security review should look at exactly this list:

| Operation | Code | Why it needs the owner connection | Extra guard |
|---|---|---|---|
| Organisation export (`buildOrganisationExport`, job `platform.org_export`) | `platformDataRequestService.ts` | reads every `organization_id` table of one organisation | allow-list of tables (`organisationExportTables.ts`, kept complete by a test); secrets redacted; only the organisation's Management can download |
| Deletion (`executeDeletion`) | `platformDataRequestService.ts` | removes an organisation's rows and files, keeps a tombstone | two distinct approvers, 24-hour credential-reset rule, waiting period, slug typed back, row locks, verify it's you |
| Decision, cancel, retry export (`decideDataRequest`, `cancelDataRequest`, `retryExport`) | `platformDataRequestService.ts` | read and write `platform_data_requests` and the organisation's status | verify it's you |
| Suspend, reactivate, offboard (`transitionOrganization`) | `organizationLifecycleService.ts` | changes `organizations.status` and ends the organisation's sessions | verify it's you |
| Organisation profile and audit entries (`platformOrganizationService`) | `platformOrganizationService.ts` | reads organisation profile data beyond the counts view | read-only except the audit entry |
| Platform admin preferences (`platformPreferenceService`) | `platformPreferenceService.ts` | writes the admin's own `ui_mode` | own identity only |

## Tests

`tests/platformIdentityFoundation.test.ts`:

- Platform to tenant: the role is not a superuser and not BYPASSRLS; it holds privileges only on its three objects; it is refused (select, update, delete) on every tenant table; it stays refused when it sets a tenant context itself; it cannot grant itself access, change its role or switch to the app role; the counts view matches the data and exposes no values.
- Tenant to platform: the app role is refused on the platform tables and the view; platform tables have RLS forced with a policy for the platform role only; a tenant session or cookie gives no platform context; a platform session gives no tenant context; `/api/platform/*` is 404 for signed-out callers and for tenant users.
- Sessions: hash only at rest, sign-out, revoke, suspend, idle and absolute expiry, sliding never past the limit, cascade on delete.
- Keys: all `platform.*`, none in the tenant catalogue or database, none that reads customer data, none held by a suspended identity.

## Not in this issue

- Real platform sign-in (password plus two-step) and the sign-in route: B6.02 (FIG-1134) builds two-step sign-in and B6.08 (FIG-1140) the admin lifecycle. `createPlatformSession` is the call they use after a verified sign-in. Until then the only way in is the dev Super Admin.
- Platform audit log (B6.06, FIG-1138), provisioning and org detail (B6.04, FIG-1136), minimum-two-admins and recovery (B6.08).
- The new routes are left out of the frozen V1 contract (`NOT_IN_V1_CONTRACT`), like `/api/platform/preferences`.
