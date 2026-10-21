# Figbloom CRM: screen inventory and role matrix

Sources: `prisma/seedData.ts` (`ROLE_PERMISSIONS`), `src/app/**` pages and API routes, planning documents FIG-297, 299, 300, 436, 437, 444. Status column is from code inspection on 19 Oct 2026: **Built** (exists and works), **Redesign** (exists, needs the makeover), **Missing** (required by the documents, no screen yet), **Future** (documents defer it).

## 1. Roles as seeded today

Five fixed roles. The six dev accounts are Management, Sales, Sales Two (a second Sales user), Delivery, Finance and Restricted Technical. The permission matrix is still **provisional** and needs Michael's confirmation (FIG-444, FIG-437 §18).

| Capability | Management | Sales | Delivery | Finance | Restricted Technical |
|---|---|---|---|---|---|
| Leads | all, create, edit, assign, convert, archive, import, export | own only: create, edit, convert, archive (no assign, import or export) | none | none | none |
| Deals | all, create, edit, archive, export | own only: create, edit, archive | view all (read-only) | view all (read-only), **sees values** | none |
| Deal value and proposals | value visible on every deal, proposals manage | sees the value of deals they own, proposals manage | value masked ("Values hidden") on every deal | value visible on every deal | none |
| Tasks | all, assign anyone | own, assign to self | own, create, assign to self | none | own, create, assign to self |
| Contacts and Companies | full, plus merge, import, export | view, create, edit, archive, merge (no import or export) | view only | view only | none |
| Company services | manage | manage | view | view | none |
| Activities | create, view | create, view | create, view | none | view only |
| Communications | view, create | view, create | view, create | none | view only |
| Reports | organisation-wide | personal ("my metrics") | personal | personal | none |
| Finance payments | view | none | none | view and manage (**no screen or model yet**) | none |
| Members and roles | view, manage, assign roles | none | none | none | none |
| Settings and integrations | organisation profile, integrations, reference data | notification preferences | notification preferences | notification preferences | notification preferences |
| Audit history | view | none | none | none | none |
| Bulk export | yes | no | no | no | no |

**Rule of thumb for design:** every screen must show a clear own-vs-organisation scope indicator, a "no access" state that explains *why*, and masked values where a role lacks `deals.view.value`.

### Mismatches between the documents and the seeded matrix (decide before design freezes)

1. **Delivery** should see client profile and scope **once a deal is Won** and be read-only on the pipeline (Questionnaire Q56). Today Delivery has `deals.view.all`, so it sees open pipeline too. It also has no project or deliverable screen.
2. **Finance** "cannot browse open pipeline or unqualified leads" (Q56), but today it has `deals.view.all`. Finance's payment permissions exist, but there is no payment model or screen.
3. **Restricted Technical** (developers and designers) should see "assigned projects plus the client requirements relevant to that work". With no project model, their app is only Tasks. Design needs a minimal "my assigned work" surface.
4. **Customer Support** is named in FIG-297 §23 but is not one of the five V1 roles.
5. **Sales** "sees own plus shared/unassigned pool" (Q56). Today Sales sees own records only. A shared "unassigned" pool view is a product decision.

## 2. Screen inventory

Navigation sections today: Overview (Dashboard), Sales Workspace (Leads, Deals, Tasks), Customers (Companies, Contacts), Reports, Settings. Top bar: global search, notification bell, theme toggle.

### Public and auth

| Screen | Route | Status | Notes |
|---|---|---|---|
| Login | `/login` | **Frozen, do not change** (decided by Given) | Email and password, rate-limited |
| Sign up | `/signup` | **Frozen, do not change** (decided by Given) | Creates an account with no organisation access |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Frozen with login (same look) | |
| Accept invite | `/accept-invite` | Frozen with login (same look) | Entry point for new members |
| Dev login, Sentry test | `/dev-login`, `/dev-sentry-test` | Dev only | Out of design scope |
| Organisation switcher | none | Missing / open decision | FIG-437 §18 leaves it open for V1 |

### Workspace

