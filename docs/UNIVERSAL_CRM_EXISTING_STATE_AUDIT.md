# Universal CRM: existing-state audit

Read-only audit of the FigBloom CRM before any "universal CRM" work. This is a report only. No application code, schema, migration, configuration or existing document was changed.

- Repository inspected: `C:\Users\Admin\Documents\Projects\figbloom-crm-m13` (the brief named `...\figbloom-crm`; this is the working copy the session ran in).
- Branch and commit: `makeover/p2-26-lead-import-lenient`, HEAD `3cf770c`. The working tree already had uncommitted edits (CI, backup docs, migration guard scripts) that are not part of this audit.
- Audit date: 18 Nov 2026.
- Method: static reading of schema, migrations, routes, services, screens, tests and docs by five parallel read-only reviewers, plus my own spot-checks. `npm run typecheck` and `npm run lint` were run and passed (no output). **No test suite was run** (section 12).
- Labels: **UNKNOWN** means not verified. "Verified" means read in code. Nothing here comes from running the app.
- Status scale for capabilities: 1 Fully implemented, 2 Partial, 3 Backend done / frontend incomplete, 4 Frontend present / backend incomplete, 5 Documented or planned only, 6 Not present, 7 UNKNOWN.

---

## 1. Executive summary

**What the system is.** A mature, multi-tenant CRM for a Kenyan services business (leads, deals, customers, finance status, renewals, quotes, chat, mail, assistant, platform console). It has 135 Prisma models, 96 migrations, about 387 tenant API routes, 221 Vitest files and 45 Playwright specs. It is live on Vercel and Neon as an MVP with fake data.

**Five most important findings**

1. **The tenant engine is real; the industry is hard-coded.** Organisations, memberships, forced row-level security (RLS), per-org custom fields, per-org pipelines and per-org feature toggles all exist. But every new organisation is seeded with the same 14 IT/ISP services and their qualification questions, the same lead sources, statuses and stages, and `Africa/Nairobi` / `KES` defaults. `seedOrganizationDefaults` (`src/services/organizationDefaults.ts`) takes no industry parameter. It is the natural hook for industry templates.
2. **Roles are fixed and single-valued; there are no departments.** Five global system roles. A membership holds exactly one role. There is no Department or Team model and no team-scoped access. Custom roles exist in the backend but are gated to release V2 and their editor screen is demo-only and unlinked. "Management decides who can sell" is possible only through a custom role.
3. **There is no module architecture.** No module registry, no dependencies, no plan or entitlement model. Core modules cannot be switched off. Only a few optional features have toggles (`quotes.enabled`, `communication.group`, `assistant.enabled`, `integrations.enabled`, `organisation.switcher`), and there is no settings screen for them (API only).
4. **Tenant isolation is strong in design but leans on the owner connection.** 136 source files import `adminDb` (the schema-owner client). About 95 call sites touch tenant tables there, so isolation depends on each query's own `organizationId` filter, not on RLS. The AWS move also depends on the owner role bypassing forced RLS, which is not true of a normal RDS owner (open item, not tested).
5. **Schema and contract are extensible only additively, and several keys are baked into code.** Business concepts are native Postgres enums (`CustomFieldEntity`, `LeadTemperature`, `DealOutcome`, `TaskType`, and others). Code switches on status and stage keys (`QUALIFIED`, `CONVERTED`, `CLOSED_WON`, and others). A Deal must have a Company. The API contract is frozen at 1.1.0 (additive changes only, checked by hash). Many foreign keys and RLS policies exist only in hand-written migration SQL, not in `schema.prisma`.

**Most serious risks to existing functionality** (detail in sections 11 and 14)

- Any change to `Deal.companyId`, `CustomFieldEntity`, status/stage keys or the five-role matrix touches the frozen contract, 28 to 34 UI files per concept, the walk tests and the mobile offline sync.
- New tenant tables need hand-written composite foreign keys and RLS. Prisma will not generate them.
- The Neon MVP is probably 6 migrations behind the repo (UNKNOWN: current state). Real customer data is explicitly not allowed yet (`docs/REAL_DATA_READINESS.md`).
- Account pre-registration by public signup with no email verification (finding S-3).
- The suite has not been proven since the M19 work.

---

## 2. Repository and technology overview

| Area | Finding | Evidence |
|---|---|---|
| Frontend | Next.js 15 App Router, React 19, TypeScript | `package.json`, `src/app/**` |
| Data fetching and state | `@tanstack/react-query` v5; screens call `useApiQuery("<operationId>")` over a generated typed client; no direct `fetch` allowed (lint rule plus `tests/noDirectFetch.test.ts`) | `src/ui/data/hooks.tsx`, `src/ui/data/client.ts`, `src/api-client/` |
| Backend | Route handlers, then `handleRoute`, then `resolveRequestContext`, then service (about 190 files), then repository (about 70), then `withOrgContext` | `src/app/api/_lib/handleRoute.ts`, `src/services/*`, `src/repositories/*` |
| Database | PostgreSQL, Prisma 5.20, 135 models, 96 migrations | `prisma/schema.prisma`, `prisma/migrations/` |
| Validation | Zod v4 DTOs are the source of truth; OpenAPI is generated from them; custom field values validated by `src/lib/customFields.ts` | `src/api/dto/*`, `src/api/openapi.ts`, `src/api/respond.ts` |
| Auth | Opaque session token (SHA-256 hashed in `sessions`), httpOnly cookie `figbloom_session`, org-policy lifetime 4 to 24 h; two-step sign-in (TOTP, backup codes, trusted devices); separate platform identity and sessions | `src/auth/session.ts`, `src/auth/requestContext.ts`, `src/auth/twoStep/*`, `src/services/authService.ts` |
| Testing | Vitest 5 (projects `node` and `components`, real Postgres via `tests/globalSetup.ts`), Playwright (chromium, mobile, firefox, webkit) | `vitest.config.ts`, `playwright.config.ts` |
| Deployment | Dockerfile (node:22-alpine), four compose files, Vercel (`vercel.json`, region fra1, daily crons), Neon free Postgres, GitHub Actions | `Dockerfile`, `docker-compose*.yml`, `vercel.json`, `.github/workflows/` |
| Integrations | SMTP or Resend email; Google and Microsoft OAuth for mail and calendar (code complete, apps not registered per `docs/LATER_VERSIONS.md`); web push (VAPID); Anthropic assistant (optional, default off); S3-style storage driver; ClamAV (`CLAMD_HOST`, MVP opt-out); Sentry; pino and Prometheus | `src/integrations/*`, `src/assistant/provider.ts`, `src/storage/*`, `src/instrumentation.ts` |
| Background jobs | Own job framework: `registerJob`, leased queue with `FOR UPDATE SKIP LOCKED`, backoff, DEAD state; entry points `/api/cron/{jobs,notifications-sweep,platform-maintenance}` with `CRON_SECRET`; optional `npm run jobs:worker` | `src/jobs/registry.ts`, `src/jobs/runner.ts`, `scripts/jobs-worker.ts` |

Notes:
- `@anthropic-ai/sdk` is loaded dynamically and is not in `package.json` dependencies (`src/assistant/provider.ts`).
- Vercel crons are daily; `docs/JOBS.md` requires 5-minute calls, filled by an external cron-job.org account (DECISIONS 7.5). UNKNOWN whether it is running.

---

## 3. Current application architecture

