# Follow-up sequences and the enrolment engine (FIG-1150, B6.18, design S6#2)

V1.1. Code: `src/lib/sequences.ts` (pure rules), `src/sequences/engine.ts` (the engine), `src/services/followUpService.ts` (API logic),
`src/repositories/followUps.ts`; migration `20261108134400_follow_up_sequences` (tables `follow_up_sequences`, `follow_up_steps`,
`follow_up_enrollments`, `follow_up_runs`, all with RLS). The Settings screen (`src/ui/screens/settingsplus/`, "Sequences") is still on
demo data; wire it in M14.

## Routes (outside the frozen V1 contract; creates accept `Idempotency-Key`; all need release V1.1)

| Route | Who | What |
|---|---|---|
| `GET`, `POST /api/orgs/{org}/sequences` | `cadences.manage` sees all and creates; people with `tasks.create` list the active ones | Sequences with steps and the number running |
| `GET`, `PATCH`, `DELETE /api/orgs/{org}/sequences/{id}` | as above; change and delete need `cadences.manage` | Rename, switch on or off (`isActive`), change steps, exit rules, trigger. Delete is refused while enrolments are running |
| `POST /api/orgs/{org}/sequences/{id}/enrollments` | `tasks.create` and access to the record | Enrol `{leadId}` or `{dealId}` |
| `GET /api/orgs/{org}/sequence-enrollments?leadId=&dealId=&sequenceId=&status=` | record access; without a record, `cadences.manage` | Enrolments, paged |
| `GET /api/orgs/{org}/sequence-enrollments/{id}` | record access | The enrolment with its run log |
| `POST .../{id}/pause`, `/resume`, `/end` | record access | A person pauses, resumes or ends an enrolment |

## What a sequence is

A sequence is for leads or deals, has 1 to 12 steps and starts manually or (`trigger: WEBSITE_LEAD`, lead sequences only) for every new lead from the
website endpoint or a web form. A step has a day (0 to 365 after enrolment, never earlier than the step before) and is one of:

- `TASK`: a reminder, a task for the record's owner (the enroller when the record has no owner).
- `EMAIL` with `DRAFT` (default): the template is rendered as the owner and put in a task, "Draft prepared for you", for them to check and send.
- `EMAIL` with `SEND`: an approved (active) template is sent as the owner through the normal send path, so it appears on the record's timeline (`Communication`, with the template id). If the record has no email address, or a merge field would be empty, it becomes a draft task saying why instead of sending.

## The engine

`runDueSequences({organizationId, now})` is the body of the `sequences.run` job (every 15 minutes, job framework, `docs/JOBS.md`); the clock is a parameter so tests use a fake one. For each running enrolment whose next step is due, in a switched-on sequence:

1. **Exit rules.** If the record is gone, archived (`ARCHIVED`) or closed (`CLOSED`: a lead converted, lost, unqualified or inactive; a deal won or lost), the enrolment EXITS and nothing runs. Both rules are on by default.
2. **Replies pause.** If anything inbound was logged on the lead or deal, or by its contact, after the enrolment or the last step, the enrolment is PAUSED (reason REPLY). The same pause happens at once when the message is logged (`createCommunication` in `src/repositories/communications.ts` calls `pauseEnrollmentsForReply`); the engine's own check also catches messages stored by any other path. A message from before the enrolment is not a reply. Resuming keeps the gap the next step had to the one before, counted from the resume (`schedule_from`).
3. **Run once.** The step is claimed in the run log first (a unique row per enrolment and position), so two workers never run it twice. A claim that died half way is closed as FAILED after 10 minutes and not repeated (nothing is sent twice).
4. A step that cannot run (owner no longer active, template switched off) is SKIPPED and logged, and the sequence moves on. After the last step the enrolment is COMPLETED. Several steps that fell due together run in order, up to ten per enrolment per run.

A sequence that is switched off does not run; its enrolments wait and carry on when it is switched on. Editing steps keeps running enrolments on their position.

## Run log

`follow_up_runs`: one row for each enrolment, step (PENDING, DONE, SKIPPED, FAILED, with the task or communication it made), pause, resume and exit, each with a plain-words result. Every send is therefore on the record's timeline and in this log.

## Rule 9: automations never decide

The only effects are `SEQUENCE_EFFECTS`: create a task, send an approved template. Sequence code never writes a deal or lead, a pipeline stage, an outcome, a discount, an owner or an approval. `tests/followUpSequences.test.ts` scans the code for those fields and for writes to those records, and checks that a complete run of a lead and a deal sequence leaves stage, outcome, value, owner and status exactly as they were.

## Tests

`tests/followUpSequences.test.ts`: the pure rules; builder permissions and validation; the engine on a fake clock (due times, catch-up, concurrency, interrupted claims, switch off, the `sequences.run` job); replies (hook, engine check, contact replies, resume gaps); exit rules; careful email steps; enrolment access by role; automatic enrolment from a web form; the rule 9 checks; tenant isolation in the service and under RLS.