| Screen | Route | Status | Roles with access |
|---|---|---|---|
| Home / dashboard | `/o/{org}` | **Redesign, the biggest gap**: today four count cards, an "Overview" placeholder paragraph and an overdue list | All, content differs per role |
| Leads list | `/leads` | Redesign | Management, Sales |
| Lead detail | `/leads/{id}` | Redesign | Management, Sales |
| Lead create and edit (drawer) | in list | Redesign | Management, Sales |
| Lead convert to deal | inside detail | Redesign | Management, Sales |
| Lead import and export (CSV) | API plus UI | Redesign | Management |
| Qualification form (custom fields per service) | none | **Missing**: data field exists (`qualificationData`), no UI | Management, Sales |
| Deals board (Kanban) and list | `/deals` | Redesign | Management, Sales, Delivery, Finance |
| Deal detail (with proposals) | `/deals/{id}` | Redesign | same |
| Proposal references | inside deal | Built, Redesign | Management, Sales |
| Won-deal **handoff to delivery** | none | **Missing UI**; issue FIG-792 in progress (handoff dialog, onboarding task template, DEAL_WON_HANDOFF notification) | Management, Sales (start), Delivery (receive) |
| Tasks | `/tasks` | Redesign | Management, Sales, Delivery, Technical |
| Companies list and detail | `/companies` | Redesign | Management, Sales, Delivery, Finance |
| Contacts list and detail | `/contacts` | Redesign | same |
| **Customer 360** (single customer view: lifecycle, services, deals, tasks, timeline, payments, next follow-up) | company detail partly covers it | **Redesign and extend** | Management, Sales, Delivery, Finance |
| Company services | inside company detail | Built | Management, Sales (manage), others view |
| Merge duplicates | inside detail | Built | Management, Sales |
| Archive and restore | inside detail | Built | per record permission |
| Activity, communication and audit timelines | on every detail page | Built, Redesign | per permission |
| Reports | `/reports` | Redesign | Management (organisation), others (personal) |
| Report export | API | Built | Management |
| Global search | top bar | Built (new, FIG-787), Redesign | all |
| Notification bell and dropdown | top bar | Built, Redesign | all |
| **Notification centre** (full page) | none | Missing | all |
| **Organisation audit log** | API only | Missing page | Management |
| Settings: organisation profile | `/settings` | Built, Redesign | Management |
| Settings: members, roles, invites | `/settings` | Built, Redesign | Management |
| Settings: notification preferences | `/settings` | Built, Redesign | all |
| Settings: website integration (API key, assignment rules, acknowledgement, abuse protection, recent activity) | `/settings` | Built, Redesign | Management |
| Settings: inbound email integration | `/settings` | Built, Redesign | Management |
| Settings: reference data (lead sources, statuses, pipeline stages, lost reasons, services) | `/settings` | Built, Redesign | Management |
| Settings: **customer lifecycle states** | branch only | Built on unmerged branch (FIG-750, marked Done in Linear), not on `main` | Management |
| **Finance: payments and invoices view** | none | Missing, permission exists | Finance, Management |
| **Delivery: won-deal scope and deliverables** | none | Missing | Delivery |
| **Technical: my assigned work and requirements** | none | Missing | Restricted Technical |
| **Mobile quick-capture and my-day** | none | Missing; FIG-791 in progress (375px layout, tel: and wa.me actions, PWA) | Sales first, then all |
| Calendar view (month, week, day) | none | Missing; FIG-794 in progress. Provider sync is FIG-808, post-launch | Management, Sales |
| Customer reports (active, repeat, dormant, by salesperson, renewals) | none | Missing; FIG-793 in progress | Management |
| Pipeline drag-and-drop | none | Missing; FIG-790 in progress, needs a touch fallback ("Move to...") and a lost-reason prompt | Management, Sales |
| Dormant customers and renewals | none | Missing (Tier 2) | Management |
| Platform admin / tenant provisioning | script only | Future (FIG-444 defers advanced tenant admin) | platform staff |
| Billing, white-labelling, self-service onboarding | none | **Out of scope** (deferred, FIG-436) | none |

## 3. States every screen needs

Loading (skeletons), empty (first-run and filtered-to-nothing), error with retry, **no access** (role explanation, never a bare 403), archived and read-only (banner plus restore for permitted roles), masked value (deal value hidden), offline or slow connection (mobile), duplicate warning (warn, never block), overdue and stalled indicators, import and export progress and failure, success and undo toasts.

## 4. Scope indicators

Three levels appear throughout: **Own** (records you own), **Organisation** (everything, Management), **Read-only** (view without edit). Design one consistent pattern for each, such as a scope pill in the page header, and reuse it.
