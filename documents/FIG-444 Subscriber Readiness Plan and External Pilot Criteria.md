# FIG-444 — Subscriber Readiness Plan & External Pilot Criteria

**Status:** Draft for review (Michael / project lead sign-off required before any go/no-go decision is exercised)
**Date:** 2026-09-29
**Scope:** Readiness, operational and pilot-definition deliverable. Does **not** redesign the CRM architecture, and does **not** build subscriber billing, self-service onboarding, white-labeling, or a subscriber-facing tenant administration platform.
**Depends on / does not reopen:** FIG-436 (V1 Architecture & Tenant Model), FIG-437 (Authentication, Organizations, Roles & Tenant Isolation), FIG-438 (Core Data Model & Migrations), FIG-439 (Leads/Contacts/Companies), FIG-440 (Deals/Pipeline/Conversion), FIG-441 (Activities/Tasks/Audit), FIG-442 (Website Lead Capture), FIG-443 (Dashboards/Reporting), FIG-297/299/300 (requirements, data model, MVP scope).

---

## How this document was produced

This plan is grounded in an inspection of the actual repository as it stands today (`figbloom-crm`), not in assumptions about what a V1 CRM "should" have. Specifically:

- `README.md` and `IMPLEMENTATION_NOTES.md` (997 lines covering FIG-438 through FIG-442, including every documented open decision, deferral, and bug found by manual end-to-end walkthroughs).
- `prisma/schema.prisma` (every model, every `organizationId` scoping, every composite unique/foreign key).
- `src/repositories/organizations.ts`, `src/services/organizationDefaults.ts`, `prisma/seed.ts`, `scripts/` (how an organization and its users are actually created today).
- `src/app/o/[orgSlug]/settings/page.tsx` (what is actually configurable through the UI today).
- `tests/` (what is actually automated-test-covered: `tenant-isolation.test.ts`, `authorization.test.ts`, `migrations.test.ts`, `relationships.test.ts`, `seed.test.ts`, plus one test file per service).
- `docker-compose.yml`, `.env.example`, `package.json` (the actual deployment and dependency footprint).
- A grep across `src/` for export/CSV/migration tooling, monitoring/logging libraries, and auth-provider libraries, to confirm what does and does not exist rather than infer it.

Where the repository does not yet demonstrate a capability, this document says so explicitly and records it as a **prerequisite** or **gap**, not as a completed feature. Nothing below should be read as "external subscriber readiness has been achieved" — this document defines the conditions and process for reaching it.

---

## 1. Purpose

This document defines how FigBloom's tailored CRM progresses from **internal use** to a **controlled external subscriber pilot**, and states plainly what must be true before that happens. It is deliberately scoped between two things it is not:

- It is not a certification that the CRM is ready for external subscribers today. As of this writing, it is not (see §3 and the gaps recorded throughout).
- It is not a general SaaS commercialization strategy. Subscriber billing, self-service onboarding, white-labeling, and advanced tenant administration are explicitly out of scope for V1 and for this pilot (§13).

What it is: a measurable readiness framework, a concrete first-subscriber operating model built on the tenant architecture that already exists, and an explicit go/no-go framework that a person (Michael / project lead), not a subjective "team feels ready," can apply.

## 2. Current V1 Position

As implemented today, the CRM is a **single internally-used tenant**. Concretely:

- One organization exists: `figbloom` ("FigBloom Digital Group"), created by `prisma/seed.ts`.
- Five seeded dev users (`dev.management@figbloom.local`, etc.), one per V1 role, authenticate via `/dev-login` — a signed cookie with **no password check at all** (`src/auth/devSession.ts`). This is explicitly documented in the code and in README.md as a placeholder for FIG-437's real authentication provider, which has never been chosen or built. **This alone is a hard blocker for any external subscriber** — no organization outside FigBloom can be given a login mechanism that lets anyone pick which account to "become."
- There is no way to create a second organization today except by directly invoking `createOrganization()` (`src/repositories/organizations.ts`) — an admin-only repository function with no API route, no UI, and no CLI wrapping it. The only caller anywhere in the codebase is `prisma/seed.ts`, hard-coded to the single `figbloom` slug.
- There is no user/membership creation flow beyond direct seeding; `scripts/manual-add-second-sales-user.ts` is a one-off manual script, not a repeatable tool.
- There is no deployment beyond local development: `docker-compose.yml` runs a single local Postgres container; there is no `Dockerfile` for the application itself and no CI/CD configuration anywhere in the repository. The app has only ever been run via `npm run dev`.
- The CRM's core workflows (leads, contacts, companies, deals/pipeline, lead conversion, activities/tasks, audit history for ownership/outcome changes, role-specific dashboards and organization-wide reporting, and website lead capture with round-robin assignment) are implemented and, per `IMPLEMENTATION_NOTES.md`, were each verified through both an automated test suite and a scripted manual HTTP walkthrough across all five roles at the time each ticket was completed.
- Tenant isolation is implemented in three independent layers (composite tenant-integrity foreign keys, Postgres row-level security via a separate least-privilege `figbloom_app` role, and application-level `organizationId` scoping in every repository) and has dedicated automated tests (`tests/tenant-isolation.test.ts`, 9 tests; `tests/authorization.test.ts`). **These tests could not be re-executed during the preparation of this document** (this session's tooling could not reach the project's local Postgres instance) — re-running them is recorded as a mandatory pre-pilot gate item (§9, §17), not assumed to still pass.

