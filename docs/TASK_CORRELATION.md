# Task correlation: one record, many views (P2-22, P2-23, P2-27)

Issues: FIG-1676 (Calendar items must appear in Tasks), FIG-1677 (calls and calls-to-action on a lead create tasks), FIG-1681 (a follow-up has a date and a time).
Code: `src/services/taskLinkService.ts` (the rule), `src/services/taskService.ts`, `src/services/calendarService.ts`, `src/services/activityService.ts`, `src/services/leadService.ts`, `src/services/taskBackfill.ts`, `scripts/backfill-task-links.ts`.

## 1. Why the Calendar and the Tasks page disagreed (FIG-1676, root cause)

The Calendar's "Call" and "Meeting" options called `POST /calendar` with `kind: "activity"`. The server wrote a **timeline activity** (`activities` table). The Tasks page reads the `tasks` table only, so a call or meeting added from the Calendar could never show there. (A plain task added from the Calendar already went to `tasks`; it was the other types that were lost. The task table also had no type, so even a call task could not have been told apart.)

Fix, at the cause: everything the Calendar creates is one **task row** with a `type` (TASK, CALL, MEETING, EMAIL, QUOTE, VISIT), made by the same service as the Tasks page (`createTask`). The Calendar is a view of tasks. `POST /calendar` keeps its request shape and now answers `{ kind: "task", id, type, start }`. Logged (past) calls stay timeline activities, as before.

- No copy in two places: an activity that has a task is shown through the task (`tasks: { none: {} }` in the calendar feed), so nothing appears twice.
- A call or meeting no longer has to be linked to a record (a task never had to be).
- Time zone: stored UTC, shown in the person's zone. A task made for 15:00 Nairobi reads 15:00 in both screens (tested).
- Both screens refresh together: `useRefreshTasks` invalidates the Tasks list, the Calendar range, My work; the lead page refetches its tasks and timeline.
- The Tasks page has a **Type** filter with every type; no type is creatable but unlistable.
- Visibility is one rule: the Calendar's tasks come from the same repository call and the same own/all scoping as the Tasks list.

### Backfill of items already lost
`npx tsx scripts/backfill-task-links.ts` (dry run, counts only) then `--apply` (optionally `--org <id>`). Additive (nothing is deleted or changed), idempotent (one task per source activity is enforced by a unique index; a lead with an open follow-up task is skipped), safe to repeat.

1. Calendar activities: a CALL or MEETING activity with **no task** whose time is more than a minute later than the moment it was saved (it was scheduled ahead, which is what the Calendar did; a call logged after it happened is dated before it was saved and is left alone). Each gets a PENDING task of that type, due at that time, owned by the person who added it, linked to the same record, pointing back at the activity (`source_activity_id`).
2. Leads with a Next follow-up and no open follow-up task get one (see section 3).

Counts on the development database on 15 Nov 2026 (dry run): calendar activities 0, lead follow-ups 8. Run the dry run on the real database before applying.

## 2. The data (additive migrations, expand step only)

| Migration | What |
|---|---|
| `20261127110000_task_type_calendar_items` | `TaskType` enum, `tasks.type` (default TASK), `tasks.source_activity_id` (FK to `activities`, ON DELETE SET NULL, unique where not null), index on (organization, type). |
| `20261127120000_task_follow_up_link` | `tasks.is_follow_up` (default false) and a partial unique index: at most **one open (pending or in progress, not archived) follow-up task per lead**. |

`tasks` already has row-level security; no new tenant table. Nothing is dropped or renamed.

## 3. The rule table (FIG-1677)

All of it lives in `taskLinkService.ts` and runs **inside the same database transaction** as the original action (the repository functions take a callback that runs in their transaction). The UI never decides.

