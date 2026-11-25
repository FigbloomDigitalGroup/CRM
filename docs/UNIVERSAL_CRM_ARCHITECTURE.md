# Universal CRM: product architecture

**Status: DRAFT for product-owner review. Nothing in this document is approved, and nothing described as "proposed" exists.**
This is the single authoritative design for evolving FigBloom CRM into a configurable, industry-agnostic CRM. It extends the existing application. It is not a rebuild.

- Baseline evidence: `docs/UNIVERSAL_CRM_EXISTING_STATE_AUDIT.md` (kept as the factual baseline; this document does not repeat it).
- Repository and commit: `figbloom-crm-m13`, branch `makeover/p2-26-lead-import-lenient`, commit `3cf770c`, verified to match the audit before writing. The working tree has uncommitted edits (CI, backup docs, `docs/DECISIONS.md`, migration-guard scripts) that this task did not touch.
- Date: 18 Nov 2026.
- Not available to the author: the role-management and social-media screenshots named in the brief were not attached to the request. Sections 6 and 12 are designed from the written description and must be checked against the screenshots before approval.
- Nothing in this task changed code, schema, migrations, configuration, database contents, Git state or Linear.

**Tags used throughout.** `[EXISTS]` implemented and verified in the audit or follow-up research. `[PARTIAL]` partly built. `[BACKEND]` backend without full UI. `[DEMO]` UI on demo data. `[PLANNED]` documented only. `[MISSING]` not present. `[PROPOSED]` new in this design. `[UNKNOWN]` not verified. Existing decisions are cited as `DECISIONS x.y` and `CLAUDE.md rule n`.

**How to read the roadmap.** Section 23 gives the phases. Release 1 (section 23.2) is the first realistic usable release and is small on purpose.

---

## 0. Contents

1. Product vision and scope
2. Target industries
3. Organisation onboarding
4. Industry template architecture
5. Department and account architecture
6. Roles and permissions
7. Cross-department sales participation
8. Sourced, owned, assisted and closed attribution
9. Module registry and configuration
10. Department workspaces
11. Dashboard architecture
12. Social Intelligence architecture
13. Quotes and invoices pages and workflows
14. Other business modules
15. External system integrations (including HR and inventory)
16. Customisation architecture
17. Database evolution
18. Existing data migration and preservation
19. API evolution
20. Security and tenant isolation
21. Backward compatibility and conflicts with approved decisions
22. Testing strategy
23. Phased implementation roadmap
24. Product-owner decisions requiring approval
25. Appendix: what is not changing, and diagrams

---

## 1. Product vision and scope

**Vision.** One CRM and light business-management platform that an organisation of any size or industry configures to its own way of working: its departments, modules, roles, sales process, terminology and reports. It starts from a guided preset and can be customised further at any time.

**What it is.** Leads and customers, deals and quotes, invoices and payment records, delivery work, customer service and success, marketing and social engagement, dashboards and reports, and integrations with the systems an organisation already uses.

**What it is not.** It is not an accounting package, payroll, HR system, inventory or procurement system, ERP, or payment processor. Where an organisation has those, the CRM connects to them (section 15). Payments stay **records, not processing** (`DECISIONS 2.5`, `4 #13`, `9.1`).

**Principles**
1. **Extend, never restart.** Every change is additive first (expand, switch, contract; `DECISIONS 11.3`, enforced by the migration guard). Existing organisations keep working and keep their data.
2. **Separate concepts.** Departments, roles, permissions, modules and memberships are five different things (section 5).
3. **Permission keys are the only security vocabulary.** Code never branches on role names (`CLAUDE.md` conventions; `src/auth/teamAccess.ts`). Hiding a link is a courtesy; the API re-checks.
4. **Templates recommend, never restrict.** A template is a starting configuration that an organisation can change before and after onboarding (section 4).
5. **Configuration is data, not code branches.** No `if (industry === ...)` anywhere (section 16).
6. **Security debt is paid first.** The audit's findings S-1 to S-4 are prerequisites for self-service onboarding (section 20).
7. **Visual identity is fixed.** New screens are built from `@/ui` components and existing tokens (section 21.4).
8. **Release in small usable slices** (section 23).

**Existing releases.** V1 and V1.1 are live in the MVP; V2 is built in the backend and hidden (`DECISIONS 7.1`). The approved design is 92 screens (`design-spec/TRACEABILITY.md`). The universal-CRM scope is **beyond** those 92 screens and beyond the "everything complete by 22 Nov" plan in `CLAUDE.md`. No recorded decision authorises that growth (conflict C-6, section 21).

---

## 2. Target industries

The product must serve at least: marketing and creative agencies, technology and SaaS, real estate, retail and distribution, construction, professional services, education, healthcare, financial services, hospitality and tourism, recruitment, NGOs, manufacturing, agriculture, and "Build My Own".

**Sizes.** Small (1 to 10 people; one or two departments, few modules), growing (10 to 50), medium (50 to 250) and large (250+; many departments, delegated administration, external system integrations). The same engine serves all sizes; size changes the recommended preset, not the code.

**Honest limits.** Healthcare and financial services carry regulatory duties (patient and financial data, retention, consent). A template can recommend fields and workflows but does not make an organisation compliant. Those templates need a legal review before they ship (decision D-18). The existing IT/services configuration is preserved as one template (section 4.4).

---

## 3. Organisation onboarding

### 3.1 What exists today

| Item | Status | Evidence |
|---|---|---|
| Organisation creation | `[EXISTS]` platform staff only: `POST /api/platform/organizations`, `scripts/provision-organization.ts` | `src/services/organizationProvisioningService.ts`, `platformOrganizationService.ts:310` |
| Defaults seeding | `[EXISTS]` identical for every org (15 sources, 8 statuses, 5 stages, 6 lifecycle states, 11 lost reasons, 14 services, qualification fields); no industry parameter | `src/services/organizationDefaults.ts`, `src/lib/qualificationDefaults.ts` |
| Provisioning safety | `[PARTIAL]` not transactional, not resumable; a failure leaves a half-created org and a re-run fails on the taken slug; platform audit entry written after commit | service header comment; `docs/M13_CLOSEOUT.md` |
| Self-service organisation creation | `[MISSING]`; self-signup creates a bare user with no org access; self-signup and billing deferred (`DECISIONS 4 #8`, FIG-436) | `authService.signup` |
| Tenant onboarding wizard or checklist | `[MISSING]` (only help content and a first-run fragment in `home/roles.tsx`) | audit section 9 |
| Existing orgs | Must be left alone (this brief) | |

### 3.2 Proposed wizard `[PROPOSED]`

A Management-only guided setup at a **new route** `/o/{orgSlug}/setup` (the frozen auth pages are untouched: `CLAUDE.md` rule 1). Ten steps as in the brief:

| # | Step | What it captures | Recommended by |
|---|---|---|---|
| 1 | Organisation details | name, logo, contact lines, country | existing profile fields |
| 2 | Industry | industry or Build My Own | template catalogue |
| 3 | Business type and size | B2B/B2C/mixed, team size band | template variant |
| 4 | Departments | pick, rename, add custom | template (section 5) |
| 5 | Modules | enable only what is needed | template and dependencies (section 9) |
| 6 | Department configuration | heads, members, sales participation per department | section 7 |
| 7 | Roles and permissions | role templates, who can do what | section 6 |
| 8 | Team invitations | initial invites with department and role | existing invite flow |
| 9 | Preferences | timezone, currency, language, terminology, working hours | existing `Organization` columns, settings |
| 10 | Review and complete | diff of what will be created; apply | apply plan (3.4) |

The industry choice recommends; every later step is editable and none is a permanent restriction. **Build My Own** starts from a minimal foundation (people, contacts, companies, activities, tasks) and the user adds modules one by one.

### 3.3 Existing organisations `[PROPOSED]`

- Every existing organisation gets `onboarding.state = NOT_APPLICABLE` (stored in `OrganizationSetting`; absence means the same). The wizard is never forced on them and **seed operations are never re-run** against them (`organizationDefaults.ts` non-`fillOnly` mode resets names and order; `docs/MIGRATION_REHEARSAL.md` finding 2).
- An existing organisation may opt in later to "Apply a template piece" (section 4.5), always as a previewed, additive diff.
- Departments are introduced to existing orgs as an empty structure plus an optional "Organise your team" Settings tab (section 5).

### 3.4 Making provisioning transactional and resumable `[PROPOSED]`

The audit's gap is the half-created organisation. Design:

1. **One transaction for the database facts.** Create `Organization`, run `seedOrganizationDefaults`, find or create the `User`, upsert the PENDING `Membership` (with hashed invite token), and write a **provisioning run row**, all in a single `adminDb` transaction. If any step fails the whole thing rolls back and the slug is free again.
2. **After commit, side effects with an outbox.** The invite email and the platform audit entry are written as rows in a small outbox (a `provisioning_outbox` table, platform-owned) and sent by the job framework (`registerJob`, `src/jobs/registry.ts`; no ad hoc scheduler). A failure retries; it never leaves an unaudited org (closes the `M13_CLOSEOUT` gap).
3. **Wizard apply is idempotent.** The wizard keeps its draft server-side (`OrganizationSetting` key `onboarding.draft`). "Complete" runs an **apply plan**: an ordered list of steps, each keyed `(organization, step_key)`, each using insert-if-missing semantics (the existing `fillOnly` behaviour). The run records which steps completed, so a crash resumes at the first incomplete step and a repeat does nothing.
4. **State machine.** `onboarding.state`: `NOT_APPLICABLE | DRAFT | APPLYING | COMPLETE | FAILED`. The platform console shows failed runs with a "resume" action (Management of the org can also resume).
5. **No shared seeds.** The apply plan is generated from the chosen template plus the user's edits; it never calls a global seed.

Status: `[PROPOSED]`. Needs migrations for the run and outbox tables (section 17), RLS on any org-scoped table, and cross-org tests.

---

## 4. Industry template architecture

### 4.1 Definition `[PROPOSED]`

A template is **versioned, declarative data**, validated by a Zod schema, stored in the repository under `src/templates/industries/<key>.ts` (not in the database at first: reviewable in Git, tested in CI, no migration needed to ship a new one). It contains:

| Part | Content | Maps to existing |
|---|---|---|
| Departments | catalogue keys and default names | new `departments` (section 5) |
| Modules | enabled set | module registry toggles (section 9) |
| Role templates | named permission bundles | custom roles (`Role.organizationId`, V2) |
| Permission defaults | sales participation policy per department | section 7 |
| Lead sources | keys and names | `LeadSource` |
| Services and products | keys, names, kinds | `Service`, `CatalogueItem` |
| Qualification questions | per service | `CustomFieldDefinition` (QUALIFICATION) |
| Pipelines and stages | stages with probability, won/lost flags | `Pipeline`, `PipelineStage` |
| Activities and tasks | labels over the fixed enums | terminology (section 16) |
| Dashboard layouts | widget lists per department | section 11 |
| Workflows | automation presets from the code catalogue | `AutomationRule` |
| Terminology | label overrides | section 16.1 |

### 4.2 Applying a template: additive, never overwriting

The apply plan is a **diff**: for each part it computes what is missing, creates only that, and reports what it skipped. Rules:
- Natural keys make it idempotent: `(organizationId, key)` on reference tables, `(org, entityType, key)` on custom fields, `(org, key)` on settings.
- Existing rows are never renamed, reordered, deactivated or deleted.
- Protected keys (`WEBSITE`, `NEW`, lifecycle keys used by the engine) are never changed.
- A template version is recorded (`onboarding.template = {key, version}`), so a later template update can be offered as another previewed diff, never applied silently.

### 4.3 Terminology instead of branching

Templates change **labels**, not code paths: "Lead" can read "Prospect", "Candidate" or "Enquiry" through a per-organisation terminology map (section 16.1). The engine keeps its keys.

### 4.4 The existing IT/services configuration is a template

The current seed (14 services, qualification sets, Kenya-flavoured sources, the five stages, and the five-role matrix with Delivery handoff) is extracted **unchanged** as the `it-services-agency` template. A test asserts that applying it to an empty organisation yields exactly the current seeded rows (golden-file test against `organizationDefaults.ts` output). Existing organisations are tagged with it implicitly.

### 4.5 Catalogue (initial and later)

| Template | Departments | Notes | Priority |
|---|---|---|---|
| IT / services agency | current seed | exact compatibility | Release 2 |
| Build My Own | Management only | minimal | Release 2 |
| Marketing and creative agency | Sales, Marketing, Delivery, Finance | projects, campaigns | later |
| Professional services | Sales, Delivery, Finance | matters/engagements via terminology | later |
| Real estate | Sales, Marketing, Operations | listings are an external or custom concern | later |
| Recruitment | Sales/BD, Recruiters (custom) | candidates need the person model decision D-9 | later |
| Others | | after Phases 2 to 4 prove the engine | later |

Regulated industries (healthcare, financial services) are deferred behind D-18.

---

## 5. Department and account architecture

### 5.1 Separation of concepts `[PROPOSED]`

```
 Organisation
   |-- Membership (a person in this organisation; one base role today)
   |      |-- Role .............. what the person may do (permission keys)
   |      '-- Department seats .. which business functions they belong to (0..n)
   |-- Department ............... a business function (label + structure + head + participation policy)
   '-- Module ................... a product capability switched on for the organisation
```

- A **department** is structure and responsibility, not access. Joining one grants no permission by itself, except the explicit participation grants in section 7.
- A **role** is a named bundle of permission keys (exists).
- A **module** is a capability (section 9).
- A **membership** links a user to the organisation (exists).

### 5.2 Recommended starting catalogue `[PROPOSED]`