**Request path.** `src/middleware.ts` does only request id and CSRF (Origin/Referer on `/api/{orgs,auth,me,session,platform}`). It has no tenant or authorisation logic. Tenant comes from the URL slug (`/o/{orgSlug}`, `/api/orgs/{orgSlug}/...`). `resolveRequestContext(slug)` (`src/auth/requestContext.ts`) finds the session user, loads the org by slug via `adminDb`, calls `resolveActiveMembership` (`src/repositories/memberships.ts`, raw SQL, ACTIVE memberships only), and throws `OrganizationUnavailableError` for suspended, offboarding or offboarded orgs. The resulting `AuthContext` (role key, permission keys, organisation id, membership id) is all a service receives.

**Three database clients (`src/db/`).**
- `orgScopedClient.ts`: `withOrgContext(orgId, fn)` runs a transaction with `set_config('app.current_organization_id', ...)` as role `figbloom_app` (no superuser, no BYPASSRLS). Fails on empty id.
- `adminClient.ts`: `adminDb`, schema owner (`DATABASE_URL`), bypasses RLS under current hosting.
- `platformClient.ts`: `getPlatformDb()`, role `figbloom_platform`, limited to platform tables, views and support-access functions; fails closed.
- `appRoleGuard.ts` refuses to boot staging or production without `APP_DATABASE_URL`.

**Frontend.** Thin pages in `src/app/o/[orgSlug]/*` (about 30 areas) render screens from `src/ui/screens/<area>/`. The shell (`src/ui/shell`) builds navigation per permission keys (`buildNav`). `src/app/o/[orgSlug]/layout.tsx` loads member context (role, permission keys, feature flags) and wraps `MemberProvider`, `ApiProvider`, `ThemeProvider`, `AppShell`. PWA and offline sync exist (`public/sw.js`, `SyncMutation`, `src/services/syncService.ts`).

**API conventions** (`docs/API_CONVENTIONS.md`, checked against code):
- One error envelope (`src/lib/apiErrors.ts`).
- Pagination is offset-based; the "cursor" wraps the page number (`src/lib/pagination.ts`).
- Idempotency keys (`src/lib/idempotency.ts`, 24 h TTL): docs say "leads so far". Coverage of other creates is UNKNOWN.
- The contract is frozen at 1.1.0 in `src/api/contract/openapi.v1.json` (407 paths). `tests/apiContract.test.ts` requires the generated spec to equal the file, its sha256 to appear in `docs/API_CHANGELOG.md`, and the generated client to match. Additive changes are minor; removals, narrowing and new required fields are breaking.
- A separate public API (`/api/v1/*`, `fbk_` tokens) has its own OpenAPI document.

**Release gating.** Three trains (`release.v1`, `release.v11`, `release.v2`) from `ACTIVE_RELEASE` (default v1, per-org override in `OrganizationSetting`). UNKNOWN: production value (`docs/DEPLOYMENT.md:583` plans `v1.1`). V2 features are built and hidden.

---

## 4. Complete CRM module inventory

Evidence is schema model, API routes (under `src/app/api/orgs/[orgSlug]/`), service (`src/services/`), screen (`src/ui/screens/`) and test (`tests/`). A test file existing does not mean it passes.

### Sales core
| Capability | Class | Evidence and gaps |
|---|---|---|
| Leads | 1 | `Lead`, `LeadSource`, `LeadStatus`, `LeadPoolRequest`; `leads/*` routes (convert, qualification, score, pool, import, export, key notes); `leadService`, `qualificationService`; screens `leads/*`. Gap: `q:` qualification columns export but do not import. |
| Contacts | 1 | `Contact`; `contacts/*`; `contacts/*` screens; `contactService`, `mergeDuplicates` tests. |
| Companies / accounts | 1 | `Company`; `companies/*` (360, health, lifecycle, merge, import); `customers/*` screens. |
| Deals | 1 | `Deal`; `deals/*` (board, move, handoff, proposals, undo); `deals/*` screens; `dealRules`, `dealGateBypass` tests. |
| Sales pipelines | 1 (V1.1 gated) | `Pipeline`, `PipelineStage`, `PipelineService`, `StageRule`; `pipelines/*`; `settingsplus/Pipelines.tsx`; multiple pipelines per org. Stage rule types fixed in code (`src/lib/stageRules.ts`). |
| Activities | 1 | `Activity`; `activities`; `LogActivityDrawer`, `QuickLogPrompt`. |
| Tasks and reminders | 1 | `Task`; `tasks/*`, `reminder-settings`; `tasks/*` screens incl. calendar. |
| Customer history | 1 | `companies/{id}/360`; `customer360Service`; timeline and conversations. |
| Customer lifecycle | 2 | `CustomerLifecycleState`, `LifecycleEvent`; `lifecycleService`. Settings edit only timings. State keys hard-wired (`lifecycleService.ts:41-63`). |
| Search | 1 | `search`, `commands`; `searchService`; palette. |
| Comments, attachments, tags, follows | 1 | `Comment`, `Attachment`, `Tag`, `RecordFollow`; `extras/*`; antivirus guard. |
| Notifications | 1 | `Notification*`; centre, preferences, push and email. |
| Saved views | 1 | `SavedView`, `SavedViewPin`; `views/*`. |
| Mobile, PWA, offline sync | 1 | `sync/*`, `pwa/*`, `/o/{org}/m`; card and quick capture. |
| Team page | 1 | `team/*`. |

### Delivery and after-sale
| Capability | Class | Evidence and gaps |
|---|---|---|
| Projects and delivery | 2 | **No Project model** (verified in schema). Only `DealHandoff`, handoff screens, an onboarding-task template and one automation. No milestones or delivery tracking. |
| Customer support | 6 in CRM, by decision | Role and ticket tables removed (migration `20261120090000_remove_customer_support`; DECISIONS decision 12). Email path to Figbloom (`support-requests`, `docs/SUPPORT_BY_EMAIL.md`) is class 1. UNKNOWN: Resend key configured. |
| Customer success | 3 | Backend `ChurnHint`, `churnHintService`, `churn-hints/*`, `companies/{id}/health`. No dedicated screen found. |
| Finance and payment tracking | 1 | `Invoice`, `PaymentRecord`, `DealPaymentNote`; status only, "nothing is processed". Deposit request (B7.05) cancelled. |
| Products, services, catalogue | 1 | `CatalogueItem`, `Service`; `settingsplus/Catalogue.tsx`. |
| Renewals | 1 | `RecurringService`; `engage/RenewalsScreen`; renewals report. |
| Conversations | 1 | `conversations/*`, inbound email routes; `engage/ConversationsScreen`. |
| Reporting and analytics | 1 | `reports/*`, `reports/v2/[report]`. Dashboard sections are fixed by permission (`dashboardService.ts:26`), not user-configurable. |
| Quotes and e-sign | 1 | `Quote*`, `QuoteSignature`, `ApprovalRequest`; public `quotes/[token]` and `sign/[token]`. UNKNOWN whether `src/app/sign/[token]/demoSigning.ts` is live. |
| Chat | 1 | `Chat*` models, polling (no websocket). Known gaps: mute, sidebar unread badge; needs a live-DB test (RESTRUCTURE_LOG:89). |
| Mail and calendar sync | 2 | `OAuthConnection`, `MailDraft`, `CalendarEventLink`. Real providers never run (OAuth apps not registered). Preview truncated, no attachments or templates. |
| Sequences | 1 | `FollowUp*`; `settingsplus/Sequences.tsx`. |
| Forecast | 1 | `SalesTarget`; still imports `commercial/demo/*` for some types (UNKNOWN if values are demo). |
| Assistant | 1, off by default | `assistant.enabled` V1.1, off. Drafts only (hard rule 9). |
| Web forms | 1 | `WebForm*`; public form routes; website key capture; assignment rules. |

