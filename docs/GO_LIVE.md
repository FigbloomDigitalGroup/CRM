# V1 go-live: freeze, cutover, smoke tests, hypercare (FIG-1131, P1.09)

Goal: V1 is live in production and stable. Acceptance: the smoke suite is green in production and no Sev-1 is open at the end of hypercare.

Related: cutover steps in [CUTOVER_PLAN.md](CUTOVER_PLAN.md) (P1.05), monitoring in [OBSERVABILITY.md](OBSERVABILITY.md), staging in [STAGING.md](STAGING.md), deploy sequence in [DEPLOYMENT.md](DEPLOYMENT.md). Everything stays on `dev-given` until Given says otherwise (CLAUDE.md standing decision); this document describes the production procedure, it does not authorise any merge or tag.

## Date decision for Given (read first)

The plan has V1 live about **10 Nov 2026**. Two weeks of hypercare from 10 Nov ends about **24 Nov 2026**, which is **after the fixed project date of 22 Nov**. Both cannot hold as written. **Given must decide** one of:

1. Hypercare overlaps V1.1 and V2 work and is formally allowed to end on or after 22 Nov (project date unchanged, hypercare closes after it).
2. Hypercare is shortened to end on 22 Nov at the latest (about 12 days).
3. Go-live moves earlier (not realistic against M11).

Until Given decides, this plan assumes option 2 and counts the end-of-hypercare criteria below as the gate, not the calendar.

## 1. Preconditions (go / no-go, the day before)

- [ ] M11 closed: no open Urgent or High defect in `docs/QA_DEFECTS.md`; UAT signed (`docs/UAT_V1.md`).
- [ ] M12 issues done: staging (FIG-1123) through P1.08, including the backup drill and restore.
- [ ] Production environment variables set; `ALLOW_DEV_ACCOUNTS` unset or not `true`; no dev account exists (boot fails otherwise).
- [ ] Smoke accounts created, one per role, with strong unique passwords held in the team password manager (never in files or commits).
- [ ] Rollback owner and the database restore point named (see section 5).
- [ ] The same smoke suite has passed against staging.
- [ ] Go / no-go recorded below by Given.

## 2. Announce and freeze

| When | Action | Owner |
|---|---|---|
| T-3 days | Announce the go-live date, window and expected downtime to all users | Given |
| T-3 days | Freeze: no new features or migrations on the release branch; fixes only with Given's say-so | Given |
| T-1 day | Final staging smoke run; confirm backups ran | Engineering |
| T-1 day | Remind users; publish the support route (who to message, where) | Given |
| T-0 | Post the "starting now" notice | Given |

## 3. Cutover

Follow [CUTOVER_PLAN.md](CUTOVER_PLAN.md) step by step (data migration, migrations, deploy, DNS or routing, feature flags). Record the start and end time and any deviation at the bottom of this file. Do not improvise steps; if a step fails, apply the rollback triggers in section 5.

## 4. Smoke run and monitoring watch

### Smoke run (production, read-only)

Suite: `e2e/smoke/production.spec.ts`. For each role (Management, Sales, Delivery, Finance, Restricted Technical, Customer Support) it signs in through the real login (dev sign-in must be closed in production and the suite checks that), lands on home, opens the role's main screens with no 5xx and no uncaught page error, checks masking (Sales sees no Payments; Restricted Technical sees no values or finance figures; roles without payments get a refusal from the API), and signs out. It only reads: no creates, edits or deletes.

Variables (a role missing its pair is skipped with a message, so check the run shows 7 passed, not skipped):

```
SMOKE_BASE_URL=https://<production address>
SMOKE_ORG_SLUG=<slug, default figbloom>
SMOKE_MANAGEMENT_EMAIL / SMOKE_MANAGEMENT_PASSWORD
SMOKE_SALES_EMAIL / SMOKE_SALES_PASSWORD
SMOKE_DELIVERY_EMAIL / SMOKE_DELIVERY_PASSWORD
SMOKE_FINANCE_EMAIL / SMOKE_FINANCE_PASSWORD
SMOKE_TECHNICAL_EMAIL / SMOKE_TECHNICAL_PASSWORD
SMOKE_SUPPORT_EMAIL / SMOKE_SUPPORT_PASSWORD
```