In short: the product logic that a subscriber would actually use is comparatively mature; the *operational* machinery to safely admit a second tenant (real authentication, a provisioning process, a deployed environment, export/migration tooling) does not yet exist. This document treats both halves honestly.

## 3. Internal Adoption Readiness

FigBloom employees must use the CRM as their real, primary operational CRM before any external subscriber is considered. The following are measurable and use the existing data model directly (a `createdAt`/`updatedAt`/`ownerMembershipId`/`lastActivityAt`-style query against each entity; none require new instrumentation to compute, only a decision on the measurement window).

| # | Adoption measure | Suggested V1 threshold | How it's computed |
|---|---|---|---|
| A1 | Active CRM users (of intended FigBloom users) | ≥ 80% logged in and performed at least one create/update in the last 14 days | `Membership` join against any owned record's `updatedAt`/`createdAt`, or `AuditEvent.actorMembershipId` |
| A2 | New sales opportunities entered into the CRM | ≥ 90% of leads/opportunities FigBloom actually pursues exist as a `Lead` within 48 hours of first contact | Compared against whatever informal tracking (spreadsheet, inbox) is being phased out — a manual reconciliation for the readiness review, not an automated metric |
| A3 | New leads captured in the CRM | 100% of website-sourced leads (already automatic via FIG-442) + ≥ 80% of manually-sourced leads entered within 24 hours | `Lead.createdAt` vs. first-contact timestamp from source |
| A4 | Deals maintained in the CRM | ≥ 80% of open opportunities above a defined value threshold exist as a `Deal` with a current `PipelineStage` | `Deal` count vs. known sales-team activity for the same period |
| A5 | Follow-up/task usage | ≥ 70% of active Sales/Delivery users have created or completed at least one `Task` in the last 14 days | `Task.createdByMembershipId` / `completedAt` |
| A6 | Reporting usage | `/reports` visited by every Management user at least weekly | Not currently logged (no page-view analytics exist) — **instrumentation gap**, recorded as a pilot-readiness prerequisite in §9, not assumed measurable yet |
| A7 | Consistency over time | A1–A5 hold for **3 consecutive weeks**, not a single good week | Repeat the same query weekly |

These thresholds are intentionally realistic for a first internal CRM rollout, not perfection targets — a first-quarter internal CRM with 100% capture of every informal channel is not a credible bar, and setting one would make the gate meaningless.

## 4. Internal Data-Quality Readiness

All of the following are directly computable against `prisma/schema.prisma` as it exists today; none require new fields.

| # | Data-quality check | Suggested V1 threshold | Query basis |
|---|---|---|---|
| D1 | Duplicate Companies/Contacts/Leads | < 5% of records flagged by the existing `findPossibleDuplicate*` logic (already run on every create — `src/services/*Service.ts`) remain unresolved after 30 days | Re-run the existing duplicate-detection query in read-only reporting mode across all records, not just at create time |
| D2 | Missing ownership | 0% of Leads/Deals/Companies/Contacts with `ownerMembershipId IS NULL`, except leads created with zero active Sales reps (the documented FIG-442 fallback) | Direct query |
| D3 | Missing required fields | 0% (the schema already enforces required fields at the database level; this measures workarounds like placeholder values, e.g. "N/A" emails) | Manual sampling, since a placeholder value satisfies a NOT NULL constraint without being meaningful |
| D4 | Invalid/stale statuses | < 10% of open Leads with no `LeadStatus` change or Activity in 30+ days ("stale leads"); < 10% of open Deals past `expectedCloseDate` with no stage change in 14+ days ("stale deals" — the same definition FIG-443 already uses for "stalled deal") | `Lead`/`Deal` timestamps vs. linked `Activity.occurredAt` |
| D5 | Incomplete Company records | ≥ 90% of Companies linked to at least one Contact | `Contact.companyId` join |
| D6 | Inconsistent pipeline data | 0% of Deals whose `outcome` does not match their current `PipelineStage.isWon`/`isLost` flags | This is already structurally prevented by `dealService.ts#resolveOutcomeFields` (outcome is derived, never client-set) — this check exists to catch any direct-DB writes that bypassed the service layer, which should be exactly zero in a healthy system |
| D7 | Orphaned records | 0% — already structurally prevented by the composite tenant-integrity foreign keys (§9) | `tests/tenant-isolation.test.ts` / `tests/relationships.test.ts` cover this at the schema level |
| D8 | Incorrect organization associations | 0% — already structurally prevented by the same composite FKs + RLS | Same as D7 |

D7 and D8 are worth calling out specifically: they are not aspirational thresholds to hit through process discipline, they are already database-enforced invariants. The measurable readiness work for D1–D6 is process and cleanup; D7–D8 is confirming the existing automated tests still pass (§9).

## 5. Operational Readiness

