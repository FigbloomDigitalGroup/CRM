# P2-15 · The Team page (FIG-1598)

Management opens one page and sees the whole sales team: who is on it, what each person is doing and who needs help. Route: `/o/{org}/team`. Sales workspace navigation and the command palette ("Go to Team").

## Who may open it

One function decides, `canViewTeamPage(permissionKeys)` in `src/auth/teamAccess.ts`. Today it is true for `configuration.manage` (Management only). When the Head of Sales role (P2-14) is merged, add its permission key to `TEAM_PAGE_KEYS`; the API, the sidebar, the palette (screen list and server index) and the screen all follow. Everyone else gets the explained no-access card on the page, and `403` with the denial (their role, who has access, who to ask) from every endpoint.

## API (all `GET`, Management only, Zod DTOs in `src/api/dto/team.ts`, OpenAPI in `src/api/teamOperations.ts`)

| Route | Answers |
|---|---|
| `/orgs/{org}/team/summary?range=` | Members active, open leads, open deals (+ value), overdue tasks, new leads, deals won (+ value), unassigned leads, and open leads per member for the workload balance |
| `/orgs/{org}/team/members?range=&q=&role=&status=&sort=&page=&pageSize=` | One row per member (not removed): role, status, last active, open leads, open deals (+ value), tasks due today, overdue, new leads, stuck deals, avatar. Sort fields: name, role, status, lastActive, openLeads, openDeals, overdueTasks, tasksToday, newLeads (`-field` descends) |
| `/orgs/{org}/team/members/{membershipId}?range=` | The drawer: recent sales activity (audit trail), up to 10 open leads, deals and tasks, 30-day activity trend |
| `/orgs/{org}/team/attention` | Quiet leads, overdue tasks and stuck deals (top 10 of each with the true total) |

`range` is `today`, `7d` (default) or `30d`. It moves the range figures (new leads, deals won, members active, the table's "new leads"); open leads, open deals and overdue tasks are the current state and do not change with it. The page says which is which under each figure.

Definitions: an *open lead* is owned, not archived, not converted and not lost. An *open deal* has outcome OPEN and is not archived. A *quiet lead* is open, older than N days, with no logged activity and no `lastContactedAt` inside N days. *Stuck deals* use the same per-stage threshold as the stalled-deal rule. N is the organisation's stalled-deal default from Settings > Deal rules: the app has no separate lead-inactivity setting, so the page reuses it and says "no activity for N days".

## Rules kept

* **Aggregates in SQL.** Counts and sums are `COUNT`/`SUM ... GROUP BY` joined per member in one statement; no record list is loaded to be counted. Everything runs in `withOrgContext` (row-level security) with explicit `organization_id` filters.
* **Masking (rule 7).** A count the viewer's role may not read (`leads.view.all`, `deals.view.all`, `tasks.view.all`) is `null` and shown as a dash with an explanation, never zero. Deal values need `deals.view.value` (and no field rule hiding `deal.value`); otherwise `{ amount: null, masked: true }` and the screen draws the masked marker. Payments are never read here.
* **Activity** is the existing audit trail restricted to sales objects (Lead, Deal, Task, Activity, Contact, Company). Events carry no snapshots (so no values), and payment, membership and sign-in events are not in the set. No keystroke, location or page tracking exists; "last active" means the person's last recorded CRM action. P2-16 (audit trail) should read the same table; no second store was added.
* **Tenant isolation.** RLS, plus a cross-organisation test (`tests/teamPage.test.ts`).
* The page is read-only. Reassigning is done on the lead itself (each lead in the drawer links to it); "Open in Members settings" links to Settings > Members. A "message" action was left out: chat is not available in every organisation and would need its own permission check.
* Photos: the existing avatar and initials component shows the member's picture when one exists (P2-05 not needed). There is no Head of Sales badge yet (P2-14).

## Performance

Indexes: `audit_events (organization_id, actor_membership_id, created_at)` (migration `20261126110000_team_page_audit_actor_index`) and a partial covering index on open leads (`20261126110001_team_page_open_lead_index`). Both are additive (`IF NOT EXISTS`); run `npm run migrate:deploy:direct` then `npm run db:grant-role` against Neon after merge.

Measured locally (shared development machine with other test runs going, so treat as an upper bound) on one organisation with 50 members, 50,000 leads, 12,000 deals, 25,000 tasks, 60,000 activities and 150,000 audit events, p50 of 10 runs through the service:

| Call | p50 |
|---|---|
| members (page of 50) | about 150 ms |
| member detail | about 170 ms |
| summary | about 580 ms |
| attention | about 840 ms |

Members and detail meet the 300 ms list target. **Summary and attention are above the 500 ms dashboard target on this machine**: each runs several full scans of the open-lead, task, deal and activity tables for the organisation (about 100 ms each in `psql`) one after another inside a single transaction. They are not load-tested on production hardware. If they need to come down: cache the summary for 30 to 60 seconds per organisation and range, or keep a nightly per-member snapshot as the dashboard signals do. That was not done because stale numbers on a page about "who needs help" should be a decision for Given.

## Screen

`src/ui/screens/team/` (stylesheet `team.css`, imported by `ui.css`), built from `@/ui`: `Card`, `KpiTile` (the dashboard's bordered strip), `DataTable` (server sort), `Drawer`, `Badge`, `Avatar`, `MaskedValue`, `NoAccess`, `ErrorState`, `EmptyState`, `LoadingState`, the Leads filter bar and the page title style. Below 760 px the table becomes a card per person. Keyboard: the member name in the table (and the workload list) is a button that opens the drawer; the drawer traps focus and closes on Escape.

## Tests

* `tests/teamPage.test.ts`: correct numbers for seeded data, date range, filter/sort/paging and hostile input, refusal for every other role on every endpoint, masked values and null sections, activity limited to sales objects with no snapshots, cross-organisation isolation.
* `tests/components/screens/team/team.test.tsx`: summary, masking, range, drawer, filters, empty, error, no-access (page and API refusal), axe.
* `e2e/team.spec.ts`: Management journey (sidebar, summary, workload, table, range, filter, drawer by keyboard, palette) and the negative Sales journey (no link, no-access card, API 403).
* Route walks: the four routes are in `accessMatrix.json` and `accessMatrixV11.json` (Management only) and `/team` is in the Management-only list of `tests/fixtures/roleFamilies.ts`.
