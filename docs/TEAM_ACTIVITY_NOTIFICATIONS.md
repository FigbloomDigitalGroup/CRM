# Team activity notifications (FIG-1600, P2-17)

Management hears about what the team adds and changes, without being flooded. Notifications only inform: nothing here moves a
deal, sets a discount or approves anything (CLAUDE.md rule 9; a test checks the source).

## What is sent

| Event key | When | Default delivery |
|---|---|---|
| `LEAD_CREATED` | A lead is created | hourly digest |
| `DEAL_CREATED` | A deal is created | instant |
| `DEAL_CLOSED` | A deal moves to Won or Lost (not other edits) | instant |
| `COMPANY_CREATED` | A company is created | hourly digest |
| `CONTACT_CREATED` | A contact is created | hourly digest |
| `DATA_RUN` | A lead, contact, company or deal import or export finishes (a cancelled import says nothing) | instant |
| `MEMBER_CHANGE` | A member is invited (or re-invited) or removed | instant |
| `DISCOUNT_REQUESTED` | A quote discount above the approval limit is sent for approval | instant |

Not built, so nothing is sent for them (the helper is ready for each): security events (P2-02), a new custom service (P2-12),
a Head of Sales grant and Head of Sales as an extra recipient for sales events (P2-14). To add one: add the event to
`TEAM_EVENT_DEFS` in `src/notifications/teamActivity.ts` and call `emitTeamActivity`; preferences, grouping, digests and masking apply.

## Who gets it

Every active member with the Management role in the same organisation, except the person who did the action. Nobody else, and
never another organisation (the recipients are selected by organisation; the new tables have row-level security and a cross-organisation test).

## How it is sent

* **Source.** The audit trail (P2-16) is not built, so the services that perform the action call one helper, `emitTeamActivity`
  (`src/services/teamActivityNotifier.ts`): `leadService`, `dealService`, `companyService`, `contactService`, `dataRunService`,
  `membershipService`, `approvalService`. When P2-16 exists an audit-event subscriber can call the same helper. It never throws.
* **In the app.** A `TEAM_ACTIVITY` notification with the actor (the notification centre shows the actor's initials until profile photos, P2-05, exist) and a link to the record. Grouped items link to the list page; the filtered audit view arrives with P2-16.
* **Email and push.** Through the existing channels. Email goes via the generic notification delivery (quiet hours and the daily cap apply, as for every other email); push goes through `pushToMember` (quiet hours apply; the person must have a registered device). Both are off by default.
* **Each person chooses**, per event: in-app, email, push, and the mode INSTANT, HOURLY or DAILY. Turning an event off in every channel stops it for that person only.
* **Grouping.** Items held for a digest are grouped per event and team member when the digest goes out: "Amina added 12 leads in the last hour". Instant events are one notification each.
* **Rate cap.** After 20 instant team-activity notifications to one person in an hour, further instant events wait for that person's hourly digest (`TEAM_ACTIVITY_HOURLY_CAP`).
* **Digest timing.** Hourly: an hour after the first held item. Daily: the next 08:00 on the person's own clock (their time zone, else the organisation's). The job `team_activity.digest` runs through the job framework every 5 minutes or less (`/api/cron/jobs`, see `docs/JOBS.md`; the MVP already calls it every 5 minutes). It claims items before sending, so a repeat run sends nothing twice; sent items are removed after 7 days.

## Masking (rule 7)

Text is composed per recipient. A deal value appears in the in-app text, the email and the push only for a recipient who has
`deals.view.value`; every string also passes `textForViewer`, and the push does it again (existing behaviour). No payment or invoice
detail is ever composed. Recipients are Management, who always have the value permission, so the withheld path is covered by the unit test of
`composeText` (`canSeeValue: false`) and by the redaction shared with the rest of the notification centre.

## Preferences

Preferences, Notifications shows a "Team activity" table for Management only (one row per event, in-app, email and push, and a "How often" choice).
It rides on `GET` and `PATCH /api/orgs/{org}/me/notification-preferences` (optional `teamActivity`); other roles get no such list and a `PATCH` naming it is refused.
Storage: `team_activity_preferences` (no row means in-app on, email and push off, the event's default mode).

**Organisation defaults in Settings: not built.** Optional in the issue; it needs its own settings screen and a precedence rule, so it is left for a follow-up.

## Data

Migration `20261126100000_team_activity_notifications`: enum value `TEAM_ACTIVITY`, `notifications.actor_membership_id`, tables
`team_activity_preferences` and `team_activity_pending` (both with RLS). After merge run `npm run migrate:deploy:direct` and `npm run db:grant-role` against Neon.
The mode of a held item is stored in its `detail` JSON.

## Tests

`tests/teamActivityPure.test.ts` (grouping, wording, masking in the text, digest timing, cap, rule 9) and
`tests/teamActivityNotifications.test.ts` (each event through the real services, digest and job, preferences, cross-organisation). Journey: `e2e/team-activity.spec.ts` (written, not run in this session).
