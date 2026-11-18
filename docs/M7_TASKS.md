# M7 · Tasks and calendar (FIG-1089 F2.07, FIG-1090 F2.08)

Design: `design-spec/CrmTasks.dc.html` (T1 tasks, T2 calendar), `CrmOverlays.dc.html` (the New task drawer), `CrmDashboard.dc.html` (D3 My work).
Code: `src/ui/screens/tasks/` (screens), `src/ui/screens/tasks/tasks.css` (styles), routes `src/app/o/[orgSlug]/tasks` and `.../calendar`.

## Components other areas can mount (import from `@/ui/screens/tasks`)

| Export | Props | What it is |
|---|---|---|
| `MyWorkList` | `{ onCreate?: () => void }` | The whole D3 body for the Restricted Technical role: three KPI tiles (Assigned to me, Due this week, Overdue), the "you see only your tasks" notice, and one card per task with the client requirements. Reads `GET /my-work`. Empty and error states included. The dashboard owner supplies the page title, subtitle and scope pill. |
| `TasksPanel` | `{ groups?: ("OVERDUE"\|"TODAY"\|"THIS_WEEK"\|"LATER"\|"NO_DATE")[]; limit?: number; title?: string; emptyText?: string }` | A compact card of open tasks (default Overdue and Today, 6 rows) with a tick to complete, due time and link; reads `GET /tasks/groups`. For Sales Today, Delivery and Management homes. |
| `TaskDrawer` | `{ open: boolean; onClose: () => void; initialDue?: Date; link?: { type: "Lead"\|"Deal"\|"Company"\|"Contact"; id: string; label?: string } }` | The New task drawer (title, description, due, priority, assignee, linked record). Mount it anywhere a "New task" action is needed. |

The tasks page also opens the drawer when it is loaded with `?new=1` (Quick create can link there).

## What is built

**Tasks (F2.07, T1)** `src/ui/screens/tasks/TasksScreen.tsx`, route `/o/{org}/tasks`.
- Header (title, scope pill with the open count, hint, List / Calendar switch, New task), four stat tiles (they jump to their group), search, priority, assignee (only for people who can see everyone's tasks), and the groups **Overdue, Today, Upcoming, No due date (only when non-empty), Done**. Overdue is always first and is marked by wording ("Overdue · 6 Oct, 3:17 PM") and a shape (▲), not colour alone. Done starts folded and is fetched when opened.
- Quick complete (optimistic, rolled back with an explanation, Undo toast), status select, snooze (tomorrow 9:00, in 3 days 9:00, next Monday 9:00, with Undo), quick add, bulk complete (the **Select** button), "Show more" per group, edit drawer from the title, link chip to the record.
- Someone else's task is read-only: the tick and status are disabled, the reason is in words (visible text for screen readers and a tooltip), and snooze is not offered.
- Empty, loading, error (with Retry; the server's message is never printed) and the explained no-access state are all there. `?new=1` opens the New task drawer; `?leadId=`, `?dealId=`, `?companyId=`, `?contactId=` narrow the list to a record.

**Calendar (F2.08, T2)** `CalendarScreen.tsx`, route `/o/{org}/calendar` (the sidebar item is switched on).
- Month (6-week grid, today badge, three items a day, "+N more" opens that day), Week, Day (08:00 to 18:00 slots, full detail), List ("Upcoming and overdue"). Prev / Today / Next.
- Whose calendar: Management opens on Everyone and can pick a person; everyone else has the control locked with the API's reason ("You see your own calendar. Management can view the team calendar.") shown beside it.
- Create from a slot: click a day (month, week) or an hour (day) to open the drawer with the time filled in; the drawer offers Task, Meeting or Call (meeting and call go through `POST /calendar`). Click an item: a task opens the edit drawer, a meeting or call opens its record.
- Keyboard: arrow keys move between day slots (left and right; up and down in the month grid), Down steps into a day's events, up and down move between events, Home and End jump to the first and last day. Enter or Space on a slot creates.
- At 640 px and below the grid is replaced by an agenda of the same days.

**My work (D3)** `Panels.tsx` (`MyWorkList`) and the "Do these today" card (`TasksPanel`), documented above.

## Decisions taken without asking

1. **Upcoming merges two API groups.** The API has This week and Later; the design has one Upcoming list, so the screen shows them as one (sorted by due time).
2. **Completed tile says "done so far".** The design says "in the last 7 days", but the API's Done count has no date window; showing a window the number does not have would be wrong.
3. **Priority filter is applied in the browser** to the rows already loaded (the grouped endpoint has no priority filter); while it is on, group counts show the filtered rows and "Show more" is hidden.
4. **Added beyond the design, because the issues require them:** snooze (a small clock on the due time), bulk complete (a "Select" toggle), quick add (a one-line field), a Meeting and Call option when the drawer is opened from a calendar slot. All sit inside the designed layout without moving anything.
5. **My work shows no client name.** The design's cards read "for {client}"; the API deliberately returns no linked record for this role, so the card shows the due time only. Nothing about the customer, deal or value can reach the screen.
6. **List view of the calendar disables Prev / Next** (it always shows the last month's overdue and the next 30 days).
7. **Calendar page views are not recorded** (the page-view labels are a fixed list in a shared service; adding one is a separate change).
8. **Log a call or note** (the phone button) opens the linked record, where activities are logged; the standalone note drawer belongs to M8 (record extras).

## Known gaps

- The calendar's list range is 61 days (the API allows 62); anything older than a month is not listed as overdue there (the Tasks page has all of it).
- The calendar item for a meeting or call whose record the person cannot open has no click target.
- Offline queueing of task completion is F4.12 (M9); today a failed completion rolls back with the explanation.
