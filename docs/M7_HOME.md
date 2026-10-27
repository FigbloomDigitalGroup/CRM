# M7 · Home dashboards, My metrics, search and notifications

Issues: F2.09 (FIG-1091), F2.10 (FIG-1092), F2.11 (FIG-1093), F2.12 (FIG-1094). Design: D1, D2, D3, R2, G2, G3 in `design-spec/` (`CrmDashboard.dc.html`, `CrmReports.dc.html`, `CrmSystem.dc.html`, the top bar in `Figbloom CRM.dc.html`).

Code lives in `src/ui/screens/home/`; styles in `home.css` and `home-overlays.css` (imported by `ui.css`).

## What is built

| Screen | Route / place | Files |
|---|---|---|
| Role homes (Sales Today, Management, Delivery, Finance, Restricted Technical) | `/o/{org}` | `Home.tsx`, `blocks.tsx`, `roles.tsx`, `kit.tsx`, `dash.ts` |
| My metrics (R2) | `/o/{org}/reports` for a role without organisation reports | `MyMetrics.tsx` |
| Global search: top-bar combobox and results page | top bar; `/o/{org}/search` | `Search.tsx` |
| Notification bell and centre | top bar; `/o/{org}/notifications` | `Notifications.tsx` |

* **One call per home.** `GET /api/orgs/{org}/dashboard` answers with the sections the role has; a section the role may not have is absent, not empty. The screen picks the layout from which sections arrive (Management gets D2, Sales D1, and so on), so what a role sees is the API's decision and a screen cannot show a section the API did not give. A section that fails is reported in place with a retry; the others still show.
* **Charts** (`ChartCard` in `kit.tsx`): drawn in HTML/CSS from the same rows they offer as a table; every chart has a Chart/Table switch, a one-sentence accessible name, labels and numbers on every mark, and the stacked pipeline bar carries a stripe pattern per stage as well as a colour. Nothing depends on colour alone.
* **Masking:** the screens never compute a value. Deal values come from the API's `valuesHidden` / `valueMasked` flags and render as `MaskedValue` (the value is not in the markup). The Technical home never calls a money endpoint, and `e2e/home.spec.ts` checks its page text and its dashboard answer for any value.
* **Start page (B1.08):** the home route redirects to the member's start page when they have just signed in (the referrer is a sign-in page, or absent). The sidebar's Dashboard link still opens the dashboard.
* **Search:** an ARIA combobox (arrow keys, Enter, Escape, `/` to focus), recents before typing, two results per group, "See all results" to the page. The page has a tab per kind with its count, "Show the next 25" paging inside a kind, and an explained note for any kind the role cannot search (`hidden.unavailableGroups`). Nothing hides a result on its own: the API limits every group to what the role may open.
* **Notifications:** the bell polls the unread count every 30 seconds (B2.11 chose polling over a stream) and the open list or the centre re-read at the same interval. Opening a notice marks it read on the server and goes to its record. Links are followed only when they point inside this organisation (`pathFromLink`): the API's links carry the app's absolute address, so only the path is used.

## Where the design and the API differ (API wins; nothing was invented)

| Design | Built | Why |
|---|---|---|
| Sales KPI "New leads since last visit" counts from a server-side last-visit time | Counts leads created since this device's last visit (kept in `localStorage`; the first visit shows the newest) | The API keeps no last-visit time. It is a convenience on one device and says nothing about the account. |
| Sales KPI "Overdue: oldest 9 days" | "needs a look" / "all clear" | The dashboard section reports counts, not the oldest date. |
| Management KPIs: "Follow-ups due today across the team" | "Open tasks across the team" | The management section gives open and overdue task counts per person, not today's. |
| "Team follow-up health": open leads, overdue, first reply, won | Open tasks, overdue, won (month to date) | The API has no per-person open-lead count or first-reply time. |
| "Revenue won by service line: year to date" | This month | The section reports the current month and the one before. |
| Adoption: 14 daily bars, "most used page" | Four weekly bars, members active this week, share of members active in four weeks | The signal is weekly (`adoption.weeks`). |
| Finance KPI "Collected this year" | "Collected this month" | `paymentAggregatesFor` reports the month. |
| Delivery KPI "Onboarding tasks due" | "My onboardings" | Tasks carry no onboarding flag on the dashboard. |
| Customer Support home (proposed role) | Not built | The API has no support section; the role gets the explained "no dashboard for your role" panel. |
| Search results page has no tabs | A tab per kind with counts | FIG-1093 asks for type tabs. |
| First-run checklist ticks when a step is done | Ticks when the step is opened, kept on the device | The app cannot know whether a phone installed it; the design's prototype does the same. |

## Decisions taken without asking

1. The home's quick actions are links with `?new=1` (`/leads?new=1`, `/tasks?new=1`, `/tasks?new=call`, `/tasks?new=note`) that the Leads and Tasks screens open as their create drawers. Until a screen reads the parameter the link opens the page.
2. The "Payments" and "Open payments" links on the Finance home are left out until the Payments screen exists (M8); the table is the tracker.
3. The "Mark done" tick on the home uses the same undo window as the rest of the app (`useUndoable`, 5 seconds) and refreshes the dashboard and the task groups.
4. Charts are SVG-free HTML so they scale with the member's text size and density without a chart library.

## Known gaps

* The Management home's "Dormant clients and renewals" lists up to four rows from `GET /retention` (lapsed, due in 30 days, going quiet); the full lists are the Renewals screen (M8).
* Notification centre pages at most 100 notices (a note says so); older ones need the API's cursor, which the centre does not follow yet.