Command (script name to be confirmed by the lead): `npx playwright test -c e2e/smoke/playwright.smoke.config.ts --grep @smoke`. The HTTP-level `scripts/staging-smoke.ts` covers staging only. Pass criterion: all 7 tests pass, none skipped. Attach the HTML report to the go-live record.

Role rules in the suite were written from `docs/PERMISSION_MATRIX_REPORT.md` and `e2e/qa/role-journeys.spec.ts`; if a role's access changes, change both.

### Monitoring watch

Watch the dashboards and alerts in [OBSERVABILITY.md](OBSERVABILITY.md) continuously for the first 4 hours, then hourly until end of day 1: error rate and 5xx, latency, login failures, job queue depth and failures, database connections and disk, backup status.

## 5. Rollback trigger criteria

Roll back (or flip the feature flag off, whichever the cutover plan names for that failure) when any of these holds and cannot be fixed within 30 minutes:

- Any Sev-1 (below) in the first 24 hours.
- Smoke suite fails on login, home or masking for any role.
- Data from one organisation visible to another, or payments visible to a role other than Finance or Management (also report as a security incident).
- 5xx rate above 2% of requests for 10 minutes, or the app unreachable for 10 minutes.
- Migration or data load fails or leaves counts that do not match the cutover reconciliation.
- Data loss or corruption confirmed.

Decision maker: Given (Michael informed). The restore point and the exact commands are in CUTOVER_PLAN.md. After a rollback, write a short incident note and re-plan the cutover.

## 6. Hypercare schedule

Length: two weeks from go-live (see the date decision above). Staffed support during working hours; on-call contact named in the announcement.

| Period | Cadence |
|---|---|
| Day 1 (go-live day) | Continuous watch, smoke run at start, after 4 hours and at end of day; triage every 2 hours |
| Days 2 to 5 | Smoke run each morning; triage at start and end of day |
| Days 6 to 14 | Smoke run each morning; one triage a day; weekly summary to Michael on day 7 and day 14 |

### Severity definitions

| Sev | Meaning | Response | Fix target |
|---|---|---|---|
| Sev-1 | Production down; data loss or corruption; cross-organisation exposure; payments or values shown to a role that must not see them; nobody can sign in | Immediately, whoever is available | Same day, or roll back |
| Sev-2 | A main V1 flow is broken for a role with no workaround (create lead, move deal, record payment) | Within 2 hours | 1 working day |
| Sev-3 | A flow is broken but a workaround exists; wrong data shown but not harmful | Within 1 working day | 3 working days |
| Sev-4 | Cosmetic, copy, minor annoyance | Triaged daily | Backlog, by priority |

Only Given and Michael change a severity. No scope changes during hypercare: a request for a new feature goes to the backlog, not to a fix.

### Daily triage template

```
Hypercare day: __   Date: __   Triage by: __
Smoke run: pass / fail (link to report)
Monitoring: error rate __  p95 latency __  jobs failing __  backup OK? __
New issues since last triage: (id, title, role, Sev, owner, status)
Open Sev-1: __   Open Sev-2: __   Open Sev-3: __
Decisions needed from Given/Michael: __
User feedback worth noting: __
Tomorrow: __
```

Keep each day's filled template in the Linear issue FIG-1131 as a comment (comment only; status stays with Given).

## 7. End-of-hypercare criteria

All must hold, on a day where the smoke suite is green in production:

- [ ] No Sev-1 open; no Sev-1 raised in the last 7 days.
- [ ] No Sev-2 open (or each has a dated plan accepted by Given).
- [ ] Error rate and latency within the targets in OBSERVABILITY.md for 7 consecutive days.
- [ ] Backups verified daily; one restore check done.
- [ ] Support route handed to normal support; known Sev-3/4 items are in the backlog.
- [ ] Final summary sent to Michael.

## 8. Cutover record (fill in on the day)

| Item | Value |
|---|---|
| Cutover start / end | |
| Deviations from CUTOVER_PLAN.md | |
| Smoke run result and report link | |
| Rollback taken? | |

## 9. Sign-off (left empty on purpose)

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Go / no-go | | | | |
| Cutover complete | | | | |
| Smoke suite green in production | | | | |
| Hypercare end date decision (24 Nov vs 22 Nov) | Given | | | |
| End of hypercare, no Sev-1 open | | | | |
