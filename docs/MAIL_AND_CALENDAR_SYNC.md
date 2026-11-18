# Mail and calendar sync, send and meeting links (FIG-807, FIG-808)

Backend of the Mail workspace (F6.22) and Video Conference (F6.23), on the OAuth framework (`docs/OAUTH_CONNECTIONS.md`). Providers sit behind `src/integrations/mail/types.ts` and `src/integrations/calendar/types.ts`; the real Gmail, Microsoft Graph and Google Calendar clients are in the matching `providers.ts`. Tests inject fakes, never the network.

| Piece | Where |
|---|---|
| Tables `mail_drafts`, `calendar_event_links` (RLS) | `prisma/migrations/20261110100000_mail_and_calendar_sync` |
| Mail: sync, drafts, send, reply, schedule, record card | `src/services/mailService.ts` |
| Meetings: schedule, reschedule, cancel, calendar sync, two-way tasks | `src/services/meetingService.ts` |
| Jobs `mail.sync` (5 min), `calendar.sync` (10 min), `mail.send_scheduled` | `src/jobs/integrationJobs.ts` |

## Mail (FIG-807)

- **Sync** pulls messages in and out of a connected mailbox for people who are KNOWN contacts (matched by address) into Communications on the contact (and company) timeline, authored by the connection's owner. Everything else is ignored. The exception is the shared organisation mailbox: unmatched inbound mail waits in Needs linking (FIG-1053) because nobody owns it.
- **Never twice.** A message is skipped when a Communication with its RFC Message-ID (or `mail:<provider>:<id>`) exists (a BCC copy, a colleague's sync), or when it is the copy of mail the CRM sent (matched by provider id, or for Outlook, which returns none, by subject, recipients and time).
- **Private mail.** `settings.excludedAddresses` (address, `@domain` or `domain`) keeps a whole message out if any party matches.
- **Send and reply** (`POST .../communications/mail/send`, send an `Idempotency-Key`) go through the connected mailbox (the person's own, else the shared one), so they are in the Sent folder. A send claims its draft row first (DRAFT to SENDING), so two requests cannot send twice; it is logged once as an outbound Communication (this is what Conversations reads) and audited. Nothing is logged for a failed send; a disconnected mailbox puts the message back as a draft with the DISCONNECTED state. A reply names the logged message and is allowed only where the person may open that message's record. Recipients are validated (max 20), the linked record must be writable by the person.
- **Attachments** are CRM attachments: each passes `assertAttachmentRecordAccess` (organisation, record, deal-value visibility; 404 otherwise), must be READY, at most 10 files and 10 MB, and the bytes are read through the file service.
- **Scheduled send** runs on the job framework: `mail.send_scheduled` sends as the draft's owner with that person's current permissions; an inactive owner fails the draft; running twice sends once; cancelling puts it back to a draft.
- **Record card** (`GET .../mail/record-card`): deal value follows `canSeeDealValue` for the VIEWER (never the sender), margin `deals.margin`, payments `finance.view.payments`; a hidden figure is `null` with a `*Masked` flag. Margin and payment figures are not read for the card at all in this release (flags only).
- Keys used: `communications.view` / `communications.create`. The Communication-group keys from B6.26 (FIG-1384) are another lane's work; swap them in `mailService.ts` when they land.

## Meetings and calendar (FIG-808)

- **Schedule** from a lead, deal, company or contact (`POST .../communications/meetings`, `Idempotency-Key`): needs `activities.create` and a writable record. The record's contact is invited without typing; extra attendees are validated (max 50). The event is created in the person's chosen calendar with invites and, if `withVideo`, a Meet or Teams link, returned as `joinUrl`. A MEETING activity and one MEETING communication (the Conversations Meetings tab) are recorded; an optional follow-up task goes in the same call. If the provider fails, or returns no link when one was asked for, nothing is left behind (the activity is removed, the event cancelled).
- **Reschedule and cancel** change the provider event and the activity together; only the organiser or Management; cancelling twice is harmless; the meeting is not logged again.
- **Sync** pairs every event with its activity once (`calendar_event_links`), so the CRM's own events coming back do not duplicate. New events with a known contact among the attendees become MEETING activities; updates (title, time) and cancellations apply both ways; unchanged events are left alone. Tasks are pushed to the calendar only when the person chose two-way (`settings.syncTasks`), once each, and the event is cancelled when the task is done.
- No video engine, recording or transcription.

## Known gaps

Task events edited in the calendar move the task's due time but do not create tasks from calendar events. Calendar and mail sync poll (no provider push). Gmail replies thread by headers only (no `threadId`). The Mail and Video screens (`src/ui/screens/communication/`) are wired to these routes (5 Nov 2026); `.../assistant/settings/Connections.tsx` is not.

## Tests

`tests/mailSync.test.ts` (22) and `tests/meetings.test.ts` (17): sync matching, dedupe, exclusion, shared mailbox, revoke, job per organisation, send once (race and Idempotency-Key), disconnected, provider failure, role and record authorisation, private drafts, cross-organisation, attachments (cross-organisation, hidden deal file), scheduled send, masking of the record card, real Gmail/Graph/Google Calendar clients against a fake server, meetings (video link, rollback, validation, authorisation), two-way sync without duplicates, two-way tasks, RLS.