### Administration
| Capability | Class | Evidence and gaps |
|---|---|---|
| Organisation settings | 1 | About 25 Settings tabs, Management only (`settings/SettingsScreen.tsx`). Default currency has no UI field. |
| User management and invitations | 1 | `memberships/*`; accept-invite flow (frozen page). |
| Roles (fixed five) | 1 | `prisma/seedData.ts`. |
| Custom roles | 3 | Backend `roles/*`, `roleEditorService`, gated `release.v2`; `settingsplus/Roles.tsx` on demo data, not linked. |
| Audit logs | 1 | `audit/*`, `AuditEvent`, `settings/AuditLog.tsx`. |
| Feature flags | 2 | `GET/PATCH /features`; no org-facing toggle editor found; platform flags UI hidden as V2. |
| Data import and export | 1 | Leads, contacts, companies; `data-runs/*`; approvals. |
| Data migration | 1 | `data-migration/*`; `settings/Migration.tsx`. |
| Integrations | 1 / 2 | Settings screens, website key, inbound email; WhatsApp click-to-chat depth UNKNOWN. |
| API tokens, webhooks, public API | 3 | Backend and tests present; `settingsplus/Developers.tsx` demo and unlinked; V2 gated. |
| Platform console | 1 (V1.1), V2 parts 3 | Organisations, provisioning, offboarding, data requests, platform audit, admins. Support access, announcements, per-org flags hidden. |

**Demo data.** Only `settingsplus/{Roles,Developers}.tsx` and `platform/store.tsx` import `demo/` modules, all V2 or parked. `docs/DATA_FLOW.md` still says Chat, Mail and Video use demo data, which contradicts the schema.

---

## 5. Organisation and multi-tenancy architecture

| Item | Finding | Evidence |
|---|---|---|
| Tenant root | `Organization`: unique slug, status ACTIVE / INACTIVE / SUSPENDED / OFFBOARDING / OFFBOARDED, profile columns incl. `timezone` default `Africa/Nairobi`, `defaultCurrency` default `KES` | `prisma/schema.prisma:40` |
| Identity | `User` is global (unique email, nullable password hash, no organisation id) | `schema.prisma:151` |
| Membership | The tenant boundary. `@@unique([organizationId, userId])`; one role per membership; status ACTIVE / INACTIVE / PENDING / REMOVED | `schema.prisma:335` |
| Multi-org users | Several ACTIVE memberships, one per org, each with its own role | `src/services/organizationSwitcherService.ts` |
| Org switching | `POST /api/me/organizations/switch`; requires ACTIVE membership and org; both unknown and non-member return 404; audited in both orgs. The session's `organizationId` is a hint only; authorisation never reads it | `src/services/organizationSwitcherService.ts` |
| Org creation | Platform staff only: `POST /api/platform/organizations` (`platform.organizations.provision`) or `scripts/provision-organization.ts`. **No self-service organisation creation.** Public signup creates a bare user ("awaiting access") | `src/services/organizationProvisioningService.ts`, `authService.signup` |
| Tenant resolution | URL slug, `resolveRequestContext`; no subdomain or custom-domain resolution (UNKNOWN whether planned) | `src/auth/requestContext.ts` |
| Tenant-scoped data | Business tables carry `organizationId` with `onDelete: Cascade`; most have `@@unique([organizationId, id])` and hand-written composite FKs `(organization_id, parent_id)`, so cross-org references are rejected by the database | migration `20260924081100_tenant_integrity_and_rls` |
| RLS | Forced `tenant_isolation` policy on `app.current_organization_id`, with `WITH CHECK`. 57 migration files enable RLS; docs claim 117 tables. `audit_events` also allows NULL-org rows. Two-step secret tables and platform tables use owner-only or `figbloom_platform`-only policies and are revoked from `figbloom_app` | migrations `20261105100000`, `20261105110000`, `20261118090000` |
| Jobs | `background_jobs.organization_id`; handlers receive `ctx.organizationId`; claim query is cross-org on `adminDb` and skips suspended and offboarded orgs | `src/jobs/runner.ts` |
| Reports, exports, files | Org-scoped raw queries read include `organization_id = ...` inside `withOrgContext` (customerReports, signals, duplicates, search, invoices, chat, team). Storage keys `orgs/<orgId>/...` enforced by constraint `files_storage_key_prefix_check`; signed blob tokens bind method, key, expiry and size | `src/services/*`, `src/storage/*` |
| Platform access to tenants | Separate identity, sessions, DB role and cookie. Only read path to tenant records is break-glass support access (SECURITY DEFINER functions, org approval, fresh second step, 30 to 120 min window, column allow-list, page-view log) | migration `20261121110000`, `src/services/supportAccessService.ts` |

---

## 6. Departments, roles and permissions