| User does | Result |
|---|---|
| Schedules a call or call-to-action (call, email, send quote, meeting, visit) on a lead, with a time | A task of that type, due at that date and time, owner = the person it is assigned to (default: you, or the lead owner when set by the follow-up), linked to the lead. If it comes **before** the lead's current follow-up (or there is none) it **becomes the follow-up**: the lead's Next follow-up moves to its time and the earlier follow-up task stays as an ordinary open task. If it is later, it is just a task. A plain task (type TASK) never changes the follow-up. |
| Logs a call that already happened | A done activity on the timeline. It does **not** create an open task. If the same request carries a `nextStep`, that creates the open follow-up task (type chosen, date and time chosen), linked to the activity (`source_activity_id`). |
| Sets or changes the Next follow-up (lead drawer, lead page, API) | The open follow-up task is created or **moved**, never duplicated; the field and the task always carry the same date and time. Clearing the field cancels the open follow-up task. Setting the same value again changes nothing. The task owner is the lead's owner (else the person making the change) when that role can hold tasks; otherwise only the field is set. |
| Completes the follow-up task | The lead's Next follow-up clears and its last-contacted time updates; the timeline shows the task done. |
| Edits the task's date or time | The lead's Next follow-up moves with it. |
| Cancels or archives the follow-up task | The lead's Next follow-up clears. Restoring an archived follow-up puts it back unless another one has taken its place (then the restored one becomes an ordinary task). |
| Reopens a completed follow-up | The lead's field returns to its time (or, if another open follow-up now exists, it becomes an ordinary task). |
| Lead is converted, archived or marked lost | **Unchanged.** Today the CRM does not touch a lead's tasks when it is converted, archived or lost (open tasks stay, visible and completable; an archived lead is read-only, so its tasks can still be read). This issue keeps that rule; it adds no automatic closing. |

Links are foreign keys (`tasks.lead_id`, `tasks.source_activity_id`), never copied text. A retry or double click: the create endpoints already take an idempotency key, the logged-call dialog sends one key for the whole request, and the unique indexes make a second open follow-up or a second task for one activity impossible.

### Places that log or schedule something on a lead, and what each now does
| Place | Now |
|---|---|
| Lead page "Log a call or note" drawer (`QuickDrawers.tsx` NoteDrawer) | One `POST /activities` with an optional `nextStep` (type, title, date and time). Activity plus follow-up task in one transaction. |
| Lead page "New task" drawer (`QuickDrawers.tsx` TaskDrawer) | `POST /tasks` with a type (task, call, email, quote, meeting, visit) and a date and time; a call-to-action that comes first becomes the next follow-up. |
| Lead page Next follow-up card (`LeadDetailScreen.tsx`) | The shared date-time input; patches `nextFollowUpAt`; the server moves the follow-up task. The timeline now lists the lead's tasks with their status. |
| New/edit lead drawer (`LeadDrawer.tsx`) | The shared date-time input; the follow-up task is created with the lead (through the patch). |
| Calendar and Tasks drawers (`TaskDrawer.tsx`) | One drawer, six types, always `POST/PATCH /tasks`; for a lead link a call-to-action can become its next step. |
| Quick-log prompt after a call or WhatsApp (`quickLogService`, `QuickLogPrompt.tsx`, mobile `LogSheet`) | The next action has a date and a time. On a lead it is the lead's follow-up task linked to the logged call; on other records it is a task linked to the call. (Quick-log still saves the activity, the conversation and the task in separate steps; the follow-up itself is one transaction.) |
| Quick capture and card capture (`quickCaptureService`, mobile `CaptureSheet`) | "Remind me to follow up" has a date and a time; on a lead it is the follow-up. Web forms create the lead only (no follow-up is scheduled). |
| Mobile offline sync (`syncService` CALL_LOG, WHATSAPP_LOG, TASK_CREATE) | Go through the services above. |
| Sequences (`followUpService`), automations (`automations/effects`), assistant, meetings follow-up | Create the tasks they already created (linked to the lead). They never move the follow-up, a deal stage, a discount or an approval (hard rule 9; the existing test is unchanged and green). |

