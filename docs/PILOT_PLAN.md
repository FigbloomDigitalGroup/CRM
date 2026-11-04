# Internal pilot plan (FIG-1130, P1.08)

Goal: a short live pilot with real FigBloom users to confirm V1 readiness against the measurable criteria in FIG-444 (`documents/FIG-444 Subscriber Readiness Plan and External Pilot Criteria.md`, sections 3, 4, 5 and 17). Acceptance (Linear): exit criteria met, or consciously waived by Michael and Given. Test: the pilot report (template in section 9, left empty).

Related: UAT in [UAT_V1.md](UAT_V1.md), defects in [QA_DEFECTS.md](QA_DEFECTS.md), staging in [STAGING.md](STAGING.md), go-live, Sev definitions and hypercare in [GO_LIVE.md](GO_LIVE.md), review after launch in [POST_LAUNCH_REVIEW.md](POST_LAUNCH_REVIEW.md). Everything stays on `dev-given` (CLAUDE.md standing decision). This file is a plan; it authorises no merge, tag or deployment, and it changes no Linear status.

## 1. Read this first: what a pilot of this length can and cannot prove

The plan has V1 live about **10 Nov 2026**, UAT and QA finishing 7 Nov (M11). That leaves roughly **4 to 5 days** for a pilot. FIG-444 was written for a pilot measured over weeks. So:

| Cannot be proven before go-live | Why | What we do instead |
|---|---|---|
| A7: A1 to A5 hold for 3 consecutive weeks | 3 weeks is longer than the whole remaining schedule | Record the first week as week 1 of 3. Keep running the same report weekly after go-live (hypercare, FIG-1131) and decide the waiver explicitly (section 8) |
| A1 and A5 as written (14-day window) | The window is longer than the pilot | Use the pilot length as the window and pro-rate nothing: report the number as measured and say so. Thresholds are read as "indicator only" |
| D1 (duplicates unresolved after 30 days) and D4 (stale after 30 / 14 days) | These need 30 days of age | On imported or refreshed data D4 shows the age of the data, not of the pilot. Report it as a data-quality snapshot, not a pilot result |
| "Primary operational CRM" (FIG-444 section 3 intent) | Pilot users still run their real work in the old tools until go-live | Ask pilot users to enter their real day's work in both places during the pilot (see section 2). Report how many did |
| Reliability and availability over time | Staging, not production; days, not weeks | Use the error and latency numbers from [OBSERVABILITY.md](OBSERVABILITY.md) during the pilot, and say it is a few days of data |
| Any external subscriber readiness | Out of scope: the pilot is internal. FIG-444 section 17 conditions for an external subscriber stay NO-GO until Given and Michael decide | Nothing in this pilot is evidence for an external pilot beyond what FIG-444 already lists |

A green pilot therefore means "no blocker found in a few days with real users". It does not mean "adoption is proven". Say this in the go/no-go meeting.

## 2. Pilot group, duration, environment