| Area | Requirement | Current state |
|---|---|---|
| Deployments | At least one successful deploy to a real, non-local environment | **Gap.** No `Dockerfile`, no CI/CD, no staging/production environment exists anywhere in the repository today. This must exist before internal adoption can even be meaningfully measured beyond a developer's own machine, let alone before an external pilot. |
| Migrations | `prisma migrate deploy` runs cleanly against a fresh database, in order | Automated (`tests/migrations.test.ts`) and documented as the recovery pattern (`IMPLEMENTATION_NOTES.md` — Prisma Migrate is roll-forward only; "rollback" means re-provisioning and re-deploying, not down-migrations) |
| Backup/recovery | A tested backup and restore of the production database | **Gap** — no production database exists yet, so none exists to back up. Must be established alongside the deployment environment above. |
| Authentication | A real authentication mechanism (not `/dev-login`) | **Gap — hard blocker.** FIG-437 explicitly leaves "exact authentication provider" and "session/token strategy" open. This must be resolved and built before internal-adoption measurement can be considered representative of production conditions, and absolutely before any external user is invited in. |
| Authorization | Role/permission boundaries hold under test | Automated (`tests/authorization.test.ts`) and exercised manually across all 5 roles for every ticket (`IMPLEMENTATION_NOTES.md`) — but the permission matrix itself is explicitly documented as **provisional**, pending confirmation by Michael/the project lead (`prisma/seedData.ts` header comment) |
| Tenant isolation | Cross-organization access is impossible at every layer | Automated (`tests/tenant-isolation.test.ts`, 9 tests) — see §9 for the full verification list |
| Critical defects | No unresolved critical/high-severity defect affecting core workflows | Per `IMPLEMENTATION_NOTES.md`, every defect found during each ticket's manual walkthrough (3 in FIG-439, 2 in FIG-443, 0 in FIG-440/441/442) was fixed with a regression test in the same ticket. No defects are recorded as open. This should be re-confirmed against the current codebase state as part of the pre-pilot gate, not assumed permanent. |
| Monitoring/logging | Basic operational visibility (errors, request logs) | **Gap.** No logging library (no `pino`/`winston`), no error-tracking service (no Sentry or equivalent), and no APM tooling appear anywhere in `package.json` or `src/`. This is unremarkable for a pre-deployment local project, but it is a prerequisite, not a nice-to-have, once anyone outside the development team depends on the system. |

## 6. External Pilot Prerequisites

Before the **first** external organization is onboarded, all of the following must be true. This section states the requirement; §7–§12 describe how each is satisfied operationally.