Team activity alerts (FIG-1600): the task made with a logged call or a follow-up change emits no alert of its own, so the action produces one alert (the activity's, as before).

Masking (hard rule 7): follow-up task titles use the lead's company or contact name only, never a deal value.

## 4. Follow-up has a date and a time (FIG-1681)

- **One input**: `DateTimeField` in `src/ui/components/forms.tsx` (design system, exported from `@/ui`): a date picker and a time list in steps of 5 minutes, labelled for the person's 12 or 24 hour clock, quick choices (Today 17:00 while it is still ahead, Tomorrow 09:00, Next week = Monday 09:00), a Clear button when optional, the time zone shown, a visible warning (not a block, as before) when the time has passed, accessible labels and a group name. It stores and returns an ISO instant; the zone only decides what is shown and typed. Pure helpers in `src/ui/components/dateTimeZone.ts`.
- **Where it is used**: new/edit lead drawer, lead page Next follow-up card, lead "Log a call or note" next step, lead "New task", Tasks and Calendar drawer, contact "New task", quick-log prompt after a call, mobile call log sheet and mobile quick capture reminder. Deals' task drawer already used a date-time input. Bulk actions, saved views, CSV import and sequences have no follow-up date input today (the import does not map `nextFollowUpAt`); export writes the full ISO date-time.
- **Default time**: tomorrow at **09:00** in the person's zone (Preferences, else the organisation's). Decision: no new setting (not cheap); 09:00 is `DEFAULT_FOLLOW_UP_TIME` in `src/lib/followUpTime.ts` and `DEFAULT_TIME` in the UI helper.
- **Old clients and imports**: the API already took ISO date-times. `PATCH /leads/{id}` now also accepts a date-only `nextFollowUpAt` (`2026-11-20`) and quick-log accepts a date-only `followUp.dueOn`; both mean 09:00 in the caller's zone (not midnight UTC).
- **Display**: `fmt.when`, `fmt.dueLabel` already show the time ("Thu 14 Nov, 15:30", "Today 15:30"); `fmt.overdueBy` and `overdueBy()` give "Overdue by 2 h". The phone's `dueLabel` now shows the time and "Overdue by 2 h" the same day.
- **Reminders and overdue**: the notification sweep now sends "due" when the task's own time falls inside the next sweep interval (default 15 minutes), so it arrives at the follow-up time and not at midnight; "overdue" is measured from the task's time. The lead score's "overdue follow-up" already compared instants.
- **Existing data** is not changed. Follow-ups stored at midnight or any default time are shown as stored and editable. They are **not** shown as "(no time set)": a stored midnight cannot be told apart safely from a deliberately chosen 00:00, so the stored time is shown.
- **Sorting**: lists sort by date and time (the tasks list orders by `dueAt`; the leads list sorts by `nextFollowUpAt`, both full timestamps).
- **Task link**: the follow-up and its task always show the same date and time (section 3).
- **Open question for Given**: the Tasks page groups (Overdue, Today, ...) still divide at the start of the person's day, as before; a follow-up due at 09:00 shows in Today (marked overdue by its row) until the day ends. Making the Overdue group start at "now" changes an existing, tested rule (`tests/tasksV2.test.ts`), so it was not changed.

## 5. API changes (list for the contract update and changelog)

Additive, no breaking change:
- `POST /orgs/{org}/tasks`, `PATCH /orgs/{org}/tasks/{id}`: optional `type` (TASK, CALL, MEETING, EMAIL, QUOTE, VISIT; default TASK). Task responses carry `type`, `sourceActivityId`, `isFollowUp`.
- `GET /orgs/{org}/tasks`, `GET /orgs/{org}/tasks/groups`, `GET /orgs/{org}/tasks/groups/{group}`: optional `type` filter.
- `POST /orgs/{org}/activities`: optional `nextStep { type, dueAt, title?, assigneeMembershipId? }` (only for an activity on a lead).
- `PATCH /orgs/{org}/leads/{id}`: `nextFollowUpAt` also accepts a date-only string (means 09:00 in the caller's zone).
- `POST /orgs/{org}/calendar`: a `kind: "activity"` request now saves a task of type CALL or MEETING and answers `{ kind: "task", id, type, start }`; no link required. `GET /orgs/{org}/calendar` items of a task carry its real `type`.
- `POST /orgs/{org}/quick-log`: `followUp.dueOn` accepts a date-time as well as a date.

## 6. Decisions taken without being asked (reversible)

1. A call or meeting from the Calendar is a task with a type, not an activity with a task copy (no data that can drift). Logged past calls remain activities.
2. A scheduled call-to-action becomes the lead's follow-up only when it comes before the current follow-up; otherwise it is a plain task.
3. Completing the follow-up clears the lead's Next follow-up (it does not pick the next open task), because the follow-up is a single, deliberate next step.
4. Lead converted, archived or lost: tasks are left as they are (existing behaviour).
5. Default follow-up time 09:00, no setting. A stored midnight is shown as stored.
6. The backfill treats a CALL or MEETING activity as a calendar item only when it was dated more than a minute after it was saved.
7. The Tasks page group boundaries are unchanged (see the open question above).