Management and Administration, Sales and Business Development, Marketing and Social Media, Finance and Accounts, Operations and Delivery, Customer Service, Customer Success, Technical and IT, Projects and Product Management. These are recommended options. HR and Inventory/Procurement are **not** in the catalogue (section 15).

Organisations can select only what they need, rename, add custom departments, remove (archive) them, assign people, appoint heads, and place a person in several departments.

### 5.3 Data `[PROPOSED]` (migrations in section 17)

| Table | Purpose | Key columns |
|---|---|---|
| `departments` | per-org departments | `id`, `organization_id`, `key` (unique per org), `name`, `catalogue_key` (nullable), `sequence`, `is_active`, `archived_at` |
| `department_members` | seats | `organization_id`, `department_id`, `membership_id`, `is_head`, `started_on`, `ended_on` |
| `department_policies` | sales participation and defaults | `organization_id`, `department_id`, `policy` JSON (section 7) |

All three are tenant tables: composite FKs `(organization_id, id)`, forced RLS, cross-org tests, export classification, and `db:grant-role` coverage (`CLAUDE.md` rule 8). Heads: `is_head` may be true for several people; "the" head for escalation is the earliest head, a UI convention not a constraint.

### 5.4 What a department does and does not change

- **Does:** drives workspace defaults, dashboard widgets, team pages, notification routing, assignment pools and the attribution snapshot (section 8).
- **Does not:** grant permissions beyond its explicit participation policy, hide data, or alter role-by-route tests.
- Removing a department archives it; seats and historic attribution rows keep their department id and name snapshot.

### 5.5 Status and fit

Departments are `[MISSING]` today; the only `department` column is free text on `Contact`. `DECISIONS 4 #9` already says "keep team scope possible in the data model", so departments are consistent with an existing decision. The Team page (P2-15) and the planned Head of Sales (P2-14, referenced in `src/auth/teamAccess.ts`; no decision row records it, `[UNKNOWN]` in Linear) become **department-head** features instead of a new fixed role (decision D-3).

---

## 6. Roles and permissions

### 6.1 Today

- Five global system roles, about 97 permission keys `[EXISTS]` (`prisma/seedData.ts`).
- One role per membership: `Membership.roleId` is required, `@@unique([organizationId, userId])` `[EXISTS]`.
- Custom roles: backend `[BACKEND]` (`roleEditorService.ts`, `roles/*`), gated by `release.v2`; UI `src/ui/screens/settingsplus/Roles.tsx` is `[DEMO]` and not linked.
- Reserved keys never grantable to custom roles `[EXISTS]`: `organization.manage_settings`, `membership.manage`, `role.assign`, `roles.manage`, `configuration.manage`, `security.manage`, `audit.view`, `export.bulk`, `api_tokens.manage`, `webhooks.manage`, `ai.configure`, payment keys, `deals.margin`. At most 25 custom roles per org; a role in use cannot be archived; a change key needs its view key.
- `RoleFieldRule` covers `deal.value` only `[EXISTS]` (`DECISIONS 9.2`).
- `Role.key` is globally unique even for org-owned roles `[EXISTS]`.

### 6.2 One role versus multiple roles: trade-offs and recommendation

| Option | How | Pros | Cons |
|---|---|---|---|
| A. Multi-role membership | `membership_roles` join table; effective keys = union | familiar model | high-risk contract change: `resolveActiveMembership`, `accessMatrix*.json` (five-character rows), `apiWalk*` role columns, `/me` and team payloads, role homes; union semantics break masks (a Sales+Finance person sees value and payments, intended or not); hardest to roll back; `Role.key` global uniqueness |
| B. Single role plus department participation grants | keep one role per membership; departments add **explicit, bounded** capability grants (section 7) | no change to the role contract or matrices; grants are additive and auditable; sales participation is exactly what the brief asks; reserved keys stay protected | two places to look when answering "what can this person do" (solved by the preview in 6.4) |
| C. Custom role combining keys | create "Sales + Finance" role | already built (V2) | combinatorial explosion of roles; capped at 25; editor not exposed |

**Recommendation: B on top of C.** Keep exactly one role per membership. Use custom roles for access bundles (finish the V2 editor) and use department participation policies for cross-department sales capabilities. **Do not** adopt multi-role now. Re-evaluate only if a real organisation needs two *non-sales* bundles that custom roles cannot express (decision D-4). This preserves the frozen contract, the matrix tests and masking, and keeps the one place where effective permissions are computed (`effectivePermissionKeys` / `resolveActiveMembership`) as the single choke point.

### 6.3 Permission architecture `[PROPOSED]`

Keys stay dotted strings in the existing catalogue. New keys are grouped by the categories the brief names. "Exists" means a key exists today; "new" means it must be added to `PERMISSIONS`, `ROLE_PERMISSIONS` and, if release-gated, `PERMISSION_MIN_RELEASE`.

| Category | Existing keys (examples) | New keys |
|---|---|---|
| Dashboard and analytics | `reporting.view.own/all`, `forecast.view.all`, `mywork.view` | `dashboard.widgets.configure` |
| Leads and prospects | `leads.view.own/all/shared`, `leads.create`, `leads.edit.own/all`, `leads.assign`, `leads.convert`, `leads.claim`, `leads.import/export` | `leads.source.set`, `leads.qualify`, `leads.transfer` |
| Contacts and companies | `contacts.*`, `companies.*` | none |
| Deals and pipelines | `deals.view.own/all/won/value`, `deals.create`, `deals.edit.own/all`, `deals.handoff`, `deals.margin` | `deals.assist`, `deals.scope`, `deals.stage.move`, `deals.close`, `deals.reassign` |
| Sales participation | (derived eligibility only) | see section 7 |
| Marketing and social | none | `marketing.campaigns.view/manage`, `social.accounts.manage`, `social.inbox.view/reply`, `social.publish`, `social.analytics.view` |
| Quotes | `quotes.create`, `quotes.approve`, `catalogue.manage` | `quotes.view`, `quotes.edit`, `quotes.send` |
| Invoices and payments | `finance.view.payments`, `finance.manage.payments`, `finance.followup.note` | `invoices.view`, `invoices.create`, `invoices.edit`, `invoices.send`, `payments.record`, `finance.reports.view`, `finance.export` |
| Projects and operations | `handoff.manage`, `tasks.*` | `projects.view/manage`, `resources.view/allocate` |
| Customer service | none (removed) | gated behind decision D-6 |
| Reports and exports | `export.bulk`, `deals.export`, `leads.export` | `reports.departments.view` |
| Integrations | `api_tokens.manage`, `webhooks.manage` | `integrations.manage` (distinct from reserved keys) |
| Organisation settings | `organization.manage_settings`, `configuration.manage` | `departments.manage` (see reserved note) |
| Users and roles | `membership.manage`, `role.assign`, `roles.manage` | none |

**Compatibility rule (non-negotiable).** For every existing role, the new keys are seeded so that **effective behaviour is identical to today** (`quotes.create` implies `quotes.view/edit/send`; `finance.manage.payments` implies `invoices.create/edit/send`, `payments.record`, `finance.export`; `finance.view.payments` implies `invoices.view` and `finance.reports.view`; Management and Sales receive the new deal and lead keys that match what their current ones already allow). A snapshot test compares the effective key set of each system role before and after.

**Delegation.** Not all permissions are delegable: the reserved list stays, and new candidates join it: `departments.manage` (organisation structure), `finance.export`, `integrations.manage`. Whether `finance.export` and similar are reserved is decision D-12. `deals.margin` and payment keys are never granted by a participation policy.

### 6.4 The role and permission experience `[PROPOSED]`

Built as a Settings tab (new `SETTINGS_TABS` entry, Management only, following the `settings/kit.tsx` pattern and the list-plus-drawer pair used by `team/`), not a new design:

1. **Roles list** (DataTable): system roles (read-only, "Based on" source) and custom roles with member counts.
2. **Role drawer:** name, description, "Based on" standard role (copies its keys), permissions grouped by the categories above with per-key switches, reserved keys shown disabled with a reason (`disabledReason`).
3. **Preview** ("What can this role access?"): renders the navigation, pages and actions the role would get, built from the same `buildNav` logic and the real key set, plus masked fields; reuses the existing `roles/preview` endpoint `[BACKEND]`.
4. **Who holds this role:** list of members, with a "Change role" action (existing `membershipService` flow).
5. **Grant to user:** from the member row or the role.
6. **Central view:** a members-by-capability matrix (read-only) for audits.

Backend: mostly `[BACKEND]` (V2). Work is wiring the editor to the real API, releasing it beyond V2 (conflict with `DECISIONS 7.1`, D-7), namespacing custom role keys per organisation (`Role.key` global uniqueness, section 17), and extending `RoleFieldRule` only after a masking surface exists for each new field (`DECISIONS 9.2`).

### 6.5 Role templates

Role templates ship with industry templates as named key bundles (for example "Marketing lead", "Technical presales") that create custom roles on apply. They never include reserved keys and never include `deals.view.value`, `deals.margin` or payment keys unless the organisation adds them.

---

## 7. Cross-department sales participation

A mandatory requirement. Each department gets a **sales participation policy**: a set of independent switches that Management turns on or off. Each switch maps to a permission grant (existing or new), applied to members of that department as an additive grant resolved in `effectivePermissionKeys`.

### 7.1 Capabilities (each independently switchable)

| # | Capability | Permission key | Today | Notes |
|---|---|---|---|---|
| 1 | Lead capture | `leads.create` | `[EXISTS]` | Sales, Management have it |
| 2 | Lead sourcing (record where a lead came from) | `leads.source.set` | `[MISSING]` (rides on `leads.edit`) | new |
| 3 | Lead qualification | `leads.qualify` | `[MISSING]` (rides on `leads.edit`, `qualificationService.ts:129`) | new |
| 4 | Lead assignment | `leads.assign` | `[EXISTS]` | Management only today |
| 5 | Lead transfer to Sales | `leads.transfer` | `[MISSING]` | hand a lead to the Sales pool without owning deals |
| 6 | Deal creation | `deals.create` | `[EXISTS]` | |
| 7 | Deal ownership | eligibility via `canWorkDeals` (`ownerEligibility.ts`) plus new `deals.edit.own` | `[PARTIAL]` | ownership requires view and edit keys |
| 8 | Deal assistance | `deals.assist` | `[MISSING]` | a participant on someone else's deal |
| 9 | Technical scoping | `deals.scope` | `[MISSING]` | scoping notes and requirements on an assisted deal |
| 10 | Quotation creation | `quotes.create` plus assisted-deal path | `[PARTIAL]` | today requires `deals.edit.own/all` on the deal (`quoteService.ts:83-84`) |
| 11 | Deal stage management | `deals.stage.move` | `[MISSING]` (rides on `deals.edit`) | |
| 12 | Deal closure | `deals.close` | `[MISSING]` | moving into won or lost stages |
| 13 | Financial visibility | `deals.view.value` (never auto-granted) | `[EXISTS]` | |

### 7.2 Worked examples

- **Marketing (typical policy):** 1, 2, 3, 5 on. 4, 6, 7, 8, 9, 10, 11, 12, 13 off. Marketing captures, sources and qualifies leads and transfers them to Sales. They cannot own, negotiate, quote or close.
- **Technical:** 8, 9 on (and 2, 3 if Management wants). 6, 7, 10, 11, 12 off. 13 off. A technical employee assists and scopes without seeing values or closing.
- **Sales:** current behaviour preserved (1, 4 off, 5 n/a, 6, 7, 10 on; closure per stage rules).

### 7.3 Record-level scope for participants

Participation needs a relationship, not only a key. Two additive visibility scopes in `src/auth/visibilityWhere.ts` (`RULES`, `permissions.ts`):
- **`sourced`** (leads): a person can view leads they sourced (read-only unless they also own them), so Marketing can follow what happened to their lead. They see **stage and status**, not value.
- **`assisted`** (deals): a person added as an assistant (via `deal_participants`, section 8) can view and contribute (notes, tasks, scoping) on that deal, not change owner, stage or value.
Both return 404 for invisible records (existing rule) and are masked per `CLAUDE.md` rule 7.

### 7.4 Turning participation off must not break the department

Switches only remove the grants listed in 7.1. A department's own core functions (for example Marketing's campaigns and social tools, Technical's tasks) come from its role and module permissions, not from the participation policy. A test turns every switch off for every department and asserts that the department's non-sales permissions are unchanged.

### 7.5 Boundaries that stay in force

- `CLAUDE.md` rule 9: automations and the assistant may **assign, remind and draft**; they never move a stage, set a discount, approve, or record `CLOSED` attribution.
- `DECISIONS 4 #18`: Sales sees value only on deals they own. Participation never adds value visibility; sourced or assisted **revenue** is shown to a participant only if Management also grants `deals.view.value` (decision D-11).
- `DECISIONS 1.6`: `deals.handoff` to Delivery is unchanged.
- Reserved keys are never granted by a policy.

---

## 8. Sourced, owned, assisted and closed attribution

### 8.1 Today `[EXISTS]` and gaps