**System roles.** Five global roles seeded from `prisma/seedData.ts`: MANAGEMENT, SALES, DELIVERY, FINANCE, RESTRICTED_TECHNICAL (about 97 permission keys). The role names are hard-coded in `src/auth/permissions.ts`, `src/api/mockServer.ts:22`, `src/ui/data/source.ts:28`, `accessMatrix*.json` (five-character rows) and `tests/fixtures/roleFamilies.ts`. There are no Marketing, Support, Success, Sales Lead or Viewer roles (the last three are deferred in DECISIONS 4 #9, #10, #12).

**Departments.** **Absent.** No Department or Team model. The only `department` column is free text on `Contact`. Marketing, Support and Success are not represented anywhere. Sales, Delivery and Finance exist only as role names.

**One role per membership.** `Membership.roleId` is a single required FK. A person who is both Sales and Finance needs a combined custom role.

**Custom roles.** Backend exists (`Role.organizationId`, `roleEditorService.ts`, `src/lib/roleLimits.ts`, `roles/*` routes), gated by `release.v2`, needs `roles.manage` (Management only). Limits: 25 live custom roles per org; reserved keys never grantable (`organization.manage_settings`, `membership.manage`, `role.assign`, `roles.manage`, `configuration.manage`, `security.manage`, `audit.view`, `export.bulk`, `api_tokens.manage`, `webhooks.manage`, `ai.configure`, payment keys, `deals.margin`); a role in use cannot be archived. UI: demo only, not linked. Note `Role.key` is globally unique even for org-owned roles, so two orgs cannot share a custom role key.

**Who may sell.** There is no "can own leads/deals" flag. Eligibility is derived from permission keys (`src/services/ownerEligibility.ts`: `canWorkLeads`, `assertEligibleLeadOwner`, `listDealOwnerCandidates`). That is department-independent, but changeable only via a custom role (V2, no UI). `WebsiteLeadAssignmentRule` (round-robin) exists. Head of Sales is absent (`src/auth/teamAccess.ts` says it may be added). Five per-org `departure.*` toggles vary the system roles (for example won-only visibility for Delivery and Finance).

**Backend enforcement.** Routes call `requirePermission`, `resolveScope`, `assertRecordVisible`; list filters in `src/auth/visibilityWhere.ts`; membership is re-read per request. UNKNOWN whether every route calls a guard; `tests/apiWalk*.test.ts` walk every route per role against `accessMatrix*.json` (not run).

**Frontend gating.** `buildNav` and `useMember().can(key)` use the same permission keys as the API. Release gating strips keys (`PERMISSION_MIN_RELEASE`), but toggle-off (for example `quotes.enabled`) does not strip keys, so links may remain and lead to an explained error page. UNKNOWN until checked in a running app. `mail.use` and `meetings.schedule` enforcement is listed open (`docs/M13_CLOSEOUT.md`).

**Field and record level.** Record scopes (all, own, shared, won) per resource, 404 on invisible records. No team or hierarchy scoping. `RoleFieldRule` supports only `deal.value` (all, own, hidden); other fields have no masking surface (DECISIONS 9.2). Custom fields have no per-role visibility.

**Financial masking.** `src/auth/masking.ts` (`canSeeDealValue`, `canSeeMargin`, `maskDeal`, `redactMoneyText`, ...) covers lists, detail, board, audit snapshots, quotes, search, notifications, comments, exports, reports, Customer 360. Payments need `finance.view.payments`. Possible weaknesses from code reading (not proven): `redactMoneyText` is regex-limited to KES, KSH, USD, EUR, GBP, UGX, TZS, RWF, $, €, £, so other currencies and bare amounts are not redacted; `textForViewer` and `canSeeAggregateValue` ignore the `hiddenFields` rule.

**Role-specific homes.** `GET /dashboard` returns only the sections the role may see; `Home.tsx` lays out Sales Today, Management, Delivery, Finance, My work. How a custom role gets a home layout is UNKNOWN.

**Fit for a department model.** The engine (permission keys, custom roles, owner eligibility) can express any department's access. What is missing: org structure (departments or teams), multi-role memberships, team-scoped visibility, a real custom-role UI, and role templates by industry.

---

## 7. Module and feature configuration

| Layer | What exists | Evidence |
|---|---|---|
| Release flags | `release.v1`, `release.v11`, `release.v2` from `ACTIVE_RELEASE`; per-org override in `OrganizationSetting` key `release_override` (script-only `setOrganizationRelease`) | `src/lib/featureFlags.ts`, `src/lib/featureConfig.ts` |
| Org toggles (`TOGGLES`) | `integrations.enabled`, `personalisation.allowed`, `preferences.own_colours`, `permissions.provisional_departures`, five `departure.*`, `assistant.enabled` (default off), `organisation.switcher`, `quotes.enabled`, `communication.group`. Stored under `feature_toggles`. API: `PATCH /api/orgs/<org>/features` | `src/services/featureService.ts` |
| Platform overrides | Per-org fixed values (`platform_flag_overrides`) and limits (seats, storage, API calls) | `src/services/platformFlagsService.ts`, `orgLimitService.ts` |
| Enforcement | `requireFeature`, `resolveGatedContext(orgSlug, key)`; disabled returns 403 `FEATURE_UNAVAILABLE` with reason and `availableIn`; unknown keys fail closed | `src/app/api/_lib/gatedContext.ts` |
| Plan or entitlement | **Absent.** No `Plan`, `Subscription` or `Entitlement` model | schema search |
| Module registry | **Absent.** No module model, list or dependencies | |

Answer to "can organisations select only the modules they need?": **No.** Leads, deals, tasks, contacts, companies, payments, renewals, handoffs and reports are always on. Only the optional features above can be switched. Toggle definitions are code-defined. What happens to existing quotes or chat data when a toggle is turned off is UNKNOWN. No org-facing toggle editor was found. Personal sidebar hiding exists (`preferences.sidebar.hidden`).

---

## 8. Customisation capabilities

**Admin-configurable (UI plus API, per organisation)**
- **Custom fields.** `CustomFieldDefinition` on LEAD, CONTACT, COMPANY, DEAL only. Types TEXT, NUMBER, DATE, SELECT, MULTISELECT, BOOLEAN. Sections GENERAL or QUALIFICATION, `required`, `requiredOnQualify`, service link, max 100 per entity. Key pattern `^[a-z][a-z0-9_]{0,49}$`. Values in a `customFields Json` column on those four tables. No custom entities, relations, lookup, URL, email or currency types. No fields on tasks, activities, quotes or invoices.
- **Reference data** (`reference-admin/[kind]`, `settings/ReferenceData.tsx`): lead sources, lead statuses, lost reasons, services, lifecycle states (rename only; engine keys protected), tags, email templates.
- **Pipelines**: multiple, create, rename, default, reorder, stages, service links, stage rules (three fixed types: `QUOTE_REQUIRED`, `REQUIRED_FIELDS`, `APPROVAL_REQUIRED`), approval rules.
- **Other**: email templates with merge fields, web forms, sequences, website assignment rules, handoff onboarding template, org profile and working hours, saved views (per user, shareable).

**Developer-only**
- Role definitions and the permission matrix; release and toggle definitions; the automation catalogue (8 code-defined rules; admins can only toggle and tune parameters; there is no workflow builder); `StageRule` types; dashboard sections and report list; all Postgres enums; protected reference keys.
- Scoring weights: route `scoring/weights` exists, UI UNKNOWN.

**Hard-coded business assumptions that hinder other industries**
1. `organizationDefaults.ts` seeds 14 services (Accounting, HR, CRM, Inventory, Property Management, Fleet/GPS, CCTV, Starlink/Internet, ISP Billing, Web Development, Branding, Social Media Management, Automation Systems, Consulting) with matching qualification questions (`src/lib/qualificationDefaults.ts`).
2. Default stages Solution Presented, Proposal Sent, Negotiation, Closed Won, Closed Lost; lead statuses NEW, QUALIFIED, CONTACTED, NEEDS_IDENTIFIED...; 15 lead sources (Facebook, TikTok, WhatsApp, ...); pipeline named "Sales" (created by DB trigger).
3. Code switches on keys: lead status keys (`leadService.ts:72,164,280`, `qualificationRules.ts:14-15`, `src/lib/sequences.ts:100`), stage and lifecycle keys. An org that renames or removes them can break flows.
4. Native enums: `ActivityType`, `TaskType` (includes `VISIT`, `QUOTE`), `CommunicationChannel`, `LeadTemperature`, `DealOutcome`, `RecurringBillingCycle`, `RenewalState`, `InvoiceStatus`, `CustomFieldEntity`, `CustomFieldType`.
5. B2B model: a Deal requires a Company (`Restrict`); one deal per lead (`@@unique([organizationId, leadId])`); revenue is quotes, invoices, recurring services and renewals.
6. Locale: `KES` and `Africa/Nairobi` defaults on `Organization` and `Deal.currency`; helpers named `kes()`; budget bands KES-scaled; languages en and sw only; about 28 source files mention Nairobi, KES or M-Pesa.
7. Terminology: "Handoff / Delivery", "After the sale", Figbloom branding in sidebar, auth hero and help content (`src/ui/copy.ts`, `src/lib/helpContent.ts`).

---

## 9. Onboarding architecture

Traced path:
1. **Create org.** Platform console `platform/Provision.tsx`, `POST /api/platform/organizations`, `platformOrganizationService.ts:310`, `provisionOrganization`. Sends only name, slug and first admin (name, email); no region, currency or list edits.
2. **Provisioning.** Validates slug, creates `Organization`, runs `seedOrganizationDefaults(org.id)`, finds or creates the `User`, upserts a PENDING MANAGEMENT membership with a hashed invite token, sends the invite (logs the link without SMTP), writes audit `organization.provisioned`. **Not transactional or resumable**: a failure midway leaves a half-created org and a re-run fails on the taken slug (documented in the service header). The platform audit entry is written after commit (known gap, `docs/M13_CLOSEOUT.md`).
3. **Defaults.** Seeds 15 lead sources, 8 statuses, 5 stages, 6 lifecycle states, 11 lost reasons, 14 services, qualification questions as custom-field rows, a website lead assignment cursor. Pipeline "Sales" comes from DB triggers (`20261107130000_pipelines_and_stage_rules`). A `fillOnly` backfill mode exists; `seedOrganizationDefaults` must not be re-run on an existing org otherwise.
4. **Roles and permissions** are global rows, seeded once per database by `prisma/seed.ts`; provisioning fails with "Unknown role" on an unseeded database. Feature toggles, release and automation rules need no per-org rows (code defaults).
5. **Accept invite.** Frozen page `src/app/accept-invite`, `authService.acceptMembershipInvite`; sets a password only if none exists; honours two-step; rate-limited.
6. **Self signup** creates an account only, with no organisation access.
7. **Wizard or checklist.** **None** in the tenant UI (only a first-run checklist fragment in `home/roles.tsx` and help content). The first admin lands on the dashboard and configures everything manually across about 25 Settings tabs. There is no test for the first-run flow.
8. **After setup.** Management can configure profile, working hours, members and roles (the five), reference lists, custom fields, pipelines, catalogue, templates, sequences, forms, automations, integrations, lifecycle timings, security policy, retention, migration and import. Not in Settings: default currency, feature toggles, roles editor, API tokens, webhooks.

**Extension fit.** A guided wizard can be built as new routes after provisioning. The provisioning hook already generalised a hard-coded seed (code comment), so an `industry` or `template` parameter on `seedOrganizationDefaults` is the most direct extension point. Provisioning would first need to become transactional or resumable. Auth pages are frozen, so any new first-run steps must be new routes.

---

## 10. Database and data relationships

- 135 models; business tables carry `organizationId` (`Cascade`; 117 Cascade, 14 Restrict, 35 SetNull across the schema, as reported).
- **Lead**: requires `leadStatusId` (Restrict), `temperature` default WARM; optional company, contact, source, service, owner (SetNull); JSON `qualificationData`, `customFields`.
- **Contact**: requires `firstName`; optional `companyId`; `doNotContact`, `mergedIntoId`.
- **Company**: requires `name`; optional lifecycle state; health fields.
- **Deal**: requires `companyId` (Restrict), `ownerMembershipId` (Restrict), `pipelineStageId` (Restrict); `outcome` default OPEN; `value Decimal(14,2)`; `currency` default "KES".
- **Reference tables** (`LeadSource`, `LeadStatus`, `PipelineStage`, `CustomerLifecycleState`, `LostReason`, `Service`): per org, `@@unique([organizationId, key])`.
- **Config JSON**: `OrganizationSetting` (key and value, unique per org and key), `AutomationRule` (`config`), `StageRule` (`config`).
- **Schema is not the whole truth.** About 20 models (for example `Pipeline`, `PipelineService`, `StageRule`, `RoleFieldRule`, `CardCapture`) have FKs, checks and RLS only in hand-written migration SQL. `PipelineStage.pipelineId` is a nullable plain column. A Prisma-generated diff will not show these constraints.
- **Migrations**: 96 directories plus `migration_lock.toml`, named `YYYYMMDDHHMMSS_snake_case`, from `20260924081029_init_core_crm_schema` to `20261127130000_import_export_all_roles`. The last two timestamps are later than today (18 Nov 2026); order is by name.
- **RLS recipe** in hand-written SQL: composite FK, `ENABLE` and `FORCE ROW LEVEL SECURITY`, policy `tenant_isolation`. `npm run db:grant-role` must run after every migration. `tests/databaseSmoke.test.ts` fails if a tenant table lacks RLS.
- **Migration safety guard (new, untracked, not yet run in CI)**: `scripts/check-migrations.ts`, `scripts/lib/migrationGuard.ts`, `prisma/migrations-guard-baseline.json`, `scripts/verify-migration.ts`, CI job `migration-safety`. It blocks DROP, TRUNCATE, DELETE without WHERE, ALTER COLUMN TYPE and RENAME unless a `-- migration-guard: approved-by=... reason=...` line is present. Baseline exempts only `20261120090000_remove_customer_support`.
- **Dependents of the current schema**: frozen contract (`openapi.v1.json` 1.1.0, 407 paths) plus `accessMatrix`, `routeSchemas`, `responseShapes`, `examples` files; typed client `src/api-client/generated.ts`; public API and webhook events (`src/lib/webhookEvents.ts`); UI (28 files touch `companyId`, 34 touch `temperature`; role homes tied to five roles); mobile PWA and `SyncMutation`; assistant context, saved views, search, reports, forecast, CSV import and export (`src/lib/migrationFields.ts`), web forms.
- **Live data**: Neon MVP (`docs/MVP_HANDOVER.md`) on 11 Nov with 90 migrations; the repo has 96, so six are likely unapplied there (UNKNOWN: current state). One org, "Figbloom Digital Group", one Management user; smoke accounts were to be deleted (UNKNOWN whether done). `docs/REAL_DATA_READINESS.md` says do not enter real customer data yet.

---

## 11. Security and tenant-isolation findings

Static reading only; none of this was exercised against a live database.

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| S-1 | **Heavy `adminDb` use on tenant data.** 136 files import `adminDb`; about 95 call sites hit tenant models (for example `meetingService.ts` 14 calls on `activity`, `cardCaptureService.ts`, `conversationService.ts`, `chatPrivacyService.ts`, `privacyService.ts`, `quickCaptureService.ts`, `handoffService.ts`). Several are `update`/`delete` by bare `id` after an earlier org-scoped fetch. Isolation there rests on query filters, not RLS; a refactor that drops the earlier lookup becomes a cross-tenant write. Hand-checked and fine: memberships, requestContext, apiToken, oauthConnectionService, supportAccessService, platformDataRequestService, quote links. The rest is UNKNOWN. | High (architectural) | `src/db/adminClient.ts` and the files named |
| S-2 | **Forced RLS depends on a superuser or BYPASSRLS owner.** Migrations use `FORCE`, under which the owner is subject to policies unless it bypasses RLS. `docs/AWS_MOVE_PLAN.md:19`, `M17_LANE_*` docs and CLAUDE.md all list the "AWS owner-role RLS check" as open. On RDS the owner is not a superuser, so `adminDb` queries on forced tables would return nothing or fail (login resolution, jobs, public endpoints). A migration comment saying owners are exempt is wrong with FORCE. Status on the target host: UNKNOWN. No test uses a non-bypass owner. | High for the AWS move, otherwise Info | migration `20260924081100` lines ~369-370 |
| S-3 | **Signup pre-registration (account pre-hijack).** `POST /api/auth/signup` creates a user with any email and chosen password; there is no email verification (0 references to `emailVerified` in `src/` or the schema). If an org later invites that address, `acceptMembershipInvite` sets a password only when none exists, so the attacker's password survives and they can sign in to the victim's seat. Same for platform-provisioned first-admin invites. Rate limiting and possible two-step do not stop it. No test covers it. | Medium | `src/services/authService.ts` (`signup`, `acceptMembershipInvite`) |
| S-4 | **`users` and `password_reset_tokens` are granted to `figbloom_app`.** No RLS on `users`, `permissions`, `password_reset_tokens`, `scheduled_job_runs`, `auth_rate_limit_attempts` (the last is revoked from the app role in `scripts/db-admin.ts:189`); the blanket `GRANT ... ON ALL TABLES` and default privileges are not revoked for the first two. A bug or SQL injection in `withOrgContext` code touching `users` could see every tenant's users. `tx.user.` is not used in `src/` today; `teamService` joins `users` only via org-scoped memberships. No test checks the grant. | Medium | migration `20260924081100`, `scripts/db-admin.ts` |
| S-5 | Platform operations (export, deletion, lifecycle, profile) use `adminDb`; the export builds `SELECT row_to_json(t) ... FROM "${table}"` from `information_schema` filtered by regex and an allow-list (not injectable). A table with `organization_id` missing from `EXPORTED_TABLES` is silently not exported (completeness risk; `tests/organisationExportTables.test.ts` guards the list). | Medium | `src/services/platformDataRequestService.ts` |
| S-6 | Support access uses SECURITY DEFINER functions with `search_path` pinned and EXECUTE only for `figbloom_platform`; state machine enforced by trigger. Function bodies not reviewed line by line. | Low / Info | migration `20261121110000` |
| S-7 | Public endpoints derive the tenant correctly: website key (slug plus hashed key, `timingSafeEqual`, grace window), web forms (key's org must equal slug), quote and sign tokens (hashed, org from share row), API tokens (hashed, membership re-resolved per request), OAuth callback (hashed one-time state, same member), local blob route (HMAC-signed, org prefix and DB check), inbound mail (per-org token or HMAC BCC address, 96 bits). Weaknesses: inbound token may appear in URL query logs; empty `allowedOrigins` on web forms accepts any origin; Mailgun replay guard uses the rate-limit table. S3 presigned URLs not reviewed here. | Low | `src/auth/websiteApiKey.ts`, `src/auth/inboundBccAddress.ts`, `src/services/webFormSubmissionService.ts:111`, `src/auth/apiToken.ts` |
| S-8 | Cron routes check `CRON_SECRET` in constant time and fail closed. `claimJob` is cross-org on `adminDb` by design and skips suspended or offboarded orgs. `purgeDeletedFiles` without an org id spans orgs (intended). `churnHintService.ts:92` runs `adminDb.$queryRaw` on activity; its org filter was not checked (UNKNOWN). | Low | `src/jobs/runner.ts`, `src/services/churnHintService.ts` |
| S-9 | Raw SQL: no injection found. `Prisma.raw` uses whitelist maps (`SORT_SQL`, `SORT_COLUMNS`); upstream validation of the `teamService` sort key is UNKNOWN. | Low | `teamService.ts`, `platformOrganizationService.ts` |
| S-10 | `role_permissions` has RLS enabled but not FORCE. `organizations` policy has `USING` only (writes fall back to `USING`). | Info | migration `20261124090000` |
| S-11 | Strengths: single request choke point; forced RLS with a least-privilege app role; separate platform identity, role, tables and cookie; platform tables revoked from the app role; tenant callers get 404 on platform routes; suspended orgs blocked centrally. | Positive | sections 3 and 5 |

---

## 12. Testing and stability findings

**What was run.** `npm run typecheck` (41 s) and `npm run lint` (59 s): both finished with no errors and no output.

**What was not run, and why.**
- **No Vitest, Playwright, component or perf run.** `tests/globalSetup.ts` runs `npx prisma migrate deploy` against the test database and its header says it "applies migrations from a clean slate". That is a database reset path, which the audit rules forbid. The full suite also takes about 60 minutes (the `apiWalk` and `tenantAttack` route walks) and only one run per database is safe. Pure tests (`tests/migrationGuard.test.ts`, `tests/migrationVerify.test.ts`, component tests) still pass through `globalSetup` (UNKNOWN whether sub-configs skip it).
- At the start of the session Docker was down. It was later restarted; I started only the stopped container `figbloom_crm_postgres_m13` (no data change) and confirmed 96 applied migrations in both the dev and test databases. I did not test the app against it.
- `prisma migrate status`, the migration guard against a real database, `verify:migration`, Neon, and the platform console journeys were not run.

**Inventory.** 221 `tests/*.test.ts` files plus `tests/components/**` (jsdom), 2 snapshots, perf tests; 45 Playwright specs in `e2e/` and `e2e/qa/`. Coverage floors: lines 42, statements 42, functions 69, branches 70. Almost every `tests/*.test.ts` needs live Postgres.

**Coverage map** (a test file exists; pass state UNKNOWN):
- Authentication: `authService`, `authRateLimiting`, `sessions`, `twoStepSignIn`, `csrf`, `devSuperAdmin`, `frozenAuthSource`; e2e `auth`, `frozen-auth`, `csrf`, `dev-accounts-closed`.
- Authorisation and roles: `permissionsV2`, `roleMatrixLive`, `appRoleGuard`, `massAssignment`, `v11PermissionDenial`, `v11RouteGates`, `apiWalk`, `apiWalkV11`, `roleEditor`, `maskingAudit`, `dealGateBypass`.
- Tenant isolation (strongest): `tenant-isolation`, `tenantAttack`, `tenantAttackV11`, `platformTenantDenialV11`, `databaseSmoke`, stage exit gates, public-endpoint tests.
- Lead and deal workflows: `leadService`, `leadIntake`, `leadPool`, `leadImportLenient`, `qualification`, `dealService`, `dealRules`, `dealHandoff`, `pipelines`, `forecast`, exit gates; e2e leads, deals, lifecycle.
- Customer management: `companyService`, `contactService`, `customer360`, `mergeDuplicates`, `lifecycle`, `recurringServices`.
- Custom fields: `customFields`, `qualification`, `referenceAdmin`; e2e only via `leads.spec`.
- Module access: `featureFlags`, `platformFlagsLimits`, `v11RouteGates`, `releaseGateV11`.
- Org settings and onboarding: settings tests present; **no dedicated first-run or onboarding test** (provisioning and invite acceptance are tested).
- API contracts: `apiContract`, `apiConventions`, `apiWalk*`, `publicApi`, `validation`, `e2eTraceability`.
- Migrations: `migrations.test.ts` (shells out to `prisma migrate status`; load-sensitive), `removeCustomerSupportMigration`, `migrationGuard`, `migrationVerify`.

**Last recorded results (documents, not re-run).**
- `docs/TEST_BASELINE.md` (22 Oct, stale): 1242 tests, 0 failing.
- `docs/M14_TEST_REPORT.md` (9 Nov): full Vitest 58 min, 3195 of 3196 passed (one migrations-status timeout under load); a catalogue-sync test timed out because of about 6,680 leftover test orgs; `apiWalk` hangs if two runs share a database; on hosted Neon 7 of 8 `tenantAttack` tests passed and the full route walk did not complete.
- `docs/V11_TEST_REPORT.md` (9 to 12 Nov): 263 of 267 files, 3218 tests passed, 38 skipped; the 4 failing files were fixed and re-run alone but the full suite was not repeated; Playwright 294 passed, 29 skipped, 1 failed (since fixed). Platform console journeys skip in CI by design.
- `docs/QA_DEFECTS.md`: open D-04 (WebKit Secure cookie), D-06 (CSP report-only), D-07 (npm audit, 22 moderate).
- **Nothing records a run since the M19 work or the six newest migrations.** Current pass or fail is UNKNOWN.

**Stated instability unrelated to the expansion.** A long-lived test database accumulates throwaway orgs and slows tests; one run per database; slow from remote networks; visual baselines are Windows-only and unapproved.

**Missing critical regression coverage for a universal-CRM change**
1. No end-to-end test that a data-bearing database survives an upgrade (only one scratch-DB test).
2. No test that every new FK column has a composite tenant FK and RLS (only `databaseSmoke` checks RLS).
3. Custom fields tested only on LEAD, CONTACT, COMPANY, DEAL; a new entity type has no coverage path (validation, import, export, search, saved views, masking, merge, contract).
4. No tests for non-B2B paths (deal without company, contact-only deal).
5. Thin coverage for orgs whose statuses, stages or pipelines differ from the seeded defaults.
6. Walk matrix is fixed to five role columns.
7. No first-run or onboarding test.
8. No test of a user in two orgs across a switch, of S-3, of a non-bypass owner (S-2) or of `figbloom_app` access to `users.password_hash` (S-4).
9. Contract tests check only "equals the frozen file", not old-client compatibility.
10. No multi-currency or non-Kenyan locale test; mail and calendar never run against real providers; no Linux visual baselines; hosted-DB isolation walk unproven.

---

## 13. Existing documentation review

**Canonical documents.** `CLAUDE.md` (hard rules 1 to 13), `docs/DECISIONS.md`, `IMPLEMENTATION_NOTES.md` (2,251 lines; not read in full, so content beyond sampled sections is UNKNOWN), `docs/RESTRUCTURE_LOG.md` (waivers W1 to W7), `docs/API_CONVENTIONS.md`, `docs/API_CHANGELOG.md`, `docs/FEATURE_FLAGS.md`, `docs/MASKING.md`, `docs/PLATFORM_IDENTITY.md`, `docs/MULTI_ORGANISATION.md`, `docs/MVP_HANDOVER.md`, `docs/LATER_VERSIONS.md`, `docs/REAL_DATA_READINESS.md`, `docs/AWS_MOVE_PLAN.md`, `design-spec/` (including `TRACEABILITY.md`) and about 100 feature documents in `docs/`.

**Outdated or conflicting**
- `CLAUDE.md` "where we are" stops at M17 and the MVP; it has no M18 or M19 and still says "Next: M14 gates after wiring". Heading dates ("complete by 22 Nov") need review. Its M9 paragraph still describes eight dev accounts "including Dev Customer Support"; `prisma/devSeed.ts` says that role was dropped (seven).
- Migration counts disagree: CLAUDE.md and MVP_HANDOVER say 90, REAL_DATA_READINESS says 93, the repository has 96.
- `docs/DATA_FLOW.md`: says 72 tables (schema has 135 models), database port 25432 (compose publishes 55432), Chat, Mail and Video on demo data (schema has the tables), storage "later" (S3 driver exists), jobs via worker (production uses Vercel Cron).
- `docs/JOBS.md`: describes Pro-plan 5-minute crons; `vercel.json` has three daily entries (DECISIONS 7.5 changed to Hobby); omits `sequences.run`, `oauth.refresh`, `platform.org_export`.
- `docs/DECISIONS.md`: two "section 5" blocks and out-of-order sections; M13 item 5 (default AI model) says `claude-opus-5-5`, code and `.env.example` now say `claude-sonnet-5-5`; section 11 (real data) is "proposed, not yet decided". Decision 7.5 line still reads Pro.
- `docs/API_CONVENTIONS.md`: idempotency "leads so far"; error code list is shorter than `ApiErrorCode`; `ORGANIZATION_SUSPENDED` promised in contract 1.1.0 is not in `ApiErrorCode` (UNKNOWN whether it shipped elsewhere).
- `src/services/organizationProvisioningService.ts` comment says "5 fixed roles", outdated since custom roles shipped (B7.06).
- `docs/TEST_BASELINE.md`, `docs/MIGRATION_REHEARSAL.md` (about 34 migrations behind), `QA_DEFECTS.md` and `e2e/smoke/production.spec.ts` still reference Customer Support.
- Feature docs describe the shell hiding nav items whose flag is off (`docs/FEATURE_FLAGS.md`); code shows `buildNav` using permission keys only.

**Documented but not implemented or only partly**: off-Neon backups and restore check (built, not run); storage bucket (P2-04 / FIG-1587); Linux visual baselines; V2 items hidden in the MVP (roles editor, API tokens and webhooks UI, support access, announcements, per-org flags, e-sign preview); deposit request (cancelled); Sales Lead, Viewer and Marketing roles (deferred); AWS owner-role RLS check.

**Implemented but weakly documented**: M18 and M19 phase 2 work (company and contact on new lead, task and calendar types, key notes, Excel import and PDF export, lenient lead import, Team page, team activity alerts) is covered only by `API_CHANGELOG.md`, `P2_TEAM_PAGE.md`, `TEAM_ACTIVITY_NOTIFICATIONS.md`, `EXCEL_IMPORT_PDF_EXPORT.md`; the hand-written FK and RLS convention is explained only in migration comments; the typed client and mock server (`src/api/mockServer.ts`).

**Decisions future development must preserve**
- DECISIONS 1.1 to 1.6: five fixed roles and matrix departures (Delivery and Finance see won deals only; Sales shared pool and claim; Restricted Technical "My work"; separate `deals.handoff`).
- 2.3 organisation switcher is V1.1; 2.5 and 13 signed quotes are status-only, no payment processing; 4 #1, #2 density and brand lock; 4 #5 org deletion needs two platform admins; 4 #6 and #7 support access by org approval, no read-only access without break-glass; 4 #11 named actors in audit; 4 #15 and rule 9 automations never decide; 4 #17 stalled = 10 days configurable; 4 #18 Sales sees values only on own deals; 4 #19 handoff delivered by Delivery or Management.
- 5.1 and 5.2: plain PostgreSQL, no vendor-specific services, S3 driver, dump-and-restore move to AWS.
- Decision 12: no Customer Support role. 7.1: V2 hidden in the MVP. 7.6: malware-scan risk acceptance. 9.2: field visibility is deal value only. 11.3: expand-and-contract, written approval for any drop, rename, truncate or retype.
- CLAUDE.md rules: 1 frozen auth pages (hashes in `tests/uiGuards.test.ts`), 7 masking everywhere, 8 RLS plus cross-org test per tenant table, 9, 10, 11, 13; Zod DTO source of truth; additive contract only.

---

## 14. Backward-compatibility risks

| Risk | Why | Mitigation direction (not implemented) |
|---|---|---|
| New or changed Postgres enums | Adding values is safe; removing or renaming is blocked by the migration guard and breaks DTOs, OpenAPI, client and tests | Prefer reference tables (as `LeadStatus`) over new enums; contract minor bump |
| `Deal.companyId` is required (Restrict); `@@unique([organizationId, leadId])` | Contact-only (B2C) deals need a nullable FK: additive-safe to drop NOT NULL but touches every query, DTO, report, forecast, handoff and schema; unique change locks a large table | Plan as expand-and-contract with a rehearsal |
| Key-based code paths | Code switches on `QUALIFIED`, `CONVERTED`, `CLOSED_WON`, lifecycle keys; renamed or deleted keys break flows | Use flags such as `isWon` / `isLost` instead of keys |
| New tenant tables | Hand-written composite FKs and RLS are invisible to Prisma diffs; `npm run db:grant-role` needed after each migration | Follow the recipe; add a schema-wide FK/RLS test |
| `CustomFieldEntity` closed to four entities | New entity needs enum value, new `customFields` column, service branches, RLS, contract | Decide a generic custom-record approach first |
| `Role.key` globally unique | Org-scoped custom roles can collide across tenants | Namespace by organisation |
| Five role columns in walk matrix, fixtures, mock server, UI source | Changing the role set breaks `accessMatrix*.json`, `apiWalk*` and role homes | Treat role set as versioned |
| Frozen contract 1.1.0 | Narrowing or new required fields is breaking; dynamic per-org schemas do not fit static Zod and client generation | Additive V1.x or V2 routes; consider an extensions envelope |
| Frozen auth pages | New onboarding or branding must be new routes | New routes only |
| Migration lock times | `20261023230000_deal_rules` locked `deals` about 9.5 s in rehearsal; rehearsal doc is stale | Re-rehearse on a restored copy |
| Live Neon database | Six migrations probably unapplied (UNKNOWN); one test org; no real data yet; migrations are forward-only, dump is the rollback | Check `prisma migrate status` first; apply with `migrate:deploy:direct` then `db:grant-role` |
| Future-dated migration names | `20261127...` later than today; ordering is by name | Keep new migrations after the last name |
| Offline sync and mobile | `SyncMutation` and `public/sw.js` depend on current shapes | Include in compatibility tests |
| Untracked migration guard | Not yet run in CI or on a real database | Commit and exercise it before relying on it |

---

## 15. Gaps between the existing system and the intended universal CRM direction

| Intended capability | Today | Gap |
|---|---|---|
| Multiple organisations on one platform | Yes (membership-first, forced RLS, switcher) | Self-service org creation absent; provisioning not transactional or resumable; custom domains UNKNOWN |
| Industry templates | Reference data is per org and editable | No industry parameter on seeding; seed content is IT/ISP and Kenya-specific; no template catalogue |
| Guided configuration wizard | Platform provisioning wizard only | No first-run tenant wizard or checklist; no onboarding tests |
| Module selection | Five optional toggles, release flags | No module registry, dependencies or plan model; core modules always on; no toggle UI |
| Departments and teams | None | No Department or Team model; no team scope; no Head of Sales |
| Configurable "who can sell" | Derived from permission keys | Only through V2 custom roles with no real UI; one role per membership |
| Custom roles per organisation | Backend (V2-gated) | Editor is demo-only; global `Role.key` uniqueness; reserved-key limits |
| Custom fields and objects | Four entities, six field types | No custom entities, relations, lookups, computed fields |
| Custom pipelines | Multiple pipelines and stages | Lead statuses, lifecycle states, deal outcomes fixed or key-bound; stage rule types fixed |
| Workflow automation | 8-rule catalogue, tunable | No builder; rules may only assign, remind and draft (rule 9) |
| Dashboards | Fixed role-based sections | Not configurable |
| Non-B2B and other revenue models | Company-centred deals, quotes, invoices, renewals | Contact-only deals unsupported; no projects or delivery tracking; support and success modules absent |
| Locale and currency | `KES` and Nairobi defaults, en and sw | No currency setting UI; no multi-currency or other-locale tests |
| Field-level security beyond deal value | `RoleFieldRule` for `deal.value` | No other masking surfaces |

---

## 16. Recommended areas for extension

These are observations to guide planning, not design decisions or implementation.

1. **Make seeding data-driven.** Extend `seedOrganizationDefaults` and `organizationProvisioningService` with a template input (industry, services, stages, sources, statuses, qualification sets, role set). Make provisioning transactional or resumable first.
2. **Treat the current content as one template.** Keep the existing seed as the "services/IT agency" template so existing orgs and tests keep their behaviour; use the existing `fillOnly` backfill path for compatibility.
3. **Add a module and entitlement layer on top of the existing toggle system** (`src/lib/featureFlags.ts`, `OrganizationSetting`, `resolveGatedContext`) rather than a new mechanism: module definitions, dependencies, navigation and API enforcement through the same gate, plus a toggle UI.
4. **Introduce an organisation structure** (departments or teams) as new tables with hand-written composite FKs and RLS, independent of roles, with team-scoped visibility added to `visibilityWhere.ts` and `masking.ts` only after the record-scope design is approved.
5. **Finish the V2 custom-role path** (wire `Roles.tsx` to the real API, relax or namespace `Role.key`, decide multi-role membership) and express "can participate in sales" explicitly while keeping `ownerEligibility.ts` as the single rule.
6. **Move key-bound logic to flags or reference-table properties** before allowing orgs to diverge from default status and stage keys.
7. **Reduce `adminDb` on tenant data** (S-1) and resolve the AWS owner-role RLS question (S-2) before onboarding materially different tenants; add a lint or test that allow-lists `adminDb` files.
8. **Fix S-3 and S-4 before opening signup or self-service organisations.**
9. **Plan the contract as 1.2.0 or V2 additive**, and extend tests (walk matrix by role set, per-org variation, onboarding, upgrade survival, FK/RLS schema test) before schema changes.
10. **Refresh stale documents** (CLAUDE.md status, DATA_FLOW, JOBS, migration counts) so the next phase starts from accurate references.

---

## 17. Technical and product decisions requiring approval

1. Whether the universal CRM keeps the five-role matrix as a fixed catalogue plus custom roles, or moves to template-defined role sets (affects DECISIONS 1.1 to 1.6, the walk matrix and the frozen contract).
2. Whether a membership may hold several roles, or "can participate in sales" becomes an explicit per-member setting.
3. Whether departments or teams are an organisation structure, a label, or an access boundary (team-scoped visibility).
4. Module model: what counts as a module, dependencies, whether core modules (leads, deals, contacts, companies) may be disabled, and where entitlements come from (platform-set, plan, or Management).
5. Self-service organisation creation and email verification (S-3), including who becomes the first admin.
6. Whether custom objects are in scope; if not, which entities beyond the four may carry custom fields.
7. Whether deals without a company (B2C) are supported, and the migration approach for `Deal.companyId` and the one-deal-per-lead unique constraint.
8. How much of the status, stage and lifecycle vocabulary organisations may change (key-bound code paths), and whether Postgres enums are to be replaced by reference tables.
9. Reserved permission keys: whether Management-class powers (for example `membership.manage`, `export.bulk`) may ever be delegated.
10. Hosting: the AWS owner-role RLS approach (S-2), and whether `adminDb` access to tenant data should be removed.
11. Contract strategy: additive 1.2.0 versus a V2 line; how per-org dynamic fields appear in a static OpenAPI and typed client.
12. Production value of `ACTIVE_RELEASE`, whether the Neon MVP should be migrated forward before any schema work, and who signs off for Michael (all current sign-offs are "Given on Michael's behalf").
13. Whether to commit and run the new migration guard and verify tooling before schema work begins, and whether to run the full suite on a fresh database after M19.
14. Localisation scope: currency setting UI, defaults per template, languages beyond English and Swahili.
