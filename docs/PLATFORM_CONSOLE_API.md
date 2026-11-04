# Platform console API (FIG-1136, 1137, 1138, 1139, 1141; B6.04 to B6.09)

Builds on `docs/PLATFORM_IDENTITY.md`. Every route goes through `requirePlatformApi(key)`: anyone who is not a platform admin (a tenant Management user included) gets the ordinary 404. All routes are outside the frozen V1 contract (`NOT_IN_V1_CONTRACT`). Migrations `20261105090000` (enum values) and `20261105100000` (tables, views, walls).

## Routes

| Route | Key | Issue |
|---|---|---|
| `GET /api/platform/home` | console.view | B6.07 |
| `GET /api/platform/health`, `GET/POST /health/incidents`, `POST /health/incidents/{id}/resolve` | console.view / health.manage | B6.07 |
| `GET/POST /api/platform/organizations` (filters, paging; provision with `Idempotency-Key`) | organizations.view / .provision | B6.04 |
| `GET /organizations/slug-check?slug=`, `GET /organizations/defaults-preview`, `GET /organizations/{id}` | provision / provision / view | B6.04 |
| `POST /organizations/{id}/status` `{action: suspend/reactivate/offboard, reason}` | organizations.suspend | B6.05 |
| `GET /audit`, `GET /audit/export`, `GET/POST /audit/verify` | audit.view | B6.06 |
| `GET /data-requests`, `GET /data-requests/{id}`, `POST .../decision`, `.../cancel`, `.../retry-export`, `.../delete`, `GET .../certificate` | organizations.view / data_requests.manage | B6.09 |
| `GET/POST /api/cron/platform-maintenance` (CRON_SECRET): audit verification and export purge | secret | B6.06, B6.09 |
| Organisation side: `GET/POST /api/orgs/{org}/privacy/organisation-requests`, `GET .../{id}/download` | `security.manage` | B6.09 |

## Walls

- Platform-owned tables carry organisation ids as plain text with no foreign key, so the record outlives the organisation. RLS is forced on all of them with a policy for `figbloom_platform` only; the tenant role is revoked (`scripts/db-admin.ts` repeats this on every `db:grant-role`).
- Append-only (SELECT and INSERT only for the platform role, triggers refuse UPDATE and DELETE for everyone): audit events, audit verifications, lifecycle events, approvals, certificates.
- The platform role reads tenant facts only through counts views: `platform_organization_counts`, `platform_organization_profile` (timezone, currency, owner contact), `platform_jobs_health`, `platform_email_health`.
- Writes that touch tenant tables (provisioning, status change, export, deletion) run through the schema-owner client in server code after the permission check, never through the platform role.

## Lifecycle (B6.05)

`ACTIVE` to `SUSPENDED` or `OFFBOARDING`; `SUSPENDED` back to `ACTIVE` or on to `OFFBOARDING`; `OFFBOARDING` back to `ACTIVE` unless a deletion is approved; `OFFBOARDED` is final. A reason of 5 to 500 characters is required. Enforcement: `resolveActiveMembership` throws `OrganizationUnavailableError` (403, code `FORBIDDEN`, body `organization: {state, name}`), `claimJob` skips the organisation's jobs, the organisation layout shows the OS1 screen, website and inbound-email keys already required `ACTIVE`.

## Data requests (B6.09)

Intake, approval (EXPORT 1, DELETE 2 different admins), packaging job, 14-day download for the organisation's Management only, 30-day wait (`PLATFORM_DELETION_WAIT_DAYS`, never under 7), deliberate delete call with the slug typed back, certificate (counts only, content hash, append-only). Deletion removes stored files, then the organisation's rows and accounts used only by it in one transaction, and leaves a tombstone row (id, slug, status OFFBOARDED).

## Screens to wire (M14)

`src/ui/screens/platform/demo/`: Home, Organisations, OrgDetail, Provision, DataRequests, HealthAudit. Listed in `docs/RESTRUCTURE_LOG.md`.

## Tests

`tests/platformOrganizations.test.ts`, `organizationLifecycle.test.ts`, `platformHealth.test.ts`, `platformAuditLog.test.ts`, `platformDataRequests.test.ts`, helper `tests/helpers/platform.ts`. Note: `.env` sets `TEST_PLATFORM_DATABASE_URL` to the shared test database, so a test run on another database must also export `TEST_PLATFORM_DATABASE_URL`.
