# Figbloom CRM: audit report (documents vs code vs Linear)

Prepared 19 Oct 2026 for Given. Read-only audit. No application code was changed.

## 0. How complete is this audit

| Source | Status |
|---|---|
| Nine planning documents (FIG-297 findings and questionnaire, FIG-300 MVP scope, FIG-299 data model, FIG-298 research and buy-vs-build, FIG-436, FIG-437, FIG-444) | **Read.** The two long market-research documents (CRM research and buy-vs-build) were skimmed by outline only, since they inform vendor choice, not screens. |
| Code in `figbloom-crm` (schema, seed, pages, API routes, git history, `IMPLEMENTATION_NOTES.md`, `README.md`) | **Inspected.** Behaviour was read from code, not exercised in a running app. |
| Linear (Figbloom workspace) | **Read (read-only), CRM Project only.** 59 issues in "CRM Project" (P-FIG-17, due 22 Nov 2026, lead Given). Other projects in the workspace (HR, Property Management, Fleet, Smart Cart, mobile apps and so on) were listed by name only and not opened. Nothing in Linear was changed. |
| Tests | **Not run.** The database is unreachable from the sandbox VM. Several suites were written in recent sessions and are unverified (see section 6). |

## 1. Headline

The product is further along than a "66%" bar suggests, and most of what remains is **experience, not plumbing**. The backend already covers tenancy, auth, roles, leads, deals, tasks, activities, communications, audit, import and export, website and email capture, notifications and reporting. The gaps are (a) a dashboard that doesn't yet do what the stakeholder asked for, (b) the **sales-to-delivery handoff**, (c) a real **Customer 360**, (d) **mobile**, (e) role surfaces for Delivery, Finance and Technical, and (f) several documented automations. A makeover is therefore a design and front-end exercise on top of a mostly finished backend, which is why keeping all Done work is safe.

## 2. Requirement coverage

Legend: **Done** built and wired; **Partial** exists but incomplete; **Missing** no implementation; **Deferred** the documents themselves postpone it.

### MUST HAVE (FIG-300 §5)

| Requirement | Verdict | Evidence and gap |
|---|---|---|
| Authentication, RBAC | Done | Real sessions, invites, reset, rate limiting (FIG-592, 593, 784). Role matrix still provisional. |
| Lead creation, source, status, qualification | **Partial** | CRUD, source, status, temperature, lost reasons done. `qualificationData` exists in the schema, but **no UI** for service-specific qualification fields (FIG-297 §6). |
| Contacts, companies, central customer records | Done | Full CRUD, merge, archive, import and export, services. |
| Customer history and timeline | Done | Activity, communication and audit timelines on lead, deal, contact, company. |
| Deals and visual pipeline | Done | Kanban board and list, stage-driven outcomes, proposal references, value masking. |
| Tasks and follow-ups, overdue indicators | Done | Tasks per role, overdue derived, reminders sweep in production (FIG-783). |
| Core dashboards and reporting | **Partial** | Reports page is strong (organisation and personal). The **home dashboard is thin**: four count cards, a static "Overview" paragraph, an overdue list. |
| Website lead integration | Done | Public API, API key, abuse protection, assignment rules, acknowledgement, activity log (FIG-442, 594, 751). |
| Basic automation | **Partial** | Assignment, acknowledgement and overdue sweep done. See section 3 for the rest. |
| Audit trail | Done on records; **no org-wide audit page** | `audit.view` exists and the API exists. |
| Mobile access | **Missing as a designed experience** | Only two width breakpoints in `globals.css`. Nothing designed for phone use, quick-capture or tap-to-call and WhatsApp (FIG-297 §28). |

### SHOULD HAVE

| Requirement | Verdict |
|---|---|
| Email integration | Partial: inbound capture and send-email exist; two-way sync does not. |
| Calendar integration | Missing (provider undecided). |
| Advanced lead assignment | Done (rules by source and service). |
| Overdue flags | Done. |
| Proposal tracking | Done as references only, by design. |
| Custom qualification fields | Missing (UI). |
| Webhooks and API access | Partial: public lead API only. |
| Onboarding automation | Missing. |
| Role-specific dashboards | **Missing**: one generic home for every role. |
| Advanced reporting | Done (charts, export, documented metrics). |

### FIG-297 stakeholder asks that are not yet met