- **Tenant readiness:** the system can create a genuinely separate organization whose records never mix with FigBloom's internal `figbloom` organization or any other subscriber's organization. The tenant *model* already guarantees this (§9); what is currently missing is a repeatable, non-hard-coded *process* to create the second tenant at all (§7).
- **User readiness:** the external organization has real user accounts under real authentication (not `/dev-login`) with role assignments appropriate to their team.
- **Configuration readiness:** the subscriber's organization-specific catalogs (lead sources, pipeline stages, services, lifecycle states, lost reasons — §8) reflect their business, not FigBloom's own service lines, which is what every new organization gets by default today (`src/services/organizationDefaults.ts` seeds FigBloom's own service catalog — Accounting, CCTV, Starlink, etc. — for every organization, including a future subscriber, unless someone manually edits it).
- **Data readiness:** an explicit decision, made per subscriber, for whether they start clean, migrate existing data, or both (§11) — this document does not assume every pilot subscriber needs migration.
- **Security readiness:** the isolation/authorization verification in §9 has been run against the current codebase and passed, immediately before onboarding — not "passed once, months ago."
- **Operational readiness:** a named person owns provisioning, a named person owns first-line support, an escalation path exists, and both are agreed before the subscriber is told a start date (§10, §14).

## 7. Tenant Provisioning

The V1 provisioning process is **controlled, not self-service**, consistent with the approved architecture (Organization = Tenant; users join through Memberships; FigBloom is the only party that creates organizations). Concretely, today, provisioning a new organization means running the same pattern `prisma/seed.ts` already demonstrates for `figbloom` itself — `createOrganization()` → `seedOrganizationDefaults(organization.id)` → create `User` + `Membership` rows — but that pattern is currently hard-coded to one organization and is not a reusable tool. **Turning it into a small, reusable, parameterized provisioning script (organization name/slug, initial admin user, initial role assignments) is itself a prerequisite of this readiness plan, not something to build ad hoc during onboarding.**

Given that, the V1 sequence for the first external subscriber is:

1. External subscriber is approved for pilot (§17 — a specific named organization, not "the pilot" in the abstract).
2. FigBloom staff run the (to-be-built) provisioning script to create the organization/tenant and seed its default catalogs.
3. FigBloom staff review and adjust the seeded catalogs for the subscriber's actual business (§8) — the FigBloom-specific defaults are a starting point, not a fit for every subscriber.
4. Initial administrator/user accounts are created for the subscriber's team, under whatever real authentication mechanism has been built (§5) — **not** `/dev-login`.
5. Roles are assigned from the existing fixed 5-role catalog (Management, Sales, Delivery, Finance, Restricted Technical) — no new roles are invented per subscriber (§2, and consistent with "Roles are global, not organization-configurable," `IMPLEMENTATION_NOTES.md`).
6. Data migration/import is performed if the subscriber requires it (§11).
7. Validation is performed against the checklist in §18.
8. Subscriber receives access.
9. Pilot begins; usage and issues are monitored (§14).

Steps 2–7 are entirely manual/FigBloom-controlled in V1. There is no self-service tenant creation, no subscriber-facing admin console, and none is being built for this pilot (§13).

## 8. Tenant Configuration

| Level | Who configures it | What it covers today |
|---|---|---|
| System-level | FigBloom application administrators (code/DB access) | Role catalog (5 fixed roles), permission catalog (46 permissions) and role→permission mapping (provisional — `prisma/seedData.ts`); these are **global**, shared by every organization, not per-tenant |
| Tenant-level | FigBloom staff, at provisioning time, via direct data seeding (no settings UI exists for these) | `LeadSource`, `LeadStatus`, `PipelineStage`, `CustomerLifecycleState`, `LostReason`, `Service` — each is its own per-organization row set (seeded from FigBloom's own defaults, then must be manually reviewed/edited for a subscriber whose business differs); `OrganizationSetting` (currently used only for the website-lead round-robin cursor) |
| Tenant-level, UI-editable | The subscriber's own Management-permission user, through `/o/[orgSlug]/settings` | **Only** the website lead-capture API key (generate/regenerate). This is the single piece of tenant configuration V1 actually exposes through a UI. |
| User-level | Individual users, implicitly | None beyond their own `Membership`/role, which FigBloom assigns — there is no user-editable profile/preferences screen today |

This is a narrower configuration surface than a mature multi-tenant SaaS product would have, and that is an intentional, in-scope observation for this document, not a defect to fix here: FIG-436 always described pipeline stages, lead sources, services, lifecycle states, and lost reasons as "organization-configurable business data" at the *data model* level, and the data model honors that (every one of those tables is genuinely per-organization). What doesn't yet exist is a subscriber-facing screen to *change* that data themselves — which is precisely the "advanced tenant administration" this pilot explicitly defers (§13).

## 9. Data Isolation & Security Verification

This is the mandatory pre-pilot security gate. Every item below has a corresponding automated test today; **all must be re-run against the current code, immediately before the first external subscriber is onboarded**, not assumed still-passing from when they were written.

| Requirement | Mechanism | Test evidence |
|---|---|---|
| Org A cannot read/update/delete Org B records, even by direct primary key | Composite tenant-integrity foreign keys (DB-level, cannot be bypassed by an application bug) + RLS policy scoped to `current_setting('app.current_organization_id')` | `tests/tenant-isolation.test.ts`: "organization B's context cannot read organization A's companies, even when explicitly filtering by A's id"; "cannot update/delete another organization's record even when addressed directly by primary key" |
| Org A cannot search/report on Org B records | Same RLS policy applies to every query path, not just direct lookups | `tests/tenant-isolation.test.ts`: "organization-scoped search never surfaces another organization's rows"; "listCompanies only ever returns the caller's own organization's companies" |
| Org A cannot attach its records to Org B (or vice versa) | The composite FK `(organization_id, parent_id) -> parent(organization_id, id)` makes a cross-tenant relationship a database constraint violation, not an application check | `tests/tenant-isolation.test.ts`: "cannot create a relationship linking to another organization's record, even while acting inside its own context" |
| No context = no data | RLS fails closed | `tests/tenant-isolation.test.ts`: "fails closed: no rows are visible with no organization context set" |
| Users only access organizations through valid memberships | `resolveRequestContext(orgSlug)` resolves a real, active `Membership` before anything else runs | `tests/authorization.test.ts` |
| Role/permission boundaries can't be bypassed client-side | Every service function requires `AuthContext` + `requirePermission`/`requireOwnedRecordPermission`; routes/pages call services only, never repositories directly; the FIG-439 note explicitly records that "hiding a nav item is not a security boundary" and was confirmed by visiting restricted pages directly by URL | `tests/authorization.test.ts`; manual walkthroughs recorded per-ticket in `IMPLEMENTATION_NOTES.md` |
| Sensitive data (deal value) stays restricted per role | `deals.view.value` gates value visibility independent of `deals.view.all`; masking applies to individual records **and** aggregates (`reportingService.ts`) | Covered by `tests/dealService.test.ts` / `tests/reportingService.test.ts` (masking-branch test using a stripped permission context) |
| Audit trail exists for sensitive actions | `AuditEvent` is append-only at the DB level (`figbloom_app` has UPDATE/DELETE revoked on the table) and wired into lead/company/contact ownership changes and deal outcome changes | `tests/tenant-isolation.test.ts`: "audit events are append-only for the application role"; `tests/auditService.test.ts` |
| Background/integration paths preserve tenant scope | The one non-session route (`/api/public/orgs/[orgSlug]/leads`, FIG-442) resolves its own organization from the URL slug + API key and runs through the same `withOrgContext`/repository layer as everything else; round-robin assignment locks its cursor row `FOR UPDATE` inside the same transaction, scoped to one organization | `tests/websiteLeadCapture.test.ts` |

**Explicit requirement:** the full suite above must show a green run, on the actual pre-pilot codebase, on record, before go/no-go is exercised (§17). A test file existing is not equivalent to a passing run performed today — this document could not execute the suite itself (§2) and does not claim to have verified it.

One security-relevant gap to record honestly: authentication itself (§5) is not yet real, so "role/permission boundaries hold" today describes the *authorization* layer sitting on top of a placeholder *authentication* layer. Authorization tests passing does not substitute for a real login mechanism existing.

## 10. Support Boundaries

V1 pilot support is controlled and human-assisted — there is no support ticketing system, no SLA-tracking tool, and no self-service knowledge base in this codebase or repository, so none is implied below.

**Included:**
- Onboarding assistance (walking the subscriber's admin user through the CRM)
- Configuration assistance (reviewing/adjusting their seeded lead sources, pipeline stages, services, lost reasons, lifecycle states with them)
- Data import assistance, where migration is agreed (§11)
- User/account support (adding/removing users, role changes) — performed by FigBloom staff, since there is no subscriber-facing user management screen
- Defect reporting and triage
- Technical incident escalation to whoever holds deployment/infrastructure responsibility
- Basic CRM usage assistance (how to log an activity, convert a lead, read a report)

**Not included (explicitly, so it is never assumed):**
- Custom development per subscriber
- Unlimited configuration changes on demand
- Bespoke integrations beyond the one implemented pattern (the static-API-key website lead-capture endpoint, FIG-442)
- Guaranteed response-time SLAs (none exist; this is a pilot, not a commercial support contract)
- Custom reporting outside the six metrics `reportingService.ts` already computes
- Subscriber-managed infrastructure (there is none to manage — FigBloom hosts the single shared instance)
- Support for third-party systems this CRM does not integrate with (e.g., the stakeholder-questionnaire-mentioned e-commerce/property-management platforms — explicitly left as a separate, not-yet-scheduled decision per FIG-437 section 18)

## 11. Migration & Import

No import tooling (no CSV importer, no bulk-upload endpoint) exists in the codebase today — confirmed by inspection, not assumed. For V1, migration is **assisted**, not self-service, and is explicitly not guaranteed to be needed for every subscriber (some may reasonably start with a clean tenant).

- **Source assessment:** identify what the subscriber actually has — typically spreadsheets or an export from whatever they use today (a competitor CRM, a shared spreadsheet, email/contacts). Do this before agreeing to a pilot start date, not after.
- **Mapping:** map source columns onto the existing entities — Company, Contact, Lead, Deal, Activity, Service (using the tenant's own, reviewed catalog from §8, not FigBloom's defaults). There is no automated mapping tool; this is a manual spreadsheet-to-schema exercise, likely performed via a one-off script following the same org-scoped repository pattern every other write path uses (`withOrgContext`, so isolation guarantees still apply to migrated data).
- **Data cleaning:** identify duplicates, missing required fields, invalid statuses, and ownership gaps in the source data *before* import — the existing duplicate-detection queries (`findPossibleDuplicate*`) can be reused for this, but they run at create time, not as a bulk pre-import scan today, so this is scripting work, not a button to press.
- **Validation after migration:** record counts reconcile against the source; relationships (Contact→Company, Deal→Company) resolve correctly; required fields are populated; a sample of records is manually reviewed; every migrated record's `organizationId` is confirmed to be the correct tenant (this last check can reuse `tests/tenant-isolation.test.ts`'s own assertions as a template).
- **Rollback:** because there is no in-place bulk-import tool, "rollback" for V1 means deleting the migrated rows for that organization (identifiable by `organizationId`) and re-running the import script — not a database-level transactional rollback of a long-running import. This should be tested once, on a non-pilot organization, before the first real migration is attempted.

Building a full migration platform is explicitly not required for V1 — a one-off, carefully validated script per subscriber is acceptable, and is the honest V1 approach given nothing currently exists.

## 12. Export & Pilot Exit

**No dedicated export feature exists anywhere in the codebase today** (confirmed by grep across `src/` for CSV/export/download patterns — none found). This is recorded here explicitly, per this document's own instruction not to promise capabilities that don't exist.

What does exist that an export could be built on: authenticated, org-scoped REST endpoints for every core entity (`/api/orgs/[orgSlug]/companies`, `/leads`, `/contacts`, `/deals`, `/activities`, etc.), which already return org-scoped data through the same isolation guarantees as the UI. A scripted export (calling these endpoints, or a direct read-only, org-scoped database query) is technically straightforward to build, but **does not exist today** and must be built and tested before it is offered as a pilot commitment.

- **What can be exported:** to be built — the plan is a script producing one file (CSV or JSON) per entity type, scoped to the subscriber's `organizationId`, reusing the existing repository query functions so the isolation guarantee is inherited rather than reimplemented.
- **Format:** CSV is the more broadly reusable target for a subscriber who may not have another system to receive JSON into; this is a recommendation, not yet an implementation.
- **Who performs it:** FigBloom staff, on request, at pilot exit (or at the subscriber's request during the pilot, per whatever terms are agreed).
- **Validation:** row counts match the subscriber's live data at time of export; spot-check a sample against the live CRM.
- **Access revocation after exit:** deactivate the subscriber's user accounts/memberships (setting `Membership` inactive, an existing field/pattern already used for role resolution); the organization's data is not deleted immediately — see retention below.
- **Retention:** no retention policy is defined anywhere in the existing documents. **This is a gap** — a specific retention period (e.g., "retained for 30 days post-exit, then deleted on request or by policy") must be agreed as part of pilot terms before the first subscriber is onboarded, not decided reactively when the first pilot ends.

**If export is a requirement for a specific candidate subscriber and it has not yet been built and tested, that subscriber is a no-go until it exists** (§17) — this document does not treat "we could build it" as equivalent to "it exists."

## 13. Explicit V1 Deferrals

The following are **intentional V1 boundaries**, not unfinished acceptance criteria, and are not implied to exist anywhere else in this document:

- **Subscriber billing — DEFERRED.** No billing engine, automated invoicing, or subscription-management workflow is required for, or will be built for, the external pilot. Any commercial arrangement with a pilot subscriber is handled outside this platform entirely (a manual agreement/invoice process).
- **Self-service onboarding — DEFERRED.** Subscribers do not create or configure their own tenant. Tenant provisioning remains entirely controlled by FigBloom staff (§7), using a to-be-built internal script — not a public signup flow.
- **White-labeling — DEFERRED.** The pilot does not require independent branding, custom domains, or a separate product identity per subscriber. Every subscriber uses the same FigBloom-branded application.
- **Advanced tenant administration — DEFERRED.** No subscriber-facing tenant administration console, custom role builder, or advanced per-tenant configuration UI will be built for this pilot. The one tenant-level setting a subscriber's own Management user can change today (the website API key, §8) remains the extent of subscriber-facing configuration.

These four are structural decisions for this pilot, independent of how the underlying readiness gates in §17 resolve.

## 14. External Pilot Operating Model

**Before onboarding:** subscriber selection and approval (a specific named organization, §17) → internal readiness confirmed (§3–§5) → tenant provisioning tool ready (§7) → configuration reviewed for that subscriber's business (§8) → migration need assessed (§11) → security gate re-run and passed (§9).

**During onboarding:** user accounts created under real authentication → roles assigned from the fixed 5-role catalog → tenant catalogs (lead sources, pipeline stages, services, lifecycle states, lost reasons) reviewed/adjusted with the subscriber → data imported if agreed → validation performed (§18) → a short orientation session for the subscriber's users.

**During the pilot, monitor:**
- Adoption (same measures as §3, applied to the subscriber's own users)
- Data quality (same measures as §4)
- System reliability (uptime/errors — requires the monitoring capability flagged as a gap in §5 to actually exist by this point)
- Support request volume and content
- Defects, specifically any that surface only under a second tenant's real usage patterns
- Security events (any anomaly in access patterns)
- Direct user feedback
- Whether the subscriber's actual business processes (not just FigBloom's) fit the existing lead→deal→activity→report flow, since the CRM was built around FigBloom's own process (FIG-297) and a different subscriber's process may not map cleanly onto it — this is a real, open risk (§16), not assumed to be fine.

**Pilot review (at an agreed interval, e.g. 30/60/90 days):** is the subscriber actually using the system (§3-style measures, applied to them)? Does the CRM support their workflows as-is, or does it need per-subscriber customization that would violate the "no bespoke work" support boundary (§10)? Is data quality holding? Is support demand manageable for the assigned owner? Do any critical defects exist? Does tenant isolation remain intact (spot-check, don't just assume)?

## 15. Pilot Success Measures

| Category | Measures | Note |
|---|---|---|
| Adoption | Active users, regular usage cadence, leads/deals actually captured, task/activity usage | Same computation basis as §3, scoped to the pilot organization |
| Data quality | Duplicate rate, completeness, stale-record rate, invalid-record rate | Same computation basis as §4 |
| Reliability | Critical incidents, unresolved defects, failed deployments/migrations, availability | Availability specifically **cannot be measured today** — no monitoring exists (§5). This is recorded as a pilot requirement to instrument, not a metric already being collected. |
| Support | Support volume, recurring-issue rate, unresolved requests, FigBloom staff time spent operating the tenant | Not currently tracked anywhere — a simple log (even a shared spreadsheet) is the minimum viable instrumentation for the pilot; do not claim this is measured until that log exists |
| Business value | Improved lead visibility, more consistent follow-up, better pipeline visibility, centralized customer information, reduced reliance on spreadsheets | Qualitative — assessed through direct subscriber feedback during pilot review, not a computed metric |

Where a measure has no existing instrumentation (availability, support volume, page-view/reporting-usage in §3's A6), that is stated plainly above rather than presented as already tracked.

## 16. Risk Register

| Risk | Impact | Mitigation | Go/No-Go significance |
|---|---|---|---|
| Tenant data leakage | Critical | Automated isolation tests (`tests/tenant-isolation.test.ts`) + composite FKs + RLS, re-verified immediately pre-pilot | **No-go** if not re-verified and passing |
| No real authentication provider exists | Critical | FIG-437's auth-provider decision must be resolved and built before any external user is invited, full stop | **No-go** — structural blocker, not a tuning issue |
| No deployment environment exists | Critical | Stand up a real hosted environment (with backups, and ideally monitoring) before internal-adoption measurement is even considered representative | **No-go** for external pilot; also blocks a meaningful internal-adoption measurement period |
| Poor internal adoption | High | Internal adoption gate (§3) enforced before pilot approval is even considered | **No-go** |
| Poor data quality | High | Data-quality thresholds (§4) and a cleanup pass before go-live | Potential **no-go** |
| No provisioning tool exists (only a hard-coded single-org seed script) | High | Build the parameterized provisioning script described in §7 before the first subscriber, not during their onboarding | **No-go** until built |
| Unreliable/untested migration | High | Assisted migration with explicit validation and a tested rollback path (§11), on a non-pilot org first | **No-go for a migration-dependent pilot** specifically; not a blocker for a subscriber starting clean |
| No export capability exists | High | Build and test a minimal export script (§12) before promising it to any subscriber | **No-go if the specific candidate subscriber requires export** (e.g., as an exit condition in their pilot agreement) |
| Provisional permission matrix | Medium/High | Confirm the permission matrix with Michael/the project lead before it governs a second organization's real data, not just FigBloom's own | Review — should be resolved, not necessarily a hard no-go, but must be a conscious decision rather than an oversight |
| Excessive support burden | Medium/High | Deliberately small pilot size (§18) + explicit support boundaries (§10) | Review |
| Subscriber's business process doesn't fit the existing workflow | Medium/High | Assessed during subscriber selection, before onboarding — the CRM's process (lead→deal split at "Solution Presented," FigBloom's own service catalog, FigBloom's own permission model) was built around FigBloom's own business (FIG-297), and may not transfer cleanly | Review — pick a first subscriber whose process resembles FigBloom's own reasonably closely |
| Incomplete tenant configuration at go-live | Medium | Tenant readiness checklist (§18) run before access is granted, not after | **No-go** if incomplete |
| Role/permission errors | Critical | Authorization tests (`tests/authorization.test.ts`), re-run pre-pilot | **No-go** if failing |
| Insufficient monitoring/logging | Medium | Stand up at minimum basic error logging before pilot (§5) | Review, trending toward no-go the longer it's postponed |
| No retention/data-deletion policy defined | Medium | Agree a specific retention period as part of pilot terms, before onboarding (§12) | Review |
| Premature SaaS expectations from a subscriber | Medium | Explicit V1 scope communication (§13) as part of onboarding, in writing | Review |
| Billing requirements arriving early | Medium | Handle commercially/manually outside the platform during the pilot (§13) | Review |
| CRM built around FigBloom's own service catalog/process leaking into the pilot's default config | Medium | Explicit tenant-catalog review step in provisioning (§7, §8) — do not skip it because the seeded defaults "look complete" | Review |

## 17. Go/No-Go Framework

### Mandatory NO-GO conditions

The external pilot must not proceed if **any** of the following remain true at decision time:

- Tenant isolation has not been re-verified (a passing, current run of `tests/tenant-isolation.test.ts` and `tests/authorization.test.ts`) immediately before the decision.
- Cross-tenant access is possible in any tested path.
- Critical authorization vulnerabilities remain open.
- No real authentication mechanism exists — `/dev-login` remains the only login path.
- No deployed, non-local environment exists for the subscriber to actually use.
- A tenant-provisioning process (beyond the hard-coded single-org seed script) does not exist.
- Required data cannot be safely migrated, where the specific candidate subscriber requires migration.
- Required data cannot be exported, where export is a term of that subscriber's pilot agreement.
- Any critical unresolved defect affects a core CRM workflow (lead capture, qualification, conversion, pipeline, activity/task tracking, reporting).
- Internal adoption has not reached the §3 thresholds, sustained for the required 3-week period.
- Data quality is materially below the §4 thresholds.
- No named person owns pilot support, or no escalation path exists.
- A retention/exit-data policy has not been agreed for that subscriber.

### GO conditions

A pilot may proceed once, for a **specific, named** candidate subscriber:

- Internal adoption criteria (§3) are satisfied and sustained.
- Data-quality criteria (§4) are satisfied.
- A real authentication mechanism is in place and in use.
- A real deployment environment exists and has been running reliably.
- Tenant isolation and authorization test suites pass, on a run performed immediately before the decision.
- The tenant-provisioning tool (§7) exists and has been used at least once successfully (ideally on a non-pilot test organization first).
- That subscriber's migration requirement (if any) is understood, and the necessary tooling/validation exists.
- That subscriber's export requirement (if any) is understood, and the necessary tooling exists.
- A named support owner and escalation path are agreed.
- V1 limitations (§13, and the specific gaps recorded in this document) have been communicated to the subscriber in writing.
- The specific subscriber has been approved by name — this framework is never exercised for "external pilots" as an abstract category.

This is a checklist to apply, not a feeling to consult. Where a condition is ambiguous in a specific case, that ambiguity itself should be resolved by Michael/the project lead before go-live, the same "document the decision and continue" discipline used throughout this project's implementation notes.

## 18. Pilot Size and Control

The first external pilot should be **one subscriber**, not several, and not "as many as ask." The purpose of the first pilot is to validate the mechanics described in this document — provisioning, configuration, isolation, migration (if applicable), support, operational reliability, and whether the product itself is useful to a business other than FigBloom — with a small enough footprint that a problem in any one of those areas is fully within FigBloom's current operational capacity to absorb and fix.

This document does not have a basis in existing operational data (support-staffing levels, current team capacity) to justify a specific number beyond that starting point. **Pilot capacity beyond the first subscriber should be approved based on available support and operational resources at the time**, reviewed after the first pilot's outcome is known — not fixed in advance here. Treating the first subscriber as a general public launch, or as proof the system can handle an arbitrary number of additional subscribers, would not be supported by anything demonstrated in this document.

## 19. External Pilot Readiness Checklist

### Product
- [ ] Core CRM workflows operational (leads, contacts, companies, deals/pipeline, conversion, activities/tasks, audit, reporting) — implemented per FIG-439–443
- [ ] Required reporting operational — implemented per FIG-443
- [ ] Lead capture operational where required — implemented per FIG-442 (optional per subscriber; only relevant if they want a website integration)
- [ ] Known limitations documented and communicated to the subscriber (§13, and every gap recorded in this document)

### Security
- [ ] Tenant isolation verified — **re-run `tests/tenant-isolation.test.ts` now**, not relying on a historical pass
- [ ] Authorization tests passing — **re-run `tests/authorization.test.ts` now**
- [ ] Role boundaries verified — confirm the permission matrix has been reviewed/confirmed by Michael/the project lead, not left provisional
- [ ] Sensitive data restrictions verified (deal value masking, per §9)
- [ ] Real authentication mechanism in place (not `/dev-login`)

### Data
- [ ] Migration approach agreed for this specific subscriber (clean start / import / both)
- [ ] Data mapping completed, if import is required
- [ ] Duplicate/data-quality cleanup completed, if import is required
- [ ] Import validated against §11's checks, if import is required
- [ ] Export path built, tested, and confirmed, if export is a term of this subscriber's agreement
- [ ] Retention/exit-data policy agreed in writing

### Tenant
- [ ] Organization created via the (built, tested) provisioning script — not a manual one-off
- [ ] Tenant catalogs (lead sources, pipeline stages, services, lifecycle states, lost reasons) reviewed and adjusted for this subscriber's actual business, not left as FigBloom's defaults
- [ ] Users created under real authentication
- [ ] Roles assigned from the fixed 5-role catalog
- [ ] Website API key generated, if this subscriber wants the integration

### Operations
- [ ] A real, non-local deployment environment exists and is running
- [ ] Support owner assigned by name
- [ ] Escalation path defined
- [ ] Incident-handling process known to that owner
- [ ] At minimum basic error logging/monitoring available

### Commercial/Scope
- [ ] Billing handled outside the platform (§13)
- [ ] Self-service onboarding explicitly excluded and communicated (§13)
- [ ] White-labeling explicitly excluded and communicated (§13)
- [ ] Advanced tenant administration explicitly excluded and communicated (§13)
- [ ] Pilot boundaries (support, scope, exit terms) communicated to the subscriber in writing before go-live

## 20. Future SaaS Evolution

Beyond this pilot, a general commercial SaaS state would require — in roughly ascending order of how far they are from today's implementation — a settings UI for the tenant catalogs already modeled per-organization (§8, a comparatively small step since the data model already supports it); self-service tenant creation and onboarding; subscriber billing and subscription management; broader, scalable support operations; and, if ever required, white-labeling. None of this is required for, or should be started because of, the single-subscriber pilot this document defines — building any of it now would be exactly the ahead-of-scope work this project's own implementation notes have consistently avoided at every prior ticket (FIG-438 through FIG-443). This pilot's outcome (§15) should inform whether and in what order these are ever pursued, not the other way around.

## 21. Acceptance Criteria Traceability

**AC1 — Internal adoption and data-quality success measures are defined.**
Satisfied by §3 (7 measurable adoption criteria, A1–A7, each with a stated threshold and computation basis) and §4 (8 measurable data-quality criteria, D1–D8, each with a stated threshold and query basis). Where a measure has no existing instrumentation (A6, reporting-usage tracking), that gap is stated explicitly rather than assumed measurable.

**AC2 — Requirements for a first external subscriber pilot are documented.**
Satisfied by §6 (prerequisites), §7 (tenant provisioning — including the honest gap that no reusable provisioning tool exists today), §8 (tenant configuration boundaries, grounded in the actual `/settings` page and per-organization schema tables), §9 (the full isolation/security verification list with test evidence), §10 (support boundaries, included/excluded), §11 (migration/import approach), §12 (export/exit — including the honest gap that no export feature exists today).

**AC3 — Explicit V1 deferrals are documented.**
Satisfied by §13:
- Subscriber billing — **DEFERRED**
- Self-service onboarding — **DEFERRED**
- White-labeling — **DEFERRED**
- Advanced tenant administration — **DEFERRED**

**AC4 — Risks and go/no-go criteria are recorded.**
Satisfied by §16 (a risk register of 18 risks specific to external subscriber readiness, each with impact, mitigation, and go/no-go significance) and §17 (an explicit, checklist-form mandatory-NO-GO list and GO list — not a subjective "team feels ready" judgment).

## 22. Definition of Done

FIG-444 is complete as a **document** when every item below is true — none of these claim that external subscriber readiness itself has been *achieved*; they claim the conditions and process for achieving it are now defined and traceable to real repository evidence:

- [x] The existing CRM implementation has been inspected (README, IMPLEMENTATION_NOTES.md, `prisma/schema.prisma`, repositories, services, settings UI, tests, deployment config, dependency footprint).
- [x] Internal readiness criteria are measurable (§3).
- [x] Data-quality criteria are measurable (§4).
- [x] External subscriber prerequisites are documented (§6).
- [x] Tenant provisioning is defined (§7), including the honest gap that today's process is a hard-coded seed script, not a reusable tool.
- [x] Tenant configuration boundaries are defined (§8), grounded in what `/settings` actually exposes today.
- [x] Tenant isolation verification is defined (§9), with specific existing test names as evidence.
- [x] Migration/import requirements are defined (§11), including the honest gap that no import tooling exists today.
- [x] Export/exit requirements are defined (§12), including the honest gap that no export feature exists today.
- [x] Support boundaries are defined (§10).
- [x] V1 billing deferral is explicit (§13).
- [x] V1 self-service onboarding deferral is explicit (§13).
- [x] V1 white-labeling deferral is explicit (§13).
- [x] V1 advanced tenant administration deferral is explicit (§13).
- [x] External pilot success measures are defined (§15), including where instrumentation does not yet exist.
- [x] Risks are documented (§16).
- [x] Mandatory go/no-go conditions are documented (§17).
- [x] The external pilot checklist is complete (§19).
- [x] The final document is saved in the repository (`documents/`).
- [x] Acceptance criteria traceability is included (§21).

**This document does not claim external subscriber readiness has been achieved.** As recorded throughout, several structural prerequisites do not yet exist — a real authentication provider, a deployed environment, a reusable tenant-provisioning tool, migration tooling, and an export feature — and each is marked as a mandatory NO-GO condition (§17) until built. FIG-444 defines the conditions and process for reaching readiness; it is not itself the readiness.