**Group (names left blank for Given; one person per role at least, so every role's screens and masking get used by a real person):**

| Role | Name | Primary task during the pilot | Backup |
|---|---|---|---|
| Management (at least 2 if there are 2 Management users; A6 needs every one) | | Reports, pipeline review, settings | |
| Sales (2 to 4) | | Enter real leads, move deals, tasks | |
| Delivery (1 to 2) | | Handoffs, onboarding tasks | |
| Finance (1) | | Payments and invoices (no real card or M-Pesa data into the CRM) | |
| Restricted Technical (1) | | Assigned tasks and requirements only | |
| Customer Support (0 or 1) | | Only if the `customer_support.role` flag is on for the pilot. The role is proposed and flagged off by default (DECISIONS 2.4); leave out unless Given turns it on | |

Pilot lead (names and answers the daily triage): ______. Engineering contact: ______. Decision makers: Given and Michael.

**Proposed schedule (compressed, between UAT and go-live; adjust to the real UAT end):**

| Day | Date (2026) | What |
|---|---|---|
| Prep | Wed 4 Nov to Thu 5 Nov | Staging up with the UAT data set (FIG-1123), pilot accounts created through the real invite flow, a 20 minute walkthrough per role, the SQL in section 6 checked by running it once on the UAT seed |
| P1 | Thu 5 Nov | Pilot starts. Users do real work in the CRM alongside the old tools |
| P2 | Fri 6 Nov | Triage, fix Sev-1 and Sev-2 only |
| P3 | Sat 7 Nov | Optional (UAT sign-off day in the plan); no triage meeting |
| P4 | Mon 9 Nov | Last pilot day. Run the report at midday, go/no-go meeting in the afternoon |
| Go / no-go | Mon 9 Nov | Decision recorded in section 8 |
| Go-live | Tue 10 Nov | Only if go, per [GO_LIVE.md](GO_LIVE.md) |

If UAT slips, the pilot slips with it and the go-live date is Given's decision; do not shorten UAT to keep the pilot. Real working days in the window: Thu, Fri, Mon (3), plus Saturday if used.

**Environment:** staging (see [STAGING.md](STAGING.md)), on plain PostgreSQL, loaded with the UAT seed and, where Given allows, an anonymised refresh; never real customer data unless Given decides otherwise in writing (CLAUDE.md rule 11). Pilot users therefore enter their real day's work as test copies. If Given prefers to run the pilot on production before go-live, say so in the decision log; production boot rules (no dev accounts) still apply.

**Entry conditions (do not start the pilot until true):** the V1 gate items open in [V1_QUALITY_GATE.md](V1_QUALITY_GATE.md) that block a role from working are closed or have a workaround (D-01, D-02, D-05 were open Majors when this was written; check the file); the smoke suite passes against staging; page-view recording is on; each pilot user has signed in once.

## 3. Exit criteria (from FIG-444) with measure and source

Thresholds are copied from FIG-444 (22 Oct 2026 version). "Today" says whether the number can be pulled now. Query ids refer to `scripts/adoption-report.ts` (section 6). Mark each as Met / Not met / Waived (by whom) in the pilot report.

### Adoption (FIG-444 section 3)

- [ ] **A1** Active CRM users: at least 80% of intended FigBloom users logged in and performed at least one create or update in the last 14 days. Measure: `A1.signed_in` and `A1.wrote` over `A1.active_members`. Source: `sign_in_events` (SUCCESS), and the union of `activities`, `leads`, `deals`, `tasks`, `audit_events` authors. Today: measurable. Window is the pilot length, not 14 days (section 1). "Intended users" = the ACTIVE memberships that Given names as the pilot group; the query counts every active membership, so compare with the list.
- [ ] **A2** New sales opportunities entered: at least 90% of leads and opportunities FigBloom actually pursues exist as a `Lead` within 48 hours of first contact. Measure: manual reconciliation of the old spreadsheet or inbox against `leads.created_at`. Today: **cannot be measured by the app**; a person compares lists (pilot lead). Counts: `A3.leads_created` gives only the CRM side.
- [ ] **A3** New leads captured: 100% of website-sourced leads (automatic) and at least 80% of manually sourced leads entered within 24 hours. Measure: `A3.leads_created` (and `A3.leads_created_by_import` to exclude imports) against the source log. Today: the CRM side is measurable; the "within 24 hours of first contact" part **cannot be measured**, because the app does not store the first-contact time. Needs: a "first contacted at" value from the source (manual), or a decision to treat `created_at` against the old log by hand.
- [ ] **A4** Deals maintained: at least 80% of open opportunities above a defined value threshold exist as a `Deal` with a current stage. Measure: `A4.deals_open`, `A4.deals_created`, `A4.deals_moved` against the known list. Today: counts yes; **the value threshold and the "known list" need Management** (deal values are masked by role, so the threshold check is done by a Management user in the app, not in this report).
- [ ] **A5** Follow-up and task usage: at least 70% of active Sales and Delivery users created or completed at least one task in the last 14 days. Measure: `A5.task_users_active` over `A5.task_users_eligible`. Source: `tasks`. Today: measurable (pilot-length window).
- [ ] **A6** Reporting usage: `/reports` visited by every Management user at least weekly. Measure: `A6.management_reports_viewers` over `A6.management_members`. Source: `page_views` (page `reports`, FIG-752). Today: **recorded, but no screen shows it** (section 5); use the SQL. Over a 7-day window; the pilot is shorter, so run it again in the first week after go-live.
- [ ] **A7** Consistency: A1 to A5 hold for 3 consecutive weeks. Measure: repeat the same report weekly. Today: **cannot be proven before go-live** (section 1). Needs a conscious waiver or a post-go-live check.

### Data quality (FIG-444 section 4)

- [ ] **D1** Duplicates: under 5% of records flagged by the existing duplicate detection remain unresolved after 30 days. Measure: re-run the duplicate detection across all records in read-only mode. Today: **not measurable from the app**; the detection runs at create time (`findPossibleDuplicate*`) and FIG-444 itself says a bulk scan is scripting work. Needs: a read-only bulk duplicate scan (not built), and 30 days. Interim: sample 20 companies and 20 contacts by hand, record the count.
- [ ] **D2** Missing ownership: 0% of leads, deals, companies and contacts with no owner, except leads created with no active Sales rep. Measure: `D2.leads_no_owner`, `D2.companies_no_owner`, `D2.contacts_no_owner` (deals always have an owner: the column is required). Source: tables. Today: measurable. Explain every non-zero lead against the no-Sales-rep fallback.
- [ ] **D3** Missing required fields: 0% placeholder values (for example "N/A" emails). Measure: manual sampling. Today: **cannot be measured by a query**; sample 30 records.
- [ ] **D4** Stale statuses: under 10% of open leads with no status change or activity in 30+ days; under 10% of open deals past the expected close date with no stage change in 14+ days. Measure: `D4.leads_stale` over `D4.leads_open`; `D4.deals_stale` over `A4.deals_open`. Today: measurable, but on a few days of use it measures the age of the loaded data (section 1). The lead query uses `updated_at` and activities as the "status change" signal because status changes are not stored as a separate timestamp.
- [ ] **D5** Incomplete companies: at least 90% of companies linked to at least one contact. Measure: `D5.companies_with_contact` over `D5.companies_total`. Today: measurable.
- [ ] **D6** Inconsistent pipeline data: 0% of deals whose outcome disagrees with the stage's won or lost flag. Measure: `D6.deals_outcome_mismatch`. Today: measurable; should be 0.
- [ ] **D7** Orphaned records: 0%. Measure: database constraints plus `tests/tenant-isolation.test.ts` and `tests/relationships.test.ts`. Today: by test, not by pilot data. Run those two test files on the pilot build (this is a test run by Engineering, not part of the report).
- [ ] **D8** Wrong organisation links: 0%. Same evidence as D7.

### Operational readiness and go / no-go conditions that apply to an internal pilot (FIG-444 sections 5 and 17)

- [ ] A real, non-local environment exists and has been running reliably (staging; production when it exists). Source: [STAGING.md](STAGING.md), [OBSERVABILITY.md](OBSERVABILITY.md).
- [ ] Real authentication in use (no dev sign-in): the pilot accounts were created through invites. Source: `memberships.invited_at`, `joined_at`.
- [ ] Tenant isolation and authorisation tests pass on the pilot build, run immediately before the decision (`tests/tenant-isolation.test.ts`, `tests/authorization.test.ts`). Engineering runs them and attaches the result.
- [ ] No critical unresolved defect on a core workflow (lead capture, qualification, conversion, pipeline, tasks, reporting): no Sev-1 and no Sev-2 open ([GO_LIVE.md](GO_LIVE.md) severities; QA_DEFECTS.md Majors).
- [ ] Masking held: no pilot user saw a deal value without permission, or any payment unless Finance or Management. Source: pilot feedback, and a masking walkthrough (Sales and Restricted Technical sign in and check).
- [ ] A named support owner and an escalation path exist (section 4).
- [ ] Data quality not materially below D1 to D6 (see the notes above).
- [ ] The permission matrix changes decided on 22 Oct (B1.01) are built: done in M1 (see CLAUDE.md); confirm against `docs/PERMISSION_MATRIX_REPORT.md`.

The external-pilot conditions in FIG-444 section 17 (named subscriber, migration and export for that subscriber, retention agreement) are out of scope for this internal pilot and stay NO-GO.

## 4. Daily triage routine

Same severities as [GO_LIVE.md](GO_LIVE.md) (Sev-1 to Sev-4; only Given and Michael change a severity). Pilot users report in one place (a shared channel or a form named by Given, one line each: who, role, page, what happened, what they expected).

| Time | Step | Who |
|---|---|---|
| Start of day | Run the adoption report (section 6) and the smoke suite against staging; note error rate and latency | Engineering |
| Start of day | Read overnight reports; give each a Sev, an owner and a next step | Pilot lead with Engineering |
| Midday | Quick check-in with each role: is anything blocking you | Pilot lead |
| End of day | Fix and retest Sev-1 and Sev-2; Sev-3 and Sev-4 go to the backlog list in [QA_DEFECTS.md](QA_DEFECTS.md) style; send the day's triage note | Engineering and pilot lead |

Triage note (post it as a comment on FIG-1130; comment only, status stays with Given):

```
Pilot day: __   Date: __   Triage by: __
Users active today: __ of __   Roles that did not sign in: __
Adoption report run: yes / no (attach counts)
New reports (id, who/role, page, Sev, owner, status): __
Open Sev-1: __   Sev-2: __   Sev-3: __   Sev-4: __
Masking or isolation concern raised? yes / no (if yes: stop, tell Given, treat as Sev-1)
Fixed today: __
Blocked / decision needed from Given or Michael: __
Feedback worth keeping: __
```

A masking or cross-organisation concern is always Sev-1 and stops the pilot until Given decides.

## 5. What the app records today (adoption data)

Found by searching the code, not assumed:

| Data | Where | Notes |
|---|---|---|
| Page views | Table `page_views` (organisation, membership, page label, time). Written best-effort after the response by `schedulePageView` in `src/services/pageViewService.ts`; labels are a fixed set: dashboard, leads, leads_detail, deals, deals_detail, companies, companies_detail, contacts, contacts_detail, tasks, reports, settings | FIG-752. No record ids, no query strings. Only these 12 labels: the M9 to M10 screens (preferences, mobile, finance, Customer Support, console, communication) are **not tracked** |
| Sign-in events | `sign_in_events` (SUCCESS, FAILURE, LOCKOUT, NEW_DEVICE) | Per organisation, with user id; no page-level detail |
| Sessions | `sessions` (`created_at`, `last_seen_at`) | Not organisation-bound for users without an organisation |
| Who wrote what | `activities.author_membership_id`, `leads/deals/tasks.created_by_membership_id`, `tasks.completed_at`, `audit_events.actor_membership_id` | Audit coverage is partial by design, so the report uses the union |
| Weekly usage summary for Management | `getWeeklyPageUsage` in `pageViewService.ts` (permission `reporting.view.all`), backed by `getPageUsageSummary` in `src/repositories/pageViews.ts` | **No screen or route calls it** (the search finds no caller outside the service). FIG-444 section 3 says the view is on the Reports page; in the rebuilt UI it is not |
| Super Admin console "adoption" | `src/ui/screens/platform/` (the Organisations list shows an adoption label such as "Low") | Demo data (`demo/` folder); not computed from real usage. Do not use it for the pilot |
| Support volume, availability | Nowhere | FIG-444 section 15 already says so; use the triage notes and [OBSERVABILITY.md](OBSERVABILITY.md) |

The design reference for this issue is D2 (adoption). If D2 is meant to be a Management screen over `page_views`, it is not built; see the decision for Given in section 10.

## 6. Pulling the adoption numbers

### 6.1 The script

`scripts/adoption-report.ts` runs every query below. It is read-only (one `BEGIN READ ONLY` transaction, one SELECT per number) and counts-only (a test refuses any statement that does not start with `SELECT count(` or that mentions values, amounts, payments or invoices). Run it against staging, never against a database you were not told to use:

```
ADOPTION_REPORT_DATABASE_URL=<read-only connection, held in the password manager> npx tsx scripts/adoption-report.ts --org <slug> --days 5
```

Use `--days` equal to the pilot length so far. There is no npm script; if Given wants one, the line to add to `package.json` is `"pilot:report": "tsx scripts/adoption-report.ts"` (not added by this issue). Use the owner or an administrative read role so row-level security does not hide rows (the report filters by organisation slug itself).

### 6.2 The same numbers as plain SQL (psql)

```sql
\set org 'figbloom'
\set days 5
-- A1: active members, signed in, wrote something
SELECT count(*) FROM memberships m WHERE m.status = 'ACTIVE' AND m.organization_id = (SELECT id FROM organizations WHERE slug = :'org');

SELECT count(DISTINCT m.id) FROM memberships m
  JOIN sign_in_events s ON s.user_id = m.user_id AND s.organization_id = m.organization_id AND s.outcome = 'SUCCESS'
 WHERE m.status = 'ACTIVE' AND m.organization_id = (SELECT id FROM organizations WHERE slug = :'org')
   AND s.created_at >= now() - (:days * interval '1 day');

-- A5: Sales and Delivery members who created or completed a task
SELECT count(DISTINCT m.id) FROM memberships m JOIN roles r ON r.id = m.role_id AND r.key IN ('SALES','DELIVERY')
  JOIN tasks t ON t.organization_id = m.organization_id
   AND ((t.created_by_membership_id = m.id AND t.created_at >= now() - (:days * interval '1 day'))
     OR (t.assignee_membership_id = m.id AND t.completed_at >= now() - (:days * interval '1 day')))
 WHERE m.status = 'ACTIVE' AND m.organization_id = (SELECT id FROM organizations WHERE slug = :'org');

-- A6: Management members who opened /reports (use :days = 7)
SELECT count(DISTINCT m.id) FROM memberships m JOIN roles r ON r.id = m.role_id AND r.key = 'MANAGEMENT'
  JOIN page_views p ON p.membership_id = m.id AND p.page = 'reports' AND p.viewed_at >= now() - (:days * interval '1 day')
 WHERE m.status = 'ACTIVE' AND m.organization_id = (SELECT id FROM organizations WHERE slug = :'org');

-- Visits and distinct visitors per page (counts only; no names)
SELECT page, count(*) AS visits, count(DISTINCT membership_id) AS visitors FROM page_views
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = :'org') AND viewed_at >= now() - (:days * interval '1 day')
 GROUP BY page ORDER BY visits DESC;

-- D2: open leads with no owner
SELECT count(*) FROM leads WHERE organization_id = (SELECT id FROM organizations WHERE slug = :'org')
   AND archived_at IS NULL AND converted_at IS NULL AND owner_membership_id IS NULL;
```

The remaining queries (A3, A4, D2 for companies and contacts, D4, D5, D6) are in the script; read them there rather than copying them twice. Each one is a count.

**Per-role breakdown.** To see which roles are not using the CRM without naming anyone, group the A1 sign-in query by `r.key` (join `roles`). Never output `users.email` or names into the pilot report; "Sales: 2 of 3 active" is enough.

### 6.3 Masking rules for the report

- No query reads `deals.value`, invoices or payments, so the counts are the same for every role and may be shared with the whole pilot group. Payments are visible only to Finance and Management (CLAUDE.md rule 7): do not add a payment count to a shared report, because even "3 payments recorded" tells a role who may not see payments that some exist.
- Value-based measures (A4's "above a defined value") are checked by a Management user in the app, which applies the masking itself, and the result is written down as a yes or no, not as an amount.
- The person running the SQL has database access that ignores application masking. That is why the statements are fixed and counts-only; do not run ad hoc queries on tenant tables during the pilot.
- Page-view rows hold a membership id; output only counts or per-role counts.

## 7. Go / no-go review agenda (60 minutes, Mon 9 Nov, afternoon)

Attendees: Given, Michael, pilot lead, Engineering. Papers: the pilot report (section 9), the adoption report output, [QA_DEFECTS.md](QA_DEFECTS.md), [V1_QUALITY_GATE.md](V1_QUALITY_GATE.md), the staging smoke result.

1. (5 min) What the pilot could and could not prove (section 1), read aloud.
2. (10 min) Adoption numbers against A1 to A6; A7 and the 14-day windows as waivers (name each).
3. (10 min) Data quality D1 to D8 with the manual samples.
4. (10 min) Defects: open Sev-1 and Sev-2, workarounds, anything raised about masking or isolation.
5. (5 min) Operational: staging stability, backup drill result, rollback owner named ([GO_LIVE.md](GO_LIVE.md) section 1).
6. (10 min) User feedback by role, and who is not ready (training, not product).
7. (10 min) Decision: go, go with named waivers, or no-go with the date to re-decide. Waivers need Michael and Given both (Linear acceptance criterion). Record in section 8.

## 8. Decision record (left empty on purpose)

| Item | Value |
|---|---|
| Decision (go / go with waivers / no-go) | |
| Criteria waived and the reason for each | |
| Waived by (Michael and Given) and date | |
| Conditions attached to go (for example "re-run adoption report on 17 Nov") | |
| Next review date | |

## 9. Pilot report template (empty)

```
Pilot report: FigBloom CRM V1 internal pilot            Period: __ to __ (__ days)   Environment: __   Build/tag: __
Prepared by: __   Date: __

1. Group
   Role | Invited | Signed in | Wrote something | Notes (no names)
   Management |  |  |  |
   Sales |  |  |  |
   Delivery |  |  |  |
   Finance |  |  |  |
   Restricted Technical |  |  |  |
   Customer Support (if used) |  |  |  |

2. Adoption (window __ days; counts from scripts/adoption-report.ts, attach the raw output)
   Measure | Threshold (FIG-444) | Actual | Met / Not met / Waived | Note
   A1 signed in / wrote | 80% |  |  |
   A2 opportunities entered | 90% (manual) |  |  |
   A3 leads captured | 100% web, 80% manual (manual) |  |  |
   A4 deals maintained | 80% (Management check) |  |  |
   A5 task usage | 70% |  |  |
   A6 reports viewed by every Management user | 100% weekly |  |  |
   A7 three consecutive weeks | 3 weeks | not measurable before go-live | Waived? |

3. Data quality
   D1 duplicates (sample of __) | <5% |  |
   D2 no owner (leads / companies / contacts) | 0 |  |
   D3 placeholders (sample of __) | 0 |  |
   D4 stale leads / stale deals | <10% / <10% |  |
   D5 companies with a contact | >=90% |  |
   D6 outcome mismatch | 0 |  |
   D7, D8 tests (tenant-isolation, relationships, authorization) | pass | run date __ result __ |

4. Operational: staging uptime __   error rate __   p95 latency __   jobs failing __   smoke suite __ (link)

5. Defects and feedback
   Raised __ ; fixed __ ; open Sev-1 __ Sev-2 __ Sev-3 __ Sev-4 __ ; masking or isolation concerns: none / (describe)
   Top 5 feedback items by role: __

6. What this pilot did not prove: __

7. Recommendation: go / go with waivers / no-go.   Waivers requested: __

8. Decision (section 8 of PILOT_PLAN.md): __   Michael: __   Given: __   Date: __
```

## 10. Decisions and actions for people

- **Given:** name the pilot group (section 2); confirm pilot dates against the real UAT end; decide staging or production for the pilot; decide whether Customer Support joins; say whether D2 (adoption screen) should be built or the SQL and script are enough for V1 (the usage summary has no screen today).
- **Given and Michael:** which of A7 and the 14-day windows are waived, and the go / no-go (section 8).
- **Pilot users:** use the CRM for real work on the pilot days and report problems the same day.
- **Engineering:** staging with the UAT seed, pilot accounts through invites, the report run each morning, the isolation and authorisation tests on the pilot build.