| Concept | Existing support | Gap |
|---|---|---|
| Sourced | `Lead.leadSourceId` (channel, not person or department); UTM only inside `Lead.qualificationData` JSON | no person, department, campaign or origin columns; **Deal has no source** (reachable only via `leadId`; direct deals have none); not copied on conversion |
| Owned | `Lead.ownerMembershipId` (nullable), `Deal.ownerMembershipId` (required); history only as `AuditEvent` rows (`lead.owner_reassigned`, `deal.owner_reassigned`) | no owner-history table; **reports credit the current owner** (`reportsV2Service.PER_PERSON`, `forecastService`), so reassignment moves credit |
| Assisted | none (closest: `DealHandoff.teamMembershipIds` for Delivery; `Activity.authorMembershipId`) | no sales-assist concept |
| Closed | `Deal.wonAt`; actor only in `AuditEvent` (`deal.outcome_changed`) and `DealMove` (short undo window) | no `closed_by`; conversion does not record the converter (`Deal.createdByMembershipId` copies the **lead's** creator, null for website leads) |

### 8.2 Principles of the model

1. The four concepts are **different facts, recorded separately**, never collapsed into one owner field.
2. **History is append-only.** Past attribution is never rewritten by a later reassignment.
3. Attribution survives conversion: a deal inherits the lead's sourcing by copy, not by a fragile join.
4. A person's **department at the time** is snapshotted, because people move departments.
5. Existing columns stay authoritative for **access** (`ownerMembershipId` decides who can see and edit now). The new ledger is authoritative for **history and reporting**.
6. Revenue is never split silently: sourced, owned, assisted and closed are reported as separate measures; assisted revenue is not added to direct revenue.

### 8.3 Data model `[PROPOSED]` (no schema change in this task)

One append-only ledger plus a participants table. Both are tenant tables (composite FKs, forced RLS, cross-org tests, export classification).

**`record_attributions`** (append-only; triggers refuse UPDATE and DELETE except a guarded supersede path)

| Column | Meaning |
|---|---|
| `id`, `organization_id` | identity, tenant |
| `subject_type` (`LEAD` or `DEAL`), `subject_id` | what is attributed |
| `kind` (`SOURCED`, `OWNED`, `CLOSED`) | which concept (assisted lives in participants) |
| `membership_id` (nullable), `department_id` (nullable) | who and which department at that time; department name snapshotted in `detail` |
| `lead_source_id`, `campaign_id`, `social_account_id` (nullable) | channel and origin for SOURCED |
| `origin` JSON | platform, account, item id, UTM, form id, original source key (frozen snapshot, section 12.8) |
| `effective_from`, `effective_to` | for OWNED intervals; point events use `effective_from` only |
| `recorded_by_membership_id`, `recorded_via` (`USER`, `AUTOMATION`, `FORM`, `API_TOKEN`, `BACKFILL`) | service actors named in audit as `DECISIONS 4 #11` requires |
| `reason`, `supersedes_id` | corrections create a new row pointing at the old one |

**`deal_participants`** (assisted-by)

| Column | Meaning |
|---|---|
| `deal_id`, `membership_id`, `department_id` (snapshot) | the contributor |
| `contribution` (`DEMO`, `SCOPING`, `PROPOSAL`, `SOURCING_SUPPORT`, `OTHER`) | what they did |
| `added_by_membership_id`, `added_at`, `removed_at` | lifecycle; removal ends the row, never deletes the fact |

### 8.4 How each concept is recorded

- **Sourced by.** Written **once** when the lead is created (capture, form, quick capture, import, card capture, API) or when a deal is created without a lead. Captures the person or system actor, their department, the lead source, and an `origin` snapshot. Immutable; a correction is a new superseding row with a reason (audited). On lead to deal conversion the lead's SOURCED row is **copied as a DEAL SOURCED row**, so direct, imported and converted deals all carry source and "lead deleted or archived" cannot erase it.
- **Owned by.** The existing `ownerMembershipId` columns stay. In addition every assignment writes an OWNED interval: the previous interval is closed (`effective_to`) and a new one opened. Lead pool claims, ask-to-take approvals, reassignments, conversion (owner inherits) and member deactivation reassignment all produce rows.
- **Assisted by.** Management or the owner adds participants (needs `deals.assist` for self-add where policy allows, or owner or Management for others). Multiple contributors, multiple departments. Contribution types are measured as counts and as "deals touched", not as shares of value.
- **Closed by.** One CLOSED row written in the same transaction as the move into a won stage (and an optional LOST variant for lost-analysis), recording the actor and their department. Because "closure" is derived from stage flags (`IMPLEMENTATION_NOTES`), the write hooks the stage move. Automations cannot write it (rule 9).

### 8.5 Transfers, changes and history

- **Ownership transfer:** closes the OWNED interval, opens a new one; SOURCED and CLOSED are untouched.
- **Employee leaves or changes department:** historic rows keep the old membership and the department snapshot; reassignment checklists (`reassignmentService.ts`) already leave won and lost history attributed to the member.
- **Merges:** company and contact merges keep attribution rows pointing at surviving records via the existing `MergeRecord` mapping.
- **Marketing keeps credit:** Marketing sources a lead, Sales converts and owns it, another employee closes it: the ledger holds SOURCED (Marketing person and department), OWNED (Sales owner, interval), CLOSED (the closer). Nothing is overwritten.
- **Technical assistance** is measured by `deal_participants` (deals assisted, won deals assisted) and **not** by crediting the sale to Technical.

### 8.6 Reporting `[PROPOSED]`

New report keys added to `REPORT_KEYS` in `reportsV2Service.ts` (additive; each renders as an R1 card, no new design). Existing reports are not changed.

| Measure | Definition | Source |
|---|---|---|
| Sourced opportunities | leads and direct deals with a SOURCED row in range, by person, department, source, campaign | ledger |
| Sourced to won conversion | sourced leads that converted, and converted deals that were won | ledger and `Deal.wonAt` |
| Direct sales performance | won deals by CLOSED person and by OWNED interval at win time | ledger |
| Assisted deals and assisted revenue | distinct won deals with a participant; value reported **separately**, never added to direct | participants |
| Sourced revenue | won value of deals whose SOURCED row matches | ledger and deals |
| Unattributed | deals or leads with no SOURCED row | ledger |
| Attribution timeline | the four facts for one deal on the deal detail drawer | ledger and participants |

**Masking:** every money column in these reports is registered in `valueColumns`/`valueRows` of `reportsV2Service.assemble` and in `tests/maskingAudit.test.ts` (`CLAUDE.md` rule 7). Counts and conversion rates are not money and may be shown to participants; revenue measures follow `deals.view.value` (D-11).

### 8.7 Backfill for existing data `[PROPOSED]`

Run per organisation, idempotent, marked `recorded_via = BACKFILL` and flagged `derived`:
- SOURCED for leads from `Lead.leadSourceId`, creator and (if present) UTM in `qualificationData`; for deals from `deal.leadId`.
- OWNED opening interval from creation using `createdBy`/owner; later intervals from `lead.owner_reassigned` and `deal.owner_reassigned` audit rows where available. Gaps are recorded as "unknown owner before date X", never guessed.
- CLOSED for won deals from `deal.outcome_changed` audit actors; where the audit row is missing the row is not created and reports show "closer unknown".
Backfill counts are reconciled (section 18.3).

### 8.8 Compatibility

New tables only; `Deal`, `Lead` and their DTOs are unchanged, so the frozen contract is untouched until responses expose the attribution timeline (additive fields). Existing reports keep crediting the current owner until Management opts into the new definitions. `leadIngestion.ts`, `leadService.convert`, `dealService.assignDeal` and the stage-move path gain ledger writes in the same transactions. Risk: these are central paths covered by many tests (`leadService`, `dealService`, `dealRules`, exit gates); the change is behind a module flag `attribution.ledger` so it can be enabled per organisation after verification.

---

## 9. Module registry and configuration

### 9.1 Today `[EXISTS]`

Release flags (`release.v1`, `release.v11`, `release.v2`), twelve organisation toggles (`TOGGLES`), platform overrides and limits, `resolveGatedContext` and `requireFeature` for API enforcement, `PERMISSION_MIN_RELEASE` stripping keys by release. `[MISSING]`: module registry, dependencies, plan or entitlement model, toggle UI. Known gap: **toggle-off does not strip permission keys** (only release does), so navigation can show items whose API answers `FEATURE_UNAVAILABLE`.

### 9.2 Design: a registry layered on the existing system `[PROPOSED]`

**No second feature-flag system.** The registry is a code-defined catalogue (`src/modules/registry.ts`) whose entries **generate** toggle definitions inside the existing `TOGGLES` machinery. Enablement is stored in the existing `OrganizationSetting` key `feature_toggles`; platform overrides use the existing `platform_flag_overrides`; enforcement uses the existing `resolveGatedContext`.

Each module declares:

| Field | Meaning |
|---|---|
| `key`, `name`, `description` | identity |
| `tier` | `FOUNDATION` (cannot be disabled), `CORE` (default on; disable only if no dependents), `OPTIONAL`, `EXTERNAL` (connector-backed) |
| `dependsOn` | required modules |
| `releaseMin` | existing release gate |
| `permissionKeys` | the keys that exist only because of this module |
| `nav` | the navigation items it contributes |
| `apiPrefixes` | route groups it owns (used by the coverage test) |
| `dataOnDisable` | `RETAIN_HIDDEN` for all modules (never delete) |
| `defaultEnabled` | for new orgs and for each template |

### 9.3 The six layers (distinct, as the brief requires)

```
 1 Platform availability   release flag + platform_flag_overrides        (can the platform offer it at all?)
 2 Commercial entitlement  platform-set entitlement or limits setting    (is this organisation allowed it?)
 3 Organisation enablement feature_toggles (Management switch)           (did the organisation turn it on?)
 4 User permission         permission keys (role + participation grants) (may this person use it?)
 5 Navigation visibility   buildNav consults 1-4 (a convenience only)
 6 Backend enforcement     resolveGatedContext(orgSlug, moduleKey) + requirePermission on EVERY route
```

Navigation is derived from 1 to 4 and is never the security boundary. Layer 2 is `[MISSING]` today (no plans exist, `DECISIONS 4 #8` defers billing): start with a platform-set `entitlements` setting per organisation, default "all released modules", and decide plans later (D-14).

### 9.4 Rules

- **Enforcement completeness:** a new test (`moduleGateCoverage`) walks the route table and fails if any route under a module's `apiPrefixes` lacks the module gate, mirroring how `apiWalk` covers authorisation.
- **Fix the known gap:** `effectivePermissionKeys` also removes the keys of any disabled module, so navigation, `can(key)` and the API agree. A test proves toggle-off hides the nav item and the API answers `FEATURE_UNAVAILABLE`.
- **Dependencies:** enabling a module requires its dependencies enabled (the wizard and Settings enable them together with an explanation); disabling is refused or warned when dependents are enabled (for example Invoices depends on Payments and Sales; Social Intelligence depends on Marketing and Integrations).
- **Configuration:** each module may have an organisation configuration JSON in `OrganizationSetting` (`module.<key>.config`) validated by the module's Zod schema.
- **Disable behaviour:** data is retained and hidden (read-only archived views remain reachable to Management for export), jobs and automations for the module stop, reports and search exclude it, exports include it, public endpoints and webhooks for it answer unavailable, and re-enabling restores everything. Nothing is deleted on disable.
- **Navigation integration:** `buildNav` gains a module requirement per `Def` (alongside the permission requirement). Dependencies shown in Settings explain why something is unavailable.

### 9.5 Foundation versus optional

| Tier | Modules | Why |
|---|---|---|
| FOUNDATION (always on) | identity and sessions, memberships and roles, organisation settings, audit log, notifications, search, files and attachments, contacts, companies, activities and tasks, saved views | every other module depends on them; disabling would orphan data or break security |
| CORE (default on) | **Sales (leads, deals, pipelines)**, handoffs and renewals, payments and invoices, reports and dashboards, import/export and data migration | disable allowed only when dependents are off; an organisation that does not sell (for example some NGOs) can run on the foundation plus other modules (D-8) |
| OPTIONAL | quotes and approvals, forecast and targets, communication group (mail, chat, video), assistant, sequences and automations catalogue, web forms and website capture, churn and customer health, e-sign (V2), developer tools (V2) | already behind toggles or releases today |
| NEW OPTIONAL | marketing and campaigns, social intelligence, projects and delivery, customer service (D-6), customer portal (deferred) | proposed |
| EXTERNAL | HR connector, inventory connector, accounting connector, payment provider | connector-backed, read-mostly (section 15) |

### 9.6 Future extensions

New modules are added by declaring them in the registry, their routes, permissions, nav and tests. The registry is the only place that lists them; the wizard, Settings tab and platform console read it.

---

## 10. Department workspaces

A workspace is a **department-oriented landing area**: a dashboard (section 11) plus the existing and new screens that department needs, shown in the sidebar by permission and module. They are composed from existing screens wherever possible. Each is a set of navigation entries and widgets, not a new application.

Every workspace below states the required fields. "Existing" is what is verified today; "Missing" is the gap.

### 10.1 Sales and Business Development

| Field | Content |
|---|---|
| Purpose | find, qualify, win and report on revenue |
| Primary users | Sales, Business Development, department heads, Management |
| Permissions | `leads.*`, `deals.*`, `tasks.*`, `quotes.*`, `forecast.view.all`, `targets.manage`, `reporting.view.*`, participation keys (section 7) |
| Main screens | Leads, Lead detail, Deals board, Deal detail, Tasks, Calendar, **Quotes** (new nav item), Forecast and targets, Reports, Team |
| Data | Lead, Deal, Task, Activity, Quote, SalesTarget, attribution ledger, participants |
| KPIs | new leads, qualified rate, conversion rate (overall and by source), pipeline value (masked), win rate, average cycle, forecast versus target, sourced/owned/assisted/closed measures |
| Workflows | capture, qualify, convert, move stages with rules, quote and approve, win and hand off |
| Dependencies | Sales module, Quotes (optional), attribution ledger for the four concepts |
| Existing | leads, deals, tasks, calendar, quotes (page not in sidebar), forecast, reports, team page `[EXISTS]` (audit section 4) |
| Missing | Quotes sidebar item, attribution reports and drawer timeline, participation, department-level view, targets by department |

### 10.2 Marketing and Social Media

| Field | Content |
|---|---|
| Purpose | generate and measure demand, engage audiences, hand qualified leads to Sales with attribution |
| Primary users | Marketing, social managers, department head |
| Permissions | `marketing.*`, `social.*`, `leads.create/source/qualify/transfer` per policy, `reports.departments.view` |
| Main screens | Overview, Campaigns, Content calendar, Publishing, Social accounts, Monitor and mentions, Unified inbox, Analytics, Lead attribution (section 12) |
| Data | Campaign, SocialAccount, SocialItem, SocialPost, lead attribution |
| KPIs | leads sourced, qualified leads transferred, cost per lead (if costs are entered), engagement, reach (where the platform provides it), campaign-attributed won revenue (masked), social-to-lead conversion |
| Workflows | plan campaign, schedule posts, triage inbox, convert interaction to lead, transfer to Sales |
| Dependencies | Marketing module, Social Intelligence (optional), attribution ledger, Integrations |
| Existing | none beyond lead sources, web forms and website capture, `Communication.channel = SOCIAL` unused, `Contact.socialProfiles` `[MISSING]` for all marketing models |
| Missing | everything in the table above (new module) |

### 10.3 Finance and Accounts

A practical finance workspace, not accounting.

| Field | Content |
|---|---|
| Purpose | issue invoices, record payments, watch what is owed, approve financial exceptions, report |
| Primary users | Finance, Management; Sales for their own quote and invoice drafts per policy |
| Permissions | `quotes.view`, `invoices.*`, `payments.record`, `finance.view.payments`, `finance.reports.view`, `finance.export`, `quotes.approve` |
| Main screens | Finance overview, **Quotes**, **Invoices** (new), Payments (existing), Approvals, Finance reports, Reconciliation |
| Data | Invoice, InvoiceLine (new), PaymentRecord, Receipt (new document), ApprovalRequest, RecurringService, Quote |
| KPIs | invoiced, collected, outstanding, overdue (with days), partially paid, average days to pay, quote acceptance, approvals pending |
| Workflows | quote to invoice, send, record payment, reverse payment with reason, void with reason, approve a financial exception, export |
| Dependencies | Payments and invoices (CORE), Quotes (optional) |
| Existing | invoices API with send, void, payments, export, summary; Payments screen centred on won deals; quote builder and approvals `[EXISTS]` (commercial map) |
| Missing | Invoices page, invoice create UI, invoice lines, tax and discount fields, invoice document, receipts, auto-numbering, reconciliation view, finance report and export keys, expense visibility (external, section 15) |

Expense visibility: expenses are **not** modelled here; they appear through an accounting connector read-only panel or are out of scope (D-16). Reconciliation support: an optional view that matches recorded payments against an uploaded statement CSV held in a scratch table; recorded payments are never changed automatically (Phase 5b).

### 10.4 Operations and Delivery

| Field | Content |
|---|---|
| Purpose | deliver what was sold on time and see workload |
| Primary users | Delivery, project managers, operations heads |
| Permissions | `deals.view.won`, `handoff.manage`, `tasks.*`, `projects.*`, `resources.*` |
| Main screens | Handoffs (existing), Projects (new), Milestones, Tasks, Resource and workload view, Delivery dashboard |
| Data | DealHandoff (existing), Project, Milestone, Allocation (new) |
| KPIs | projects on track, milestone slippage, utilisation, handoffs awaiting action, delivery cycle time |
| Workflows | receive handoff, create project, plan milestones, allocate people, track, deliver |
| Dependencies | Sales (handoff), Projects module |
| Existing | `DealHandoff`, handoff screens, onboarding-task template and automation `[PARTIAL]`; **no Project model** (verified) |
| Missing | Project, milestone, allocation, workload |

### 10.5 Customer Service and Success

| Field | Content |
|---|---|
| Purpose | answer customers, keep them, renew them |
| Primary users | Customer Service, Customer Success |
| Permissions | existing `communications.*`, `company_services.manage`; new `service.*` (only if D-6 approves) and `success.*` |
| Main screens | Conversations (existing), Renewals (existing), Customer health (new UI over existing backend), Onboarding checklists, optionally Tickets (D-6) |
| Data | Communication, RecurringService, ChurnHint (existing), Ticket tables (only if D-6) |
| KPIs | response time, resolution time, satisfaction, churn risk, renewal rate, health distribution |
| Workflows | triage enquiries, link conversations, track renewals, act on churn hints |
| Dependencies | Communication group, Customer module |
| Existing | conversations, renewals `[EXISTS]`; churn hints and health `[BACKEND]`; **ticketing deliberately removed** (`DECISIONS 5.0 #12`, migration `20261120090000_remove_customer_support`) |
| Missing | customer health UI, tenant-side tickets and SLA targets (blocked by D-6), satisfaction surveys (removed) |

### 10.6 Management and Administration

| Field | Content |
|---|---|
| Purpose | see how the organisation is doing and run it |
| Primary users | Management, administrators |
| Permissions | `reporting.view.all`, `forecast.view.all`, `quotes.approve`, `audit.view`, settings keys |
| Main screens | Organisation dashboard, department dashboards, Approvals, Reports, Team, Settings, Audit, Organisation structure (new) |
| KPIs | revenue summary (masked), finance summary, pipeline, department performance, approvals backlog, audit signals |
| Workflows | approve, review, configure, audit |
| Existing | management home, reports, approvals, team, settings, audit log `[EXISTS]` |
| Missing | department dashboards, organisation structure tab, role editor UI, module settings tab, attribution reports |

---

## 11. Dashboard architecture

**Today.** `dashboardService.ts:26` returns fixed section sets per role (`sales_today`, `management`, `delivery`, `finance`, `technical`, `my_metrics`), laid out by `Home.tsx`, `blocks.tsx`, `roles.tsx`. `[EXISTS]` but not configurable.

**Proposed: widget catalogue and layouts `[PROPOSED]`.**
- A **widget** is a code-defined unit: key, title, required permission keys, required module, the data endpoint (an existing operation or a new report key), masking behaviour, size. Existing sections become widgets one to one (compatibility: the default layout for each current role equals today's home).
- A **layout** is an ordered list of widgets per department workspace (and a default per role), stored as organisation configuration (`OrganizationSetting` `dashboard.layouts`), seeded from the template, editable by Management with `dashboard.widgets.configure`. Members still choose their start page (existing preference).
- A user sees the intersection of the layout and their permissions and enabled modules; a widget they cannot see is omitted, not shown empty.
- Not a free-form query builder: widgets come from the catalogue so masking and permissions stay enforceable (`CLAUDE.md` rule 7). Custom widgets are a later extension through new report keys.
- Visual: the existing `KpiTile`, `Card` and chart components, existing grid, no new look.

---

## 12. Social Intelligence architecture

**Status:** nothing exists. Models, screens and connectors are `[MISSING]`. What exists and is reused: lead sources as labels, `Communication.channel = SOCIAL` (unused), `Contact.socialProfiles` JSON, web forms and website capture, the OAuth connection framework, the job framework, the integration registry.

### 12.1 Screens `[PROPOSED]`

Overview, Social accounts, Monitor, Mentions, Unified inbox, Publishing, Content calendar, Campaigns, Analytics, Lead attribution, Activity log. Built from existing components (`DataTable`, `Drawer`, `KpiTile`, `Tabs`); the supplied screenshot is a functional reference only and was not available to the author. A calendar view reuses the existing tasks calendar patterns.

### 12.2 Honest capabilities and platform constraints

> The statements below reflect the author's general understanding of the platforms and **must be verified against each platform's current developer documentation and terms before any commitment**. Platform policy, review requirements and pricing change often. Everything here is `[UNKNOWN]` until verified.

| Platform | Likely supported through official APIs | Likely not available |
|---|---|---|
| Facebook Pages and Instagram business accounts (Meta) | managing owned Pages and linked business accounts; reading comments on owned posts; messaging within the platform's rules; scheduling and publishing to owned accounts; insights for owned accounts | general public brand-mention search across all users; scraping; messages outside the allowed window |
| LinkedIn | company page posting and basic analytics for approved integrations | broad listening; many APIs are limited to approved partners |
| TikTok | business account analytics and content posting for approved apps | unrestricted mention search or inbox access |
| Others | through connectors when an official API exists | anything requiring scraping or unofficial methods |

Typical requirements to document per platform before building: developer app registration, business verification, app review for each permission, test accounts and review timelines (often weeks), token lifetimes and refresh, rate limits, webhook support, data retention and deletion callbacks, and any cost (the APIs are often free but review effort is real; third-party listening tools are paid). **No scraping or unofficial access, ever.** Where a platform does not support a capability, the screen says so and offers the supported alternative (manual entry, import, or a link-out).

### 12.3 Connector architecture `[PROPOSED]`

There is **no generic connector abstraction** today (separate seams for mail, calendar and OAuth). Design one that does not disturb them:

- A `SocialConnector` interface declares **capabilities** (`listMentions`, `listComments`, `listMessages`, `reply`, `publish`, `schedule`, `insights`, `webhooks`). A connector implements only what its platform supports, and the UI renders from the declared capabilities.
- One folder per platform (`src/integrations/social/<platform>/`), each independently deliverable and testable with an injectable fake (the pattern in `src/integrations/mail/types.ts`).
- Authentication reuses the OAuth connection model (`OAuthConnection` with a new `kind = SOCIAL` and new provider keys, widening `OAuthProviderKey` and `KIND_PERMISSION`), with encrypted tokens under `INTEGRATION_ENCRYPTION_KEY`.
- Syncing runs through the job framework (`registerJob`), per organisation, with webhooks where supported.
- A registry entry in `integrationRegistryService` lists each connector with its status.
- Data is normalised into tenant tables: `social_accounts`, `social_items` (mention, comment, message; platform ids with a unique key for dedupe), `social_posts` (draft, scheduled, published), `campaigns`, `campaign_links`. All with RLS and export classification.
- Replies and publishing are performed by a person; the assistant may draft only (rule 9). Media passes the existing antivirus path.

### 12.4 Social interaction to lead

Converting an item creates a lead and writes a **SOURCED** attribution row whose `origin` freezes platform, account, item id, campaign id and original text reference, plus the matching `LeadSource` (the existing `FACEBOOK`, `INSTAGRAM`, `LINKEDIN`, `TIKTOK` keys). The original platform data stays recoverable even if the connector is later removed.

### 12.5 Compliance and cost

Social messages are personal data: retention periods, consent, deletion requests from platforms, and the Kenya DPA position (`docs/DATA_LOCATION_ASSESSMENT.md`) must be settled first. The ClamAV production host (`DECISIONS 6.5`, `7.6`) applies to media. Recommended: pilot **one** connector (for example Meta Pages and Instagram) only after approval status and legal checks (decision D-17).

---

## 13. Quotes and invoices pages and workflows

### 13.1 What already works (verified)

| Item | Status |
|---|---|
| `/o/{org}/quotes` page, real API, two views (open deals with their quote, all quotes), status pill, masked totals | `[EXISTS]` but **no sidebar link** (`navigation.ts`: "quotes are reached from a deal") |
| Quote builder `/o/{org}/quotes/{dealId}`, versions, lines from the catalogue, discount 0 to 30%, validity date, terms, preview, send, approval, response | `[EXISTS]` |
| Quote document: print-styled HTML, branded (name, accent, optional logo), English and Swahili; no server PDF | `[PARTIAL]` |
| Send by email, secure share link with tracking (views, expiry, revoke) | `[EXISTS]`; other channels `[MISSING]`; connected-mailbox send `[UNKNOWN]` |
| Approvals for discounts and large deals; requester cannot approve; automations never approve | `[EXISTS]` |
| `Quote` requires a deal (`dealId`); customer derived from the deal | `[EXISTS]` (customer not selectable on the quote) |
| Tax: per-line `taxable` flag, prices VAT-inclusive, 16% only in default text | `[PARTIAL]` (no rate field, no tax total) |
| Invoice model (`amount`, `dueOn`, status DRAFT, SENT, PART_PAID, PAID, VOID; OVERDUE derived), payments append-only with reversal, overdue reminders, CSV export, summary | `[EXISTS]` API |
| Invoice UI | `[PARTIAL]`: inside the Payments screen (won-deal centric), `InvoiceDialog` for view, record payment, reverse, send, void; **no UI calls `createInvoice`** |
| Invoice lines, taxes, discount, terms, document, quote link, auto-numbering | `[MISSING]` (number is typed by hand; invoice from a won deal only, via API) |
| Payments are records only; nothing is processed; hidden from everyone except Finance and Management | `[EXISTS]` and stays (`DECISIONS 2.5`, `9.1`) |

Permissions today: quotes use `quotes.create` (build, edit, send together) and `quotes.approve`; invoices and payments share `finance.view.payments` and `finance.manage.payments`. The brief's required distinctions (view, create, edit, approve, send quote; view, create, edit invoice; record payment; finance reports; financial export) are mostly `[MISSING]` as separate keys (section 6.3).

### 13.2 Sidebar placement `[PROPOSED]`

**Decision (recommended): one record, two natural entry points, each gated by permission, no duplication.**

```
 Sales workspace          After the sale (finance-facing)
   Leads                    Handoffs
   Deals                    Renewals
 * Quotes                 * Invoices
   Tasks                    Payments
   Calendar
   Team
```

- **Quotes** joins the **Sales workspace** section, directly under Deals. Route `/o/{org}/quotes` (existing).
- **Invoices** joins **After the sale**, directly above Payments. Route `/o/{org}/invoices` (new page over the existing API).
- Finance's workspace (section 10.3) shows both items because Finance holds the keys; Management sees both; Sales sees Quotes always and Invoices only if Management grants `invoices.view` (D-10). The items are the same routes and records everywhere, so nothing is duplicated and there is no second backend.
- Items use new `NavIcon` values and the existing `Def` shape; they appear only when the module is enabled (section 9) and the member holds a view key.
- Quick create gains "New quote" (opens the existing deal-first flow) and "New invoice" for holders of the create keys.
- Release gate: quotes stay behind `quotes.enabled`/V1.1 as today; invoices are not release-gated today and stay that way.

### 13.3 Quotes page: additive extension `[PROPOSED]`

Reuse `QuoteList.tsx`, `QuoteBuilder.tsx`, the document renderer and the share and approval services. Changes:
- **List:** filters (status, customer, owner, date range), saved views (existing `SavedView`), status summary chips (pending, accepted, rejected or declined, expired) built from existing statuses (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SENT`, `ACCEPTED`, `DECLINED`; expired is derived).
- **New quote button:** "pick a customer or company, then a deal (or create one), then the builder". A quote must keep a deal (a stored relationship the pipeline gates depend on); the **customer selection** is therefore a shortcut to the right deal, not a schema change. Deals require a company already, so selecting a company is consistent with the existing model.
- **Tax:** additive nullable columns on the quote version (`tax_mode` default `INCLUSIVE`, `tax_rate_bp`) plus an organisation tax setting, so current quotes (VAT-inclusive, 16% text) behave identically and new quotes can show tax lines and totals. Per-line discounts are an optional later step; the existing single percentage and the 30% cap and approval thresholds remain.
- **Document:** keep the HTML renderer; add a PDF download. PDF generation needs a method decision (D-13): browser print for Release 1 (no new dependency; works today), server-side rendering later (needs a decision on a library or headless renderer; `pdf-lib` is installed but low-level, and adding packages needs approval).
- **Share channels:** email (existing), **copy link** (new, same share row without an email), **WhatsApp click-to-chat** with the share URL (the WhatsApp integration is click-to-chat only), and connected-mailbox send (existing open item in `LATER_VERSIONS`).
- **Status tracking:** existing events (sent, viewed, revoked, expired visit) surfaced on the list and drawer. Accepted or declined remains a person-recorded response (and the client signature in V2).

### 13.4 Invoices page: additive extension `[PROPOSED]`

Build `/o/{org}/invoices` over the existing routes (`invoices` list with filters including OVERDUE, detail, send, void, payments, export, summary) and the existing `InvoiceDialog`.

- **List and filters:** status (draft, sent, partially paid, paid, overdue, void), customer, due range, search; totals and aging; saved views.
- **Create:** from a won deal (existing API rule: a non-won deal returns `DEAL_NOT_WON`), from an **accepted quote** (new endpoint, subject to D-9: `docs/PAYMENTS.md` calls it "an open decision"), or for a customer without a deal (existing API accepts `companyId`).
- **Invoice lines:** new `invoice_lines` table (Decimal(14,2) like `QuoteLine`) with description, quantity, unit price, taxable, tax. `Invoice.amount` stays authoritative and equals the lines total for new invoices; legacy invoices with no lines display a single virtual line and are never rewritten.
- **Terms and due date:** additive `payment_terms_days`, `terms` columns; `dueOn` stays required.
- **Numbering:** an organisation setting for auto-numbering with a prefix, using the same advisory-lock method as quotes (`quote-number:<org>`); manual typing remains allowed. Uniqueness stays case-insensitive per organisation.
- **Document:** HTML (and PDF per D-13) with the organisation's branding, shared with the invoice recipient by the same share-link mechanism as quotes (reusing `QuoteShare` patterns in a new `InvoiceShare`, or a generalised share table decided in design review).
- **Record payments:** unchanged, record-only. Split the action behind `payments.record`. Partial payment, balance, reversal with reason, overdue are existing behaviours. **Receipts:** a generated receipt document from a `PaymentRecord` (document only; still no processing).
- **Void:** unchanged (refused while payments exist; needs a reason).
- **Payment providers (M-Pesa and others):** remain **future optional connectors**; reopening needs a new issue with provider and sandbox keys (`LATER_VERSIONS B1`).

### 13.5 Financial access control

| Permission | Key | Default holders |
|---|---|---|
| View quotes | `quotes.view` | Management, Sales (own deals), Finance (read; see below) |
| Create quotes | `quotes.create` (existing) | Management, Sales |
| Edit quotes | `quotes.edit` | Management, Sales (own deals) |
| Approve quotes | `quotes.approve` (existing) | Management |
| Send quotes | `quotes.send` | Management, Sales |
| View invoices | `invoices.view` | Management, Finance; Sales only if granted (D-10) |
| Create invoices | `invoices.create` | Management, Finance; Sales draft-only if granted (D-10) |
| Edit invoices | `invoices.edit` | Management, Finance |
| Send invoices | `invoices.send` | Management, Finance |
| Record payments | `payments.record` | Management, Finance |
| View financial reports | `finance.reports.view` | Management, Finance |
| Export financial information | `finance.export` | Management, Finance; bulk above 500 rows still needs `export.bulk` |

Notes: Finance today holds no `quotes.*` key and so cannot read quotes (`quoteService` read keys); Release 1 gives Finance `quotes.view`. The compatibility rule in 6.3 keeps today's behaviour for every existing role. `DECISIONS 4 #18` and `CLAUDE.md` rule 7 are untouched: quote prices follow `deals.view.value` or ownership, cost and margin need `deals.margin`, payments stay hidden from anyone without `finance.view.payments`.

### 13.6 Approvals and reuse

`ApprovalRequest.kind` is a free `String` (`DISCOUNT`, `LARGE_DEAL`), so new kinds (for example `INVOICE_ADJUSTMENT`) are additive. Rules are decided by people; automations never approve (rule 9). Quote and invoice documents are masked per viewer; the audit log already treats `Invoice`, `PaymentRecord` and `DealPaymentNote` as payment entities hidden from readers without the key (`PAYMENT_ENTITIES`).

### 13.7 Conflicts to settle (see section 21)

C-5: Sales generating invoices versus "payments visible only to Finance and Management". Recommended resolution: invoices are not payments; Sales may create **draft** invoices for a won deal or accepted quote if Management enables it, seeing number, amount, due date and status SENT/DRAFT only; all balances, payments and overdue state stay hidden from Sales; Finance issues and chases. Needs D-10.

---

## 14. Other business modules

| Capability | Problem solved | Needed by | Dependencies | Core or optional | Priority | Today |
|---|---|---|---|---|---|---|
| Project and delivery management | track delivery after the sale | agencies, construction, professional services | Sales, handoffs | optional (new) | high (Phase 4) | `[MISSING]` (handoff only) |
| Customer service and ticketing (tenant-side) | answer customers' issues with SLAs | most B2C and B2B service firms | communication group, customers | optional (new) | medium; **blocked by D-6** | removed on purpose (`DECISIONS 5.0 #12`) |
| Customer success and retention | prevent churn, drive renewals | SaaS, subscriptions, services | customers, renewals | optional | medium (UI over `[BACKEND]`) | backend only |
| Workflow automation | remove repetitive work | all | automations | optional | low until D-15 | catalogue of 8 rules; rule 9 limits |
| Approval management | controlled exceptions | finance-sensitive teams | approvals | core (exists) | extend with new kinds | `[EXISTS]` |
| Document and contract management | store, version and sign agreements | professional services, real estate, recruitment | files, quotes e-sign | optional | low | e-sign V2 hidden; no repository |
| Business intelligence | cross-module analytics | medium and large organisations | reports | optional | Phase 7 | reports v2 `[EXISTS]` |
| Customer portals | customers see quotes, invoices, status | many | quotes, invoices | deferred (`DECISIONS 4 #8`, FIG-436) | Phase 7+ | `[MISSING]` |
| Integration management | connect external systems | all | integrations | core (registry exists) | Phase 3 and 7 | `[PARTIAL]` (registry, three live) |
| Advanced reporting | scheduled and cross-department reports | medium and large | reports | optional | Phase 7 | `[PARTIAL]` |

**Customer Support reintroduction (implications).** `DECISIONS 5.0 #12` removed the role, `tickets.manage`, the `customer_support.role` flag, the ticket and survey tables and the Support screens, and sent support to Michael's platform console by email (`docs/SUPPORT_BY_EMAIL.md`: "If the console wants replies to appear in the CRM, that is a new decision"). A tenant-side service module is different from Figbloom's own support, but it still needs a new dated decision, new tenant tables with RLS (not a revival of the removed ones; the `SURVEY_RESPONSE` enum value persists and cannot be dropped without a guard approval), a `not_available` to real change in Customer 360, a design-spec row, and a new permission set instead of a sixth system role. Recommended: keep it out of the first four phases and decide in D-6.

---

## 15. External system integrations, including HR and inventory

**HR and Inventory/Procurement are not CRM modules, accounts or departments, and no HR or inventory subsystem will be built without explicit product-owner approval.** Treatment:

- They are **external connectors** `[PLANNED]`: new registry entries in `integrationRegistryService` (which already carries `planned()` placeholders such as `ACCOUNTING` marked LATER), with read-mostly scope.
- **Possible value** (all optional, none in the first six phases): staff directory sync to invite or deactivate members (reduces double entry), leave and availability shown beside resource allocation, stock availability or price lists shown on quotes and deals, supplier or order status on a customer record, accounting balances beside invoices.
- **Mechanism:** a connection (OAuth or API key, using the existing `OAuthConnection` or integration settings), a sync job (`registerJob`), a small cache table per connector with tenant RLS, and **display panels** on existing screens. The CRM stores references and cached facts, not the master records; the external system stays the source of truth.
- **Out of scope:** payroll, leave approvals, stock movements, purchasing, goods receipt. If an organisation asks for them, that is a separate product-owner decision.
- **Department catalogue:** HR and Inventory are deliberately absent (section 5.2); a custom department can still be created by an organisation that wants one for assignment purposes.

Other integrations: payment providers (M-Pesa and others, future, optional), accounting, calendar and mail (exists), website capture (exists), webhooks and public API (V2, `[BACKEND]`), social connectors (section 12).

---

## 16. Customisation architecture

### 16.1 Terminology `[PROPOSED]`

A per-organisation map `terminology` (`OrganizationSetting`) of label overrides for UI copy and templates (for example `lead -> enquiry`, `deal -> opportunity`, `company -> client`, `handoff -> project start`). Resolved in the copy layer (`src/ui/copy.ts` is already the single copy deck, translation-ready), never in business code. Plural and case forms are part of each entry.

### 16.2 Make code independent of seeded keys `[PROPOSED]`

Code currently switches on seeded keys (`QUALIFIED`, `CONVERTED`, `CLOSED_WON`, lifecycle keys). Add a **semantic column** to the reference tables (`semantic_key`, nullable, backfilled from today's keys: `NEW`, `QUALIFIED`, `CONVERTED`, `LOST`, and so on) and switch code to read the semantic value, leaving the user-facing `key` and `name` editable. Stage outcomes already use flags (`isWon`, `isLost`). This removes the hard-coded-key risk (audit section 8) without changing any existing value.

### 16.3 Custom fields and entities

- Extend `CustomFieldEntity` additively if more entities need fields (the enum can only grow; each new value is usable only in a later migration; each new entity table needs a `custom_fields` column). Candidate entities: Project, Ticket (D-6), Campaign. Field types may grow (URL, email, currency, lookup) by adding enum values.
- No custom objects and no per-organisation schema (not proposed; D-9 asks whether needed).
- Role-level visibility of custom fields requires the masking surface per field (`DECISIONS 9.2`).

### 16.4 People who are not companies (B2C)

A Deal must have a Company (`Restrict`). Recommended (D-9): do **not** make `Deal.companyId` nullable. Introduce an additive `Company.kind` (`ORGANISATION` default, `INDIVIDUAL`) so a consumer is a company-of-one, keeping every query, report, invoice and handoff valid. Nullable `companyId` remains an option, with the contract and report consequences listed in section 17.3.

### 16.5 Other configuration

Pipelines per department or product (exists), stage rule types (fixed in code; additive new types allowed), automations (code catalogue; the builder question is D-15), lead sources, lost reasons, services and catalogue (exist), templates (email templates exist), forms (exist), saved views (exist), dashboards (section 11), approval rules (exist).

---

## 17. Database evolution

### 17.1 Principles

Expand, switch, contract (`DECISIONS 11.3`). Every migration is additive in the first release of a feature; contract steps need the written `-- migration-guard: approved-by=... reason=...` line. IDs stay UUID strings. Every new tenant table: `organization_id`, `@@unique([organizationId, id])`, hand-written composite FKs, `ENABLE` and `FORCE ROW LEVEL SECURITY` with a `tenant_isolation` policy and `WITH CHECK`, `db:grant-role` coverage, an `EXPORTED_TABLES`/`EXCLUDED_TABLES` classification, a cross-organisation test (`tenantAttack` covers new tables automatically), and a Prisma model (the hand-written constraints are not generated by Prisma, so the migration SQL is the source of truth).

### 17.2 New objects (all proposed)

| Group | Tables and columns | Phase |
|---|---|---|
| Onboarding | `organization_provisioning_runs`, `provisioning_outbox`; `OrganizationSetting` keys `onboarding.*`, `terminology`, `dashboard.layouts`, `module.<key>.config` | 1 to 2 |
| Departments | `departments`, `department_members`, `department_policies` | 2 |
| Attribution | `record_attributions`, `deal_participants` | 2 |
| Commercial | `invoice_lines`, `invoice_shares`; additive nullable columns on `quote_versions` (`tax_mode`, `tax_rate_bp`), `invoices` (`payment_terms_days`, `terms`, `quote_version_id`, `source`); receipts as generated documents | 5 |
| Reference tables | `semantic_key` on `lead_statuses`, `pipeline_stages`, `customer_lifecycle_states`; `Company.kind` | 2 to 3 |
| Marketing and social | `campaigns`, `social_accounts`, `social_items`, `social_posts`, `campaign_links` | 6 |
| Projects | `projects`, `milestones`, `allocations` | 4 |
| Users | `users.email_verified_at` (S-3) | 1 |
| Roles | namespacing of custom role keys per organisation (replace global `Role.key` uniqueness with `(organization_id, key)` using expand-contract) | 2 |

### 17.3 Change classes for structural questions

| Change | Class | Approach |
|---|---|---|
| New tables above | additive | per 17.1 |
| Multi-role membership | contract-heavy | **not recommended** (6.2); if ever needed: `membership_roles` join, dual-write, switch, contract with approval |
| `Deal.companyId` nullable | additive in SQL, wide in code | not recommended (use `Company.kind`); if chosen, contract 1.x change of the deal shape, every report, forecast, handoff, invoice and merge path, tenantAttack walk |
| Replace enums by reference tables | expand-contract | for `ActivityType`, `TaskType`, `LeadTemperature`: add reference table and nullable `*_id`, dual-write, backfill, switch reads, drop the enum column later with approval; `DROP TYPE` is not flagged by the guard but cannot happen before the column drop |
| New `CustomFieldEntity` values | additive, split migrations (a new enum value cannot be used in the same transaction) | per 16.3 |
| Invoice lines | additive | legacy invoices keep a virtual single line; sums reconciled (18.3) |
| Role key namespacing | expand-contract | needs approval for the contract step |

Lock risk on large tables is real (`20261023230000_deal_rules` locked `deals` about 9.5 s in the rehearsal): index and backfill steps use concurrent or batched forms and are rehearsed on a restored copy (`docs/MIGRATION_REHEARSAL.md` is V0 to V1 and 34 migrations behind; a fresh rehearsal is a Phase 1 task).

---

## 18. Existing data migration and preservation

**This is a first-class requirement.** The design treats data preservation as architecture, not as a script.

### 18.0 Discrepancy to resolve first

The brief says the current CRM "has a database containing real organisational and customer data". The evidence in the repository says otherwise: `docs/MVP_HANDOVER.md` describes a test deployment with fake data, `docs/REAL_DATA_READINESS.md` says "Do not put real customer data in yet", `DECISIONS 6.2` assumes a fresh organisation with no data to migrate, and the Neon deployment holds one organisation with one Management user (plus possibly test records). **No evidence of real customer data was found, and the audit could not query any database.** Where real data lives (another instance, a local database, spreadsheets, or the plan is for it to be loaded soon) must be confirmed (D-1). The design below works in either case and treats "real data exists in the authoritative database" as true.

### 18.1 Data inventory (what must be preserved)

The complete grouped inventory of all 135 models is recorded from `prisma/schema.prisma`; 113 carry `organization_id` with forced RLS. 129 models use client-generated UUID string ids; six have composite or foreign-key primary keys. Groups to preserve and their migration concern:

| Group | Examples | Concern |
|---|---|---|
| Tenancy and identity | Organization (slug unique), User (email unique), Membership, OrganizationSetting, OrganizationLifecycleEvent | **High**: root of every FK |
| Auth and security | Session, SignInEvent, two-step tables, ApiToken, IdempotencyKey | Medium; secrets need the same encryption keys |
| RBAC | Role, Permission, RolePermission, RoleFieldRule | Medium; system role and permission ids must stay stable (referenced by `memberships.role_id`) |
| Reference data and configuration | LeadSource, LeadStatus, PipelineStage, Pipeline, StageRule, Service, CatalogueItem, CustomFieldDefinition, EmailTemplate, AutomationRule | Medium; natural keys exist; default-pipeline triggers can duplicate on raw copy |
| CRM core | Company, Contact, Lead, Deal, DealMove, DealHandoff, ProposalReference, MergeRecord, tags, follows | **High**: the customer data; `customFields` JSON on Lead, Contact, Company, Deal |
| Activity, tasks, communications | Activity, Task, Communication, Comment, Notification* | High volume |
| Commercial and finance | Quote, QuoteVersion, QuoteLine, QuoteShare, QuoteSignature, ApprovalRequest, Invoice, PaymentRecord, DealPaymentNote, RecurringService, SalesTarget | **High**: money and legal evidence; locked-version and append-only triggers |
| Files and attachments | File, Attachment, CardCapture, import and export files | **High**: database row and blob must move together |
| Audit and compliance | AuditEvent, DataSubjectRequest, ExportApproval, platform audit tables (not Prisma models) | **High**: append-only; hash chain |
| Automation, jobs, imports | BackgroundJob, AutomationRun, FollowUp*, ImportSession*, DataRun, SyncMutation | Medium; transient |
| Integrations | OAuthConnection (AES-256-GCM tokens), OAuthState | High for secrets |
| Chat, mail, calendar | Chat*, MailDraft, CalendarEventLink | Medium; gap-free message `seq` |
| Platform and support | PlatformIdentity and sessions, incidents, announcements, support access | Medium |
| Web, API, webhooks | WebsiteApiKey, WebForm, WebhookEndpoint | Medium; public keys and signing secrets must survive |

Plus data outside the database: blobs under `orgs/<orgId>/<purpose>/<fileId>`. **On the MVP they live in `/tmp` and are volatile; nothing durable exists yet** (`docs/MVP_HANDOVER.md`, `AWS_MOVE_PLAN.md`). Sequences: none are Postgres sequences. `Quote.number` is a string unique per organisation generated under an advisory lock from the highest existing number; `Invoice.number` is free text unique case-insensitively per organisation; `ChatMessage.seq` is gap-free per channel. Copying rows preserves them; importing must not create gaps or duplicates.

### 18.2 Preservation principles (all binding)

1. **Never start empty, never overwrite.** Templates and seeds never run against existing data. Only `fillOnly` backfills.
2. **Preserve identifiers.** IDs are copied, not regenerated. **Organisation ids are never remapped**: storage keys embed the organisation id and the database enforces `files_storage_key_prefix_check`; a remap would break both. If a remap were ever unavoidable it would require rewriting every key and constraint and is a separate approval.
3. **Preserve the relationships and ownership** (composite tenant FKs, owners, handoffs, merges).
4. **Preserve history.** Append-only tables (audit, signatures, lifecycle, payments with reversals) are copied row for row; the platform audit hash chain is verified (`npm run audit:anchor`).
5. **Preserve secrets coherently.** Encrypted columns decrypt only with the same `TWO_STEP_ENCRYPTION_KEY` and `INTEGRATION_ENCRYPTION_KEY`; token hashes are copied as is (or the affected tokens are deliberately rotated and communicated).
6. **Idempotent and repeatable.** Re-running never duplicates (see 18.4).
7. **Source stays authoritative** until target approval (18.6). Never decommission the source database without explicit written approval.
8. **Prefer in-place evolution over data movement.** Most future structural change is additive migration on the **same** database, backfilled in place. Moving data between databases is used only for environment moves, and then as a **like-for-like dump and restore** (identical schema, identical ids), not as a transformation.

### 18.3 Two kinds of migration, two strategies

**A. Environment move (for example Neon to AWS).** Follow and extend `docs/AWS_MOVE_PLAN.md`: `pg_dump -Fc`, `pg_restore --no-owner --no-privileges`, `db:bootstrap-role` and `db:grant-role`, file sync, then verification. Because schema and ids are identical there is no field mapping. Open prerequisites: the AWS owner-role RLS check (S-2), a maintenance or write-freeze mechanism (none exists; proposed as a small additive feature), and the encrypted backup scripts proven by a restore.

**B. Structural migration (new tables, columns, semantic keys, invoice lines, department backfills, attribution ledger).** Done in place with expand-switch-contract and idempotent per-organisation backfills:
- **Checkpoints:** a small global ledger `data_migration_runs` (`migration_key`, `organization_id`, `step`, `status`, `rows_expected`, `rows_done`, `checksum`, timestamps, error) so a backfill can stop and resume per organisation and step. Each step is a set-based `INSERT ... ON CONFLICT DO NOTHING` or a keyed `UPDATE ... WHERE target IS NULL`, so repetition is a no-op.
- **Mapping tables** documented per migration (legacy status or enum to new value, for example lead status key to `semantic_key`, invoice amount to a single legacy line), reviewed at Gate 2.
- **Transformations:** pure SQL or a script run by the owner connection per organisation inside batched transactions; no data leaves the database.
- **Failure recovery:** a failed step leaves earlier completed steps intact and is retried; the migration guard prevents destructive statements; the restore point is a Neon branch plus an encrypted dump taken before the run (`docs/RUNBOOKS.md` section 14); contract (destructive) steps happen in a later release after verification.
- **Duplicate detection:** natural-key uniques (list in 18.1 and the audit), `ON CONFLICT` on them, and a post-run duplicate query per table.

**Not a migration route:** the in-app Data Migration (`ImportSession`) framework is for bringing **new customer data in from spreadsheets** (companies, contacts, leads, deals, tasks, activities); it creates new ids and does not cover invoices, quotes, payments or attachments, so it must not be used to move an existing database. The organisation export (`platformDataRequestService`) is a hand-back artefact, not a backup: it excludes secrets and file bytes, and there is no import-back tool.

### 18.4 Idempotency and re-run safety

Re-running must not duplicate data. Rules: natural-key `ON CONFLICT`; ledger step status; append-only guards refuse updates (so a re-run cannot corrupt history); the default-pipeline triggers are accounted for (copy pipelines before stages with triggers handled, or disable-and-verify within a controlled restore); and `seedOrganizationDefaults` is never called except with `fillOnly`.

### 18.5 Verification: proving nothing was lost

A migration is not successful because a script finished. Evidence required, using existing tools where they exist and naming the gaps to build.

| Check | Tool | Status |
|---|---|---|
| Source versus target row counts, per table, **grouped by organisation** | `npm run reconcile:counts` (counts per public table per organisation slug, plus global) | `[EXISTS]`; requires the owner connection so RLS does not hide rows |
| Counts by entity type and organisation (named matrix) | `reconcile:counts` output, archived as the evidence file | `[EXISTS]` |
| No table lost rows; RLS enabled and forced; policy per tenant table; app-role grants | `npm run verify:migration -- --snapshot-out/--snapshot` | `[EXISTS]`, but written and unproven on a real database; its check is `<` (extra rows pass), so equality must come from reconcile-counts |
| Sample record comparison (content hash of shared columns) | `reconcile:counts --sample` (default 200 deterministic ids) | `[EXISTS]`; raise the sample for money tables |
| Platform audit hash chain intact and every exported row present | `npm run audit:anchor -- check --database` | `[EXISTS]` |
| Backup and restore row counts, RLS and policies | `scripts/backup-drill.ts` | `[EXISTS]`; one real drill (366 rows) only |
| **Foreign-key and orphan validation** (every FK, including hand-written composite FKs, resolves) | new `scripts/verify-relations.ts` | `[MISSING]` |
| **Financial totals and balance reconciliation** per organisation and currency: sum of invoice amounts, payments, reversals, outstanding, quote totals, deal values | new `scripts/verify-financials.ts` | `[MISSING]` |
| **Custom-field reconciliation:** per definition, count of rows with the key and a value hash | new check | `[MISSING]` |
| **File verification:** every `File` row has an object of the right size, `checksum_sha256` matches on a sample (or all), `purged` rows excluded; also orphan objects with no row | new `scripts/verify-files.ts` (an "orphan report" is referenced in the docs but its code was not found, `[UNKNOWN]`) | `[MISSING]` |
| Duplicate detection (unique-key and natural-key duplicates, duplicate attribution rows) | new SQL checks | `[MISSING]` |
| Tenant isolation on the target | `tenantAttack` and `tenantAttackV11` against the target; `databaseSmoke` | `[EXISTS]` |
| Application regression | full suite (about 60 minutes on a fresh database, one run per database), Playwright, smoke | `[EXISTS]` |
| Migration logs and error report | the `data_migration_runs` ledger plus script output files kept with the release evidence; scripts already print names and counts only (no personal data) | `[PARTIAL]` |

**Acceptance criteria (all must hold; any failure blocks the gate):**
1. Zero missing rows in every table, per organisation. For like-for-like moves, counts **equal** (not just "not fewer").
2. Zero content-hash differences in the sample; for money tables (invoices, payments, quotes and versions, signatures, deals) **100%** of rows compared, not a sample.
3. Zero orphan rows and zero unresolved foreign keys.
4. Financial totals identical to the cent per organisation and currency.
5. Custom-field value counts and hashes identical per definition.
6. Every non-purged file present with matching size, and checksums matching for the agreed sample (all for signed or legal documents).
7. RLS enabled and forced on every `organization_id` table; the app role sees zero rows with no organisation set; cross-organisation tests green.
8. `prisma migrate status` clean on the target; migrations apply a second time as a no-op.
9. Platform audit chain verifies; no audit row missing.
10. Full suite and smoke test green on the target, and a named user from each role can complete a defined journey (read a customer, open a quote, view an invoice) with expected masking.
11. Duplicate checks return zero.
12. The evidence bundle (counts, hashes, logs) is stored and signed off.

### 18.6 Approval gates

| Gate | Name | Entry evidence | Approver |
|---|---|---|---|
| 1 | Complete source inventory | counts per table per organisation, file inventory, secret and key inventory, migration status, list of triggers and constraints | Given (technical), Michael |
| 2 | Approved source-to-target mapping | field and enum mapping tables, decisions on D-items, backfill rules | Given and Michael |
| 3 | Migration tested on a safe copy | restored copy of the source (anonymised only where the copy leaves its trust boundary), timings, lock times, failure and resume test | Given |
| 4 | Successful reconciliation | all checks in 18.5 passing, evidence bundle | Given |
| 5 | Application regression testing | full suite, Playwright, role journeys, tenant isolation on the target | Given |
| 6 | Product-owner approval | summary of evidence, risks, rollback plan | Michael (and Given) |
| 7 | Production cutover | write freeze, final dump, restore or migrate, connection change, grants, smoke | Given executing, Michael present |
| 8 | Post-cutover verification | repeat reconciliation on production, 24 h watch, hypercare checks | Given |

Rules: **the source remains authoritative and unchanged** until Gate 6 passes; rollback (repointing the connection strings to the source) is kept ready for at least 30 days and the source database is not decommissioned without explicit written approval; writes made on the target after cutover are lost on rollback unless replayed, which is why a write freeze is part of Gate 7. No migration in this document has been run, and no database was touched in this task.

---

## 19. API evolution

- **Contract:** frozen at 1.1.0 (`src/api/contract/openapi.v1.json`, 407 paths; hash in `docs/API_CHANGELOG.md`; `tests/apiContract.test.ts`). All new routes and fields are **additive minor** changes (target 1.2.0), added with `npm run contract:update` plus a changelog note. Removing a path, field or enum value, narrowing access, or making a field required is breaking and needs a new major version, which this design avoids.
- **Generated client:** `src/api-client/generated.ts` regenerates from the contract; the typed-client equality test enforces it. Every new screen uses `useApiQuery("<operationId>")`; no direct `fetch`.
- **Conventions kept:** Zod DTOs as the source of truth with strict response objects, one error envelope, offset pagination and filter standard, **idempotency keys on every new create**, `archived`/`masked`/`scope` on records, 404 for invisible records.
- **New route groups (illustrative):** `/departments`, `/department-members`, `/department-policies`, `/attributions` (read), `/deals/{id}/participants`, `/modules`, `/onboarding`, `/invoices/{id}/lines`, `/invoices/{id}/share`, `/quotes/{id}/versions/{v}/create-invoice`, `/receipts`, `/campaigns`, `/social/*`, `/projects`, `/dashboard/layouts`, `/terminology`. Each gets a Zod DTO, an access-matrix row and a walk test.
- **Existing responses grow additively** (for example an `attribution` object on deal and lead detail, a `modules` list in member context), never replacing fields.
- **Per-organisation dynamic data** keeps the existing envelope: custom field values stay in `customFields`; the static client is not generated per organisation. Terminology and labels are data returned by a dedicated endpoint.
- **Module gating on every new route** with `resolveGatedContext` and `FEATURE_UNAVAILABLE` (existing error and reasons).
- **Public API and webhooks** (V2, `[BACKEND]`) gain new events additively (`lead.sourced`, `invoice.sent`); the separate `/api/v1/openapi.json` follows its own versioning.
- **Deprecation:** nothing is deprecated by this design.

---

## 20. Security and tenant isolation

The audit's findings must be addressed in Phase 1, before self-service onboarding and before widening who can reach the system.

| ID | Finding | Proposed remediation | Verification |
|---|---|---|---|
| S-1 | `adminDb` (schema owner, bypasses RLS) used on tenant data in 136 files, about 95 call sites; isolation depends on each query's own organisation filter | (1) classify every call site into **allowed** (identity, bootstrap, platform, cron claim) or **tenant data**; (2) a lint rule and a test with an allow-list file that fails on any new `adminDb` use on tenant models outside it; (3) migrate tenant-data call sites to `withOrgContext` in priority order (`meetingService`, `conversationService`, `cardCaptureService`, `chatPrivacyService`, `privacyService`, `quickCaptureService`, `handoffService`, `activityService`), one service per change with its tests; (4) **new code never uses `adminDb` on tenant data** | allow-list test; tenantAttack; per-service tests |
| S-2 | forced RLS assumes an owner that bypasses RLS; an AWS RDS owner is not a superuser | prove it on the target before cutover: run the CI suite against a **non-bypass owner** role; choose one of (a) a dedicated `figbloom_system` role with the attribute required to bypass RLS (to be confirmed possible on the chosen AWS offering), (b) explicit owner-permitting policies, or (c) finishing S-1 so the owner path barely touches tenant tables; correct the misleading migration comment | CI job on a non-bypass owner; AWS rehearsal |
| S-3 | public signup with no email verification allows account pre-registration; an invite accept keeps the attacker's password | add `users.email_verified_at`; signup creates an unverified account and cannot be used to join organisations; **invite acceptance proves mailbox control**: if the user was created by public signup (unverified), the accept flow forces a password reset or replaces the password before activating the membership; existing users are backfilled as verified only if they were created through an invite or provisioning (decision D-5 for the rest); platform-provisioned first-admin invites follow the same rule | new tests for the pre-registration scenario (currently absent) |
| S-4 | `figbloom_app` can read `users` (including `password_hash`, lockout fields) and `password_reset_tokens` | replace the blanket grant with **column-level SELECT** on `users` (id, email, name, status and other non-secret columns) and **no access** to `password_reset_tokens` and credential columns (auth runs on the owner connection); update the hand-kept lists in `scripts/db-admin.ts`; applied by `db:grant-role` after migrations | new test: the app role cannot select `password_hash` or `password_reset_tokens`; `verify:migration` extended to check |

**Other security duties for new work:** every new tenant table gets RLS and a cross-org test (rule 8); jobs, webhooks, files and signed URLs check the organisation (new social, invoice-share and receipt endpoints included); masking is extended to every new money field and tested (rule 7); new `deals.value`-bearing report columns are registered for masking; new public endpoints (invoice share links) copy the quote-link pattern (hashed token, org from the share row, rate limits, expiry, revocation); social tokens use the existing encryption; the dev-account and seed guards (rule 10) are unchanged; no secrets or real data in templates (rule 11); the existing S-5 to S-10 findings stay on the Phase 1 register.

Self-service organisation creation (a product gap) is **not** proposed until S-1 to S-4 are closed and decision D-5 is made (`DECISIONS 4 #8` defers self-signup).

---

## 21. Backward compatibility and conflicts with approved decisions

### 21.1 Compatibility commitments

- Existing organisations, users, memberships, roles, data and URLs keep working; no forced wizard; no seed re-run.
- Five system roles unchanged in effective behaviour (snapshot test). No enum value removed; no protected key changed; `Deal.companyId` stays required; frozen auth pages untouched (rule 1).
- Contract additive only; generated client regenerates.
- Mobile and offline sync (`SyncMutation`, `public/sw.js`) keep their shapes; additive fields only; included in compatibility tests.
- Existing reports and exports keep their current definitions; new definitions are new report keys.
- `fillOnly` is the only seeding mode used on existing organisations.
- Every structural change carries its expand-switch-contract plan in section 17.

### 21.2 Conflicts with existing decisions (not silently changed)

| ID | Proposal | Conflicting decision | Options and recommendation |
|---|---|---|---|
| C-1 | Marketing and technical participation, departments | `DECISIONS 4 #12` "No new role until [Marketing/BD] are distinct people"; `1.1` five fixed roles | recommended: no new **system role**; Marketing and others are departments plus custom roles and participation policies (consistent with #12 and #9 "keep team scope possible") |
| C-2 | Tenant-side customer service module | `DECISIONS 5.0 #12` support removed, `docs/SUPPORT_BY_EMAIL.md` | needs a new dated decision (D-6); do not revive removed tables |
| C-3 | Sourced and assisted revenue visible to non-Sales departments | `DECISIONS 4 #18`, rule 7 | counts visible, revenue only with value visibility (D-11) |
| C-4 | New screens and modules | `design-spec/README.md` (92 screens fixed; DECISIONS wins), `TRACEABILITY.md` | each new screen gets a TRACEABILITY row and a recorded scope decision (C-6) |
| C-5 | Sales creating invoices | rule 7 and `MASKING.md` (payments visible only to Finance and Management) | D-10, recommended draft-only with payment data hidden |
| C-6 | Whole programme | `CLAUDE.md` and `DECISIONS 3.1/6.1`: scope is 92 screens, dates fixed (22 Nov) | needs explicit scope-growth decision and a new schedule; the 22 Nov date cannot hold for this programme |
| C-7 | Custom roles and role editor exposed | `DECISIONS 7.1` V2 hidden in the MVP | release the editor beyond V2 (D-7) |
| C-8 | Customer-facing signup and org creation | `DECISIONS 4 #8` self-signup and billing deferred (FIG-436) | not proposed before S-1 to S-4 and D-5 |
| C-9 | Workflow builder, SEND steps | rule 9, `DECISIONS 4 #15`, accepted finding 10.4 | any builder stays assign, remind, draft (D-15) |
| C-10 | Real-data migration | `DECISIONS 6.2` Path A "fresh org, no data" | D-1; update when real data exists |
| C-11 | Invoice from accepted quote | `docs/PAYMENTS.md` open decision | D-9 |
| C-12 | New modules that need Michael | `DECISIONS 6.14`: Michael's own sign-offs still open | every gate in 18.6 names Michael; all prior sign-offs were Given on Michael's behalf |
| C-13 | Production hosting | `DECISIONS 11.x` undecided; Hobby plan non-commercial; `5.2` no vendor-specific services | resolve before real data (`docs/REAL_DATA_READINESS.md`) |
| C-14 | Copy accuracy | `src/ui/copy.ts` says deal values are visible to "Management and Sales only"; `MASKING.md` and `4 #18` differ | fix the copy when touching masking (small, listed for the roadmap) |

### 21.3 Stale documents to refresh after approval

`CLAUDE.md` status (stops at M17 and the MVP; M18/M19 absent; "Next: M14 gates" stale), `docs/DATA_FLOW.md`, `docs/JOBS.md`, migration counts, `DECISIONS.md` numbering, test baseline. Not changed by this task; a proposed `DECISIONS` section for the approvals in section 24 and a pointer to this document in `CLAUDE.md` are to be added after review (they are not written now so that no existing document and no uncommitted edit is altered).

### 21.4 Visual design preservation

New screens are built only from `@/ui` components (Button, DataTable, Drawer, Dialog, Tabs, Card, KpiTile, Timeline, EmptyState, NoAccess and the rest of `src/ui/index.ts`), the existing tokens (`src/ui/theme`, `src/ui/ui.css` structural tokens, ten themes with SKY default), a stylesheet per screen whose selectors start with a `.fb-` class (guard: `tests/uiGuards.test.ts`), the list-plus-drawer pair as in `screens/leads` and `screens/team`, the Settings tab pattern for configuration, and copy from `src/ui/copy.ts` (say what happened and what to do next; name who can help; UK spelling). Controls that cannot be used say why (`disabledReason`); roles get explained no-access. No Tailwind, no new fonts, no new shell, no generic dashboard styling; WCAG AA for every colour pair. Every new screen adds a `TRACEABILITY.md` row and an authorisation test per role, and money-bearing screens join the masking scan. The role and social screenshots are functional references only and were not available to the author.

---

## 22. Testing strategy

Existing tests that must keep passing: `apiContract`, `apiWalk` and `apiWalkV11` (every route by role), `tenantAttack`, `tenantAttackV11`, `databaseSmoke`, `maskingAudit`, `uiGuards`, `frozenAuthSource`, `noDirectFetch`, migration tests, stage exit gates. The full suite takes about 60 minutes on a fresh database and only one run per database is safe; the test database accumulates throwaway organisations and slows tests, so recreate it periodically (`docs/M14_TEST_REPORT.md`). **The suite has not been run since the M19 work; a baseline run on a fresh database is the first Phase 1 task.**

New tests, by area:

| Area | Test |
|---|---|
| Compatibility | snapshot of each system role's effective permission keys before and after every phase; golden-file test that the `it-services-agency` template equals today's seed |
| Onboarding | provisioning rollback on failure; resume after crash; wizard apply idempotent (twice equals once); existing organisation never shows the wizard and is never reseeded |
| Departments and participation | participation switch off removes only the listed grants; department core permissions unchanged; participants see only sourced or assisted records, with masking |
| Attribution | invariants: one SOURCED per subject (corrections supersede); OWNED intervals contiguous and non-overlapping; CLOSED only by stage move; conversion copies SOURCED; reassignment does not change SOURCED or CLOSED; automations cannot write CLOSED; backfill idempotent |
| Reports | sourced, assisted and closed measures; masking of every money column; no double counting of assisted revenue |
| Modules | `moduleGateCoverage` (every route under a module prefix is gated); toggle-off hides nav and returns `FEATURE_UNAVAILABLE`; dependency enforcement; disable retains data and re-enable restores it |
| Role matrix | role columns generated from the database instead of five fixed columns; custom roles and participation grants in the walk |
| Commercial | quote to invoice; tax maths including legacy VAT-inclusive quotes; invoice lines sum equals amount; numbering lock under concurrency; payment, reversal and overdue; masking of invoices and receipts for each role; share link security (hashed token, expiry, revoke, rate limit) |
| Security | S-1 allow-list test; S-2 non-bypass owner job in CI; S-3 pre-registration scenario; S-4 column grants |
| Database | every new tenant table has composite FKs, forced RLS and a policy (extend `databaseSmoke`); a schema-wide check that every FK column has its composite tenant FK; upgrade-survival test: load a realistic current-schema dataset, apply the new migrations, run `reconcile-counts` and the new relation and financial checks (the rehearsal in `docs/MIGRATION_REHEARSAL.md` extended to current data) |
| Contract | additive-only check against the frozen file; old-client fixtures against new enum values |
| UI | component tests per screen, Playwright journeys per department, accessibility sweep, phone layout at 375 px; visual baselines for new screens need design approval and Linux baselines (open items today) |
| Social | connector fakes per platform; no scraping path exists (static check); token encryption |

---

## 23. Phased implementation roadmap

Estimates assume one developer working with Claude Code at the pace seen in this repository and are **rough (plus or minus 50%)**, for planning only. Work stays on `dev-given`, branches `makeover/<code>-<slug>`, Linear issues created only after approval (rules 4, 5, 13). The agreed cut order and "V1 never cut" stand.

### 23.1 Sequence

I recommend a sequence different from the brief in one respect: **pull the commercial pages forward as Release 1**, because most of the work is UI on an API that already exists, it delivers the clearest user value, and it needs only the small part of Phase 1 that concerns security.

```
 Phase 1 Foundation and preservation   (security, baseline, inventory)       ~3 weeks
 Release 1 Commercial pages quick win  (Quotes + Invoices in sidebar)        ~3 weeks (starts when Phase 1 security items S-3, S-4 land)
 Phase 2 Organisation configuration    (departments, roles, participation, attribution, templates, onboarding) ~8 weeks
 Phase 3 Module framework              ~4 weeks
 Phase 4 Department workspaces         ~10 weeks (can be sliced per department)
 Phase 5 Commercial depth              (lines, tax, receipts, reconciliation) ~4 weeks
 Phase 6 Social Intelligence           ~10 weeks after approvals and legal checks
 Phase 7 Advanced capabilities         ongoing
```

### 23.2 Phase detail

**Phase 1: Foundation and preservation** (independent; must come first)
- Deliverables: baseline full-suite run on a fresh database; S-3 and S-4 fixes; S-1 allow-list test and migration of the first call sites; S-2 non-bypass-owner CI job; fresh migration rehearsal on current data and a restored copy; commit and CI-run the migration guard and verify tooling; build `verify-relations`, `verify-financials`, `verify-files`; refresh stale docs; resolve D-1 (where real data lives) and D-2.
- Dependencies: none. Risks: touches auth and database roles (full regression needed); S-1 is large (95 call sites, one service per change).
- Acceptance: S-3 and S-4 tests green; allow-list test in CI; baseline suite green or its failures recorded; rehearsal evidence stored.
- Regression: auth, tenant attack, apiWalk, masking, migration tests. Database: `users.email_verified_at`, grant changes, no destructive step. External: none. Independent: yes.

**Release 1: Quotes and Invoices pages** (first realistic usable release)
- Deliverables: Quotes sidebar item (route exists); Invoices sidebar item and page over the existing API; invoice create UI (from a won deal, and for a company); permission split with seed-compatibility (`quotes.view/edit/send`, `invoices.*`, `payments.record`, `finance.reports.view`, `finance.export`); Finance gets `quotes.view`; filters, saved views, status chips; copy-link and WhatsApp share for quotes; browser-print PDF; tax rate setting and tax lines on new quotes; invoice terms and numbering setting; module and nav wiring for the two items.
- Not in Release 1: invoice lines table, receipts, invoice-from-quote (D-9), server PDF (D-13), Sales invoice drafts unless D-10 is decided.
- Dependencies: Phase 1 security fixes S-3, S-4; permission snapshot test; contract 1.2.0. Risks: new keys must not change any role's effective behaviour; money masking on new surfaces. Acceptance: each role's nav and access identical to today except the two new items for holders of the new keys; a Sales user creates and sends a quote end to end; a Finance user creates and sends an invoice, records a payment, sees overdue; masking scan green; contract hash recorded.
- Database: additive nullable columns only (tax and terms). Independent: yes, deliverable without Phases 2 to 7.

**Phase 2: Organisation configuration**
- Deliverables: departments and participation policy tables and UI (Settings tab); new sales permission keys with compatibility seeding; `sourced` and `assisted` scopes; attribution ledger and participants with write paths, backfill and the first reports; custom-role editor wired to the real API and role-key namespacing; template engine with `it-services-agency` and Build My Own; transactional provisioning and the setup wizard; terminology map.
- Dependencies: Phase 1; D-3, D-4, D-5, D-7, D-9, D-11. Risks: attribution touches central paths (conversion, assignment, stage move) behind a flag; role-key namespacing is an expand-contract change; the wizard must not touch frozen pages.
- Acceptance: golden-file template test; existing organisations unchanged; attribution invariants; participation switch tests; provisioning resume test.
- Regression: leads, deals, exit gates, apiWalk with the custom and participation grants, masking audit. Database: section 17.2 groups. External: none. Independent in slices: departments and templates can ship before attribution.

**Phase 3: Module framework**
- Deliverables: registry; generated toggles; dependency validation; nav and API enforcement; the stripped-keys fix; module Settings tab; `moduleGateCoverage` test; platform console view of entitlements.
- Dependencies: Phase 2 for departments in templates; D-8, D-14. Risks: retrofitting a gate to ~387 routes (done by prefix with the coverage test as the safety net). Acceptance: toggle-off proves both hide and deny; disabling retains data.
- Database: settings only. External: none. Independent: yes.

**Phase 4: Department workspaces** (sliceable)
- Deliverables, in this order: Sales additions and Management dashboards; Operations and Delivery with Projects (new tables); Customer Success UI over existing backend; Marketing basics (campaigns and attribution reports without social connectors); Customer Service only if D-6. Widget catalogue and layouts.
- Dependencies: Phases 2 and 3. Risks: each workspace needs design-spec rows and masking review. Acceptance: each workspace's KPIs match its definitions and masking tests. Independent: per workspace.

**Phase 5: Commercial depth**
- Deliverables: `invoice_lines`, tax and discount on invoices, invoice document and share link, receipts, invoice from accepted quote (after D-9), reconciliation view, financial approvals, finance reports, server PDF (after D-13).
- Dependencies: Release 1. Risks: money correctness; legacy invoices; numbering concurrency. Acceptance: totals reconcile to the cent; legacy invoices unchanged. Independent: yes.

**Phase 6: Social Intelligence**
- Deliverables: connector foundation and registry; one pilot connector; accounts, mentions, unified inbox, publishing, calendar, campaigns, analytics, lead attribution.
- Dependencies: Phases 2 (attribution) and 3; D-17 approvals, legal and platform review (weeks of external lead time); production antivirus. Risks: platform policy and review outcomes; data protection. Acceptance: official APIs only; origin snapshot preserved on conversion; no scraping path. External: developer app registrations and reviews. Independent: yes, per connector.

**Phase 7: Advanced capabilities**
- Automation extensions within rule 9, advanced customisation, HR/inventory/accounting connectors (if approved), industry packs, customer portal (deferred decision), advanced and scheduled reporting, business intelligence.

### 23.3 First realistic usable release

**Release 1** (after the Phase 1 security items): Quotes and Invoices in the sidebar with the permission split. It is small, based on an existing API and page, additive in the database, and independently valuable. The first release that changes organisation structure is **Phase 2 slice A** (departments plus the participation policy), because attribution and templates depend on it.

---

## 24. Product-owner decisions requiring approval

Each decision lists the recommendation. Until decided, the design records the item and does not guess.

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D-1 | Where does the real data live, and is any loaded now? | (a) none yet; (b) in the Neon MVP; (c) in another instance or spreadsheets | confirm; the design assumes real data may exist; update `DECISIONS 6.2` |
| D-2 | Approve scope growth beyond the 92 approved screens and the 22 Nov plan | approve with a new schedule, or defer | approve with the phased plan; record in `DECISIONS`; add TRACEABILITY rows |
| D-3 | Departments as structure, not roles; Head of Sales becomes a department-head feature | yes, or a fixed Head of Sales role (P2-14) | departments and heads, no new system role |
| D-4 | One role per membership plus participation grants | keep, or move to multi-role | keep; revisit only on a proven need |
| D-5 | Self-service organisation creation and signup verification | none now; verified signup then self-service; platform-only | platform-only until S-3 is fixed; revisit self-service after Phase 3 |
| D-6 | Tenant-side customer service and ticketing | stay out; build as a module with new tables; integrate an external helpdesk | stay out of Phases 1 to 4; decide after Phase 4 |
| D-7 | Expose the custom-role editor beyond V2 | yes, in Phase 2; no | yes |
| D-8 | May the Sales module be disabled | never; only with no dependents | only with no dependents; Foundation never |
| D-9 | B2C people and invoice-from-quote | `Company.kind = INDIVIDUAL` versus nullable `Deal.companyId`; allow invoice from accepted quote | `Company.kind`; allow invoice from accepted quote as a record only |
| D-10 | Sales access to invoices | none; draft-only with payment data hidden; full | draft-only, off by default, enabled by Management |
| D-11 | Revenue visibility for sourcing and assisting departments | counts only; revenue only with value visibility; revenue always | revenue only with `deals.view.value`; counts always |
| D-12 | Reserved (non-delegable) new keys | which of `departments.manage`, `finance.export`, `integrations.manage` | reserve `departments.manage`; delegate the other two to Finance and Management roles only |
| D-13 | PDF generation method | browser print; server-side renderer (new dependency); defer | browser print in Release 1; decide server-side in Phase 5 |
| D-14 | Commercial entitlement and plans | platform-set per organisation only; plans and pricing | platform-set per organisation for now; plans later (`DECISIONS 4 #8` defers billing) |
| D-15 | Workflow builder scope | catalogue only; builder limited to assign, remind, draft; broader | builder limited to rule 9 actions, later |
| D-16 | Expense visibility | external accounting connector panel; internal expense records; none | external panel; no internal expense records |
| D-17 | Social pilot platform and approval | Meta Pages and Instagram; LinkedIn; none | Meta first, after reviewing current API terms and legal checks |
| D-18 | Regulated-industry templates | after legal review; not at all | after legal review |
| D-19 | Hosting and plan decisions before real data | Neon paid plan, Vercel plan, AWS timing (`DECISIONS 11.x`, `REAL_DATA_READINESS`) | decide before any real data; independent of this design |
| D-20 | Who approves migration gates | Given only; Given and Michael | Given and Michael for Gates 2, 6 and 7 |

---

## 25. Appendix

### 25.1 What this design does not change

Frozen auth pages; the five system roles' effective behaviour; masking rules and reserved keys; payments as records only; the contract's existing fields; existing organisations' data and configuration; the migration guard and expand-contract rule; the job framework as the only scheduler; the design system and the sidebar shell.

### 25.2 Implemented versus proposed, at a glance

| Area | Implemented | Partial or backend only | Missing |
|---|---|---|---|
| Multi-tenancy, RLS, membership | yes | | self-service org creation |
| Roles | five system roles | custom roles (backend, V2) | department structure, participation, editor UI |
| Quotes and invoices | quote engine, invoice API, payments | Quotes page without nav; Payments screen with invoices | Invoices page, lines, tax, receipts, numbering, split permissions |
| Modules | release flags, 12 toggles, gate | | registry, dependencies, entitlements, toggle UI |
| Attribution | owner, creator, source label | audit rows as history | ledger, participants, reports |
| Marketing and social | lead-source labels, forms, capture | | everything else |
| Operations | handoff | | projects, milestones, allocation |
| Customer success | health and churn backend | | UI |
| Customer service | email to platform console | | tenant tickets (D-6) |
| Onboarding | platform provisioning, invites | | wizard, templates, resumable provisioning |
| Dashboards | fixed role sections | | widgets, layouts |

### 25.3 Diagram: separation of concepts

```
   User ----< Membership >---- Organisation
                 |   |  \
                 |   |   '--- Department seats (0..n) ---- Department ---- Sales participation policy
                 |   '------- Role (exactly one) ---- permission keys
                 '----------- Effective keys = role keys + department participation grants
                                                 - keys of disabled modules
                                                 - release-gated keys

   Module registry --> feature_toggles (existing) --> resolveGatedContext on every route
```

### 25.4 Diagram: attribution over a deal's life

```
 time ------------------------------------------------------------------------------>
 Lead created      Qualified        Converted         Stages            Won
  SOURCED(Marketing:Ann, dept=Marketing, source=FACEBOOK, campaign=Q4)
  OWNED [Marketing:Ann]----->[Sales pool]------>[Sales:Ben ...........]  (intervals)
                                  ASSISTED(Tech:Cara, SCOPING)  ASSISTED(Tech:Dev, DEMO)
                                                                   CLOSED(Sales:Eve at win)
 Reports: sourced revenue -> Ann/Marketing; owned/direct -> Ben, Eve; assisted -> Cara, Dev (separate, not added)
```

### 25.5 Diagram: module gating

```
 Request -> auth -> membership -> [module enabled? release? entitlement?] -> permission key -> handler
 Nav     -> same inputs, display only (never the boundary)
```

### 25.6 Evidence sources

`docs/UNIVERSAL_CRM_EXISTING_STATE_AUDIT.md`; read-only research for this document on commercial and finance implementation, attribution and marketing, canonical decisions and the design system, and data inventory and migration tooling; `CLAUDE.md`, `docs/DECISIONS.md` (working tree), `IMPLEMENTATION_NOTES.md`, `docs/FEATURE_FLAGS.md`, `docs/API_CONVENTIONS.md`, `docs/MULTI_ORGANISATION.md`, `docs/MASKING.md`, `docs/REAL_DATA_READINESS.md`, `docs/LATER_VERSIONS.md`, `docs/PAYMENTS.md`, `docs/QUOTES_AND_APPROVALS.md`, `docs/AWS_MOVE_PLAN.md`, `docs/BACKUP_RESTORE.md`, `docs/MIGRATION_REHEARSAL.md`, `docs/DATA_MIGRATION.md`, `design-spec/TRACEABILITY.md`, `docs/DESIGN_SYSTEM.md`. Items not opened and marked `[UNKNOWN]`: the screenshots, `design-brief/03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md`, Linear issues P2-14 and P2-15, the contents of `QuoteBuilder.tsx`, current Neon migration state, whether any backup or the cron-job.org caller is running, and current platform API terms for social networks.