| Ask | Source | Verdict |
|---|---|---|
| Sales home: follow-ups due today, overdue (red), new leads since last login, moving or stalled deals, pipeline value by stage | Questionnaire Q53, FIG-297 §22 | Missing (only overdue count exists) |
| Management home: leads and conversion this month vs last, won/lost, revenue by service, dormant clients, renewals, salesperson performance | same | Reports page has most metrics; home does not, and dormant and renewals are absent |
| **Sales-to-delivery handoff** (Won, then customer status, onboarding, assign delivery) | FIG-297 §16, FIG-300 §4.9 | **Missing.** No workflow or screen. Lifecycle states exist as seed data only. |
| **Customer 360** (requirements, quotes, previous services, outstanding issues, assigned rep, next follow-up, payments) | FIG-297 §9, FIG-300 §4.4 | Partial: company detail aggregates timelines and services; no unified lifecycle, outstanding issues, or payment panel |
| Delivery sees client and scope only **after Won**, read-only pipeline | Q56 | Mismatch: Delivery sees all deals (open too) |
| Finance sees won values and payments, **not** open pipeline | Q56 | Mismatch: Finance sees all deals; no payment model or screen exists |
| Developers and designers see only assigned projects and relevant requirements | Q56, FIG-297 §23 | Missing: Restricted Technical has Tasks only; no project model |
| Sales also sees shared and unassigned leads | Q56 | Missing: Sales sees own only |
| Customer lifecycle states manageable | FIG-299 §4.9 | UI built and merged (FIG-750, PR #5, `d15ddbc`) |
| Dormant-customer and renewal reminders, proposal chase | Q58 Tier 2 | Missing (planned V2) |
| Mobile-first capture, notes after a call, tap-to-call and WhatsApp | Q61–62, Q73 | Missing |
| "Not a surveillance tool"; few mandatory fields; fast; no duplicates | Q72 | Design principles to keep (see brief) |

## 3. Automation boundary (keep in the design)

The stakeholder was explicit: **no automatic stage changes** (for example never move Proposal to Won). Automations support humans (assign, acknowledge, remind, flag stalled). The design should present automation as suggestions, flags and reminders, never as silent changes to the pipeline.

## 4. Architecture and operations vs FIG-444 (pilot readiness)

FIG-444 (29 Sep) listed gaps that the code has since closed: CSV import and export (FIG-596), Dockerfile, CI and deployment doc (FIG-595, `docs/DEPLOYMENT.md`), error tracking (Sentry, FIG-753), page-usage tracking for adoption metrics (FIG-752), rate limiting (FIG-784), tenant offboarding and data-deletion docs. Still open from FIG-444: Michael's sign-off on the permission matrix, backups and monitoring evidence, a provisioning runbook run for a second tenant, and the pilot go/no-go. The four V1 deferrals (billing, self-service onboarding, white-labelling, advanced tenant administration) stay **out of the design**.

## 5. Linear vs code (CRM Project, 54 issues)

**Counts (59 issues):** 37 Done, 8 In Progress, 4 Todo, 10 Backlog, which is 63% Done by issue count. Nine of the backlog issues sit in the "V1.1 – post-launch" milestone. Only one milestone exists. The project target date is **22 Nov 2026** ("end of Sprint 7").

### Done in Linear and confirmed in git on `main`
FIG-436, 437, 438, 439, 440, 441, 442, 592, 593, 594, 595, 596, 597, 598, 599, 600, 601, 602, 603, 604, 605, 751, 752, 753, 783, 784 (not re-checked in git history, but the rate-limit files are in the working tree), 785, 787, plus the research and planning issues 297–301, 444.

### Done in Linear but **not what main shows**: reconcile these first
| Issue | Linear says | Reality in the repo |
|---|---|---|
| **FIG-443** role-specific dashboards and reporting | Done (27 Sep): "Sales dashboard surfaces actionable work", "Management dashboard shows agreed V1 metrics" | The home page on `main` is generic: four count cards, a static "Overview" paragraph, overdue list. The Reports page is strong. The role-specific *home* the acceptance criteria describe is not on `main`. **Update 22 Oct (FIG-1009):** the reporting backend, Reports page and Overview card are on `main` (FIG-603, PR #4); only the role-specific home remains, re-scoped to the frontend makeover and the issue reopened. |
| **FIG-750** Settings UI for Customer Lifecycle States | Done | **Resolved 22 Oct (FIG-1009):** merged via PR #5 (`d15ddbc`). |
| **FIG-737** CI Node version fix | Done | **Resolved 22 Oct (FIG-1009):** merged via PR #3 (`92fb56f`) and PR #8 (`ff1f049`); CI on Node 22 is green on `main`. |

### In Progress in Linear (all moved to In Progress on 19 Oct, 09:47–09:48; same cycle)
| Issue | What it is | Overlap with the makeover |
|---|---|---|
| FIG-789 paginate list pages, dashboard uses counts | High, 5 pts | Touches every list page and the dashboard. Do it *with* the new list and dashboard designs, or the work is redone. |
| FIG-790 drag-and-drop deals between stages | High, 3 pts | Deals board redesign. |
| FIG-791 mobile-friendly layout, click-to-call, Open WhatsApp, PWA | High, 5 pts | The makeover's mobile design supplies exactly what this implements. |
| FIG-792 sales-to-delivery handoff on won deal | Medium, 5 pts | Needs a handoff dialog and onboarding-task template UI (design). |
| FIG-793 customer reports (active, repeat, dormant, by salesperson, renewals) | Medium, 5 pts | Reports redesign. |
| FIG-794 calendar view (month, week, day) | Medium, 3 pts | New screen (design). |
| FIG-786 review the orphan branch `sprint4/dashboard-overview-notification-fix` | High, 1 pt | Contains the dashboard overview card, a notification fix and a demo seed script. **The issue itself warns the branch was pushed during a malware incident (FIG-734); review for injected content before merging anything.** |
| FIG-788 update stale docs | High | Should wait until after the makeover decisions, or the docs go stale again. |

### Todo / Backlog (not started)
FIG-795 automatic reminders (proposal follow-up, renewals, dormant) Backlog; FIG-796 file attachments, FIG-797 email templates, FIG-801 e2e tests, FIG-802 CSRF protection (Todo); and the **V1.1 – post-launch milestone**: FIG-798 tags, 799 org-wide audit log screen, 800 import deals CSV, 803 custom fields, 804 outbound webhooks, 805 public REST API and tokens, 806 inbound email provider, 807 two-way email sync, 808 calendar sync.

### Requirements with no issue in Linear
- A designed **Customer 360** view (FIG-297 §9) and **customer lifecycle on the record**.
- **Role surfaces** for Delivery (won-deal scope), Finance (payments) and Restricted Technical (assigned work), and the permission-matrix mismatches in the role matrix document.
- **Notification centre** page (only a bell exists).
- **Qualification fields UI** (partly covered by FIG-803 custom fields, but that is post-launch).
- **Shared / unassigned lead pool** for Sales (Q56).
- A **design system and prototype** itself: no issue covers it.

### Timing risk
Eight issues are in flight, and V1 is due 22 Nov. A full makeover plus its implementation will not fit alongside them unless the in-flight UI issues (789–794) are **re-sequenced to build on the new designs** rather than the current screens. Backend-only work (reminders FIG-795, CSRF FIG-802, API and webhooks) is unaffected and can continue.

## 6. Local working-tree state (needs your action, not mine)

- **68 uncommitted changes**: the Companies, Contacts, Tasks and Reports revamps from recent sessions, auth rate-limiting files and a migration (`20261015110619_auth_rate_limiting`).
- Vitest suites for companies, contacts, import, audit, reporting, tasks and the earlier lead and deal work were **written but never run**. Run them where the database is reachable before committing.
- Recommended baseline before any makeover work: run tests, commit, then tag `pre-makeover`. Done only when you ask.
- `NoLeadAccess.tsx` is a leftover alias that can be deleted.

## 7. Risks to manage

1. **Permission-matrix churn**: the makeover will make role differences very visible. Get Michael's sign-off on the matrix (section 1 of the role matrix lists five mismatches) before the prototype is frozen.
2. **Scope creep**: the documents defer project management, invoicing, payments processing, WhatsApp API, AI and a customer portal. A "Delivery" or "Finance" screen must stay a thin view, not a new product.
3. **Adoption** is the documented failure mode (FIG-297 §42). Design for speed and low friction first.
4. **Logo and CSS colours differ slightly** (logo `#2D5524` / `#FF9900`, CSS `#1f5c3a` / `#ff9400`). Choose one.
5. **Sign-up page**: it exists but grants no org access; decide whether it survives V1.

## 8. Recommended path (unchanged from earlier advice)

1. Reconcile the three "Done but not on main" items in section 5 (FIG-443, 750, 737), and review the orphan branch (FIG-786) for injected content.
2. Run tests, commit and tag `pre-makeover`.
3. Build the prototype in Claude Design from `02-CLAUDE-DESIGN-BRIEF.md`.
4. Update Linear in a new project ("Experience Makeover v2") with milestones per area. Leave Done issues alone.
5. Implement in vertical slices, role by role, starting with the dashboard and mobile capture.
