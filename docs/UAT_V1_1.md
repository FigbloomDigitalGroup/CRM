# V1.1 user acceptance testing (Q2.03, FIG-1181)

Purpose: real people confirm the V1.1 features work the way their job needs. This document holds the **scripts**, the **defect log template** and the **sign-off table**. Written 9 Nov 2026. **No session has been held. Nothing here has been run with users and nothing is signed.** Every human step is marked "Owner: <role>, not done".

Read with `docs/UAT_V1.md` (the V1 scripts and the same session format), `docs/V1_1_RELEASE.md` (release plan), `docs/PERMISSION_MATRIX_REPORT_V1_1.md` (what each role should and should not reach), `docs/TEST_REPORT_V1_1.md` and `docs/M14_TEST_REPORT.md` (the automated side).

## Preconditions (all human, none done)

| # | Precondition | Owner |
|---|---|---|
| 1 | An environment holds the V1.1 migrations and `ACTIVE_RELEASE=v1.1` (or the test organisation is moved to release V1.1; see `docs/FEATURE_FLAGS.md`). Candidates: local staging stack (`docs/STAGING.md`) or the Vercel preview or production (`docs/VERCEL_SETUP.md`). | Owner: Given, not done |
| 2 | Test organisation has `quotes.enabled`, `communication.group` and `organisation.switcher` on (all default on at V1.1) and `assistant.enabled` switched on (default off). | Owner: Management of the test organisation, not done |
| 3 | At least two organisations exist and one test user belongs to both (needed for the switcher script). | Owner: platform admin, not done |
| 4 | A real Google or Microsoft test mailbox and calendar, with the OAuth client configured and the callback `${APP_BASE_URL}/api/integrations/oauth/callback` registered (needs `GOOGLE_OAUTH_*` or `MICROSOFT_OAUTH_*`, `INTEGRATION_ENCRYPTION_KEY`). | Owner: Given, not done |
| 5 | `ANTHROPIC_API_KEY` set for the assistant (and the key is not shown to participants). | Owner: Given, not done |
| 6 | The scheduler calls `/api/cron/jobs` often enough for mail sync, scheduled sends, sequences and chat notifications. `vercel.json` currently holds a daily schedule for it (`0 2 * * *`); `docs/M13_CLOSEOUT.md` says it must run at least every 5 minutes. On the free plan an external caller is needed (`docs/VERCEL_SETUP.md` section 10). Without this, scripts S-6, M-6 and the sync step of S-8 will appear to fail. | Owner: Given, not done |
| 7 | A platform admin account exists with two-step enrolled (`npm run platform:bootstrap-admin`, `docs/PLATFORM_BOOTSTRAP.md`). | Owner: Given, not done |
| 8 | Participants sign in as themselves, not as dev chips. Use invented customer data only. | Owner: facilitator, not done |

## How a session runs

Same as `docs/UAT_V1.md`: 60 to 90 minutes per role, one facilitator who reads the task and does not say where to click, one note-taker, the participant drives. For each step record pass, pass with a note, or fail. A fail goes in the defect log straight away with a screenshot. Then ask the closing questions.

Expected outcomes below are taken from the docs named in each script. Where a doc and the running product disagree, that is a defect (log it), not a reason to change the script.

## Script A: Management

Participant: an organisation Management user. Docs: `docs/QUOTES_AND_APPROVALS.md`, `docs/FORECAST.md`, `docs/TWO_STEP_SIGN_IN.md`, `docs/ASSISTANT.md`, `docs/SEQUENCES.md`, `docs/WEB_FORMS.md`, `docs/OAUTH_CONNECTIONS.md`, `docs/COMMUNICATION.md`, `docs/MULTI_ORGANISATION.md`.

| # | Task | Expected | Result (pass / note / fail) | Defect ID |
|---|---|---|---|---|
| M-1 | Open Settings and find the approval rules for quotes. Set a rule so that a quote above a chosen amount or discount needs approval. | Rules readable and editable by Management only. (`GET/PATCH /approval-rules`: Management A, other roles D in the V1.1 matrix.) | | |
| M-2 | Open Approvals. Decide a pending approval (approve one, reject one with a reason). | Decision recorded; the requester is told by email and the inbox count only. A sole Management user's own request needs a logged override and is never silently self-approved (`DECISIONS.md` section 5, rows 7 and 8). | | |
| M-3 | Open the catalogue; add an item and change its price. Open a quote that uses it. | Management can create and edit catalogue items; Delivery and Restricted Technical cannot open it. | | |
| M-4 | Open Forecast. Read the totals. Compare with the deals you know. Check the targets view. | Figures match the deals you can see; pipeline and targets present. Note anything that does not match your own number. | | |
| M-5 | Two-step sign-in: turn it on for yourself (set up an authenticator app), sign out, sign in again, then use a backup code once. | Setup shows a secret and backup codes once; sign-in asks for the second step; a used backup code is refused the second time. Also try a wrong code several times and read the lock message. | | |
| M-6 | Switcher: use the organisation switcher to move to a second organisation and back. | Only organisations you belong to are listed; data shown changes with the organisation; no record from the other organisation appears. | | |
| M-7 | Assistant settings: read the settings, turn the assistant on or off for the organisation, read the assistant audit. | Settings and audit are Management only (`PUT /assistant/settings` and `GET /assistant/audit`: Management A, others D). | | |
| M-8 | Ask the assistant a question about a deal value and a margin. Then ask the same as a Delivery user (second participant or second browser). | Management sees values the role may see. The Delivery answer shows no value or margin and does not hint at them. The assistant proposes actions only; a person confirms them. It never moves a stage or sets a discount (hard rule 9). | | |
| M-9 | Web forms: create a web form, publish it, submit it from a private browser window with invented data. | A lead appears with the form as source. Submitting many times quickly hits the rate limit (`web_form_rate_limit_action`). The form submission does not need a sign-in. | | |
| M-10 | Sequences: create a follow-up sequence with two steps, enrol a lead, then try to enrol a contact marked do-not-contact. | Steps draft or remind; they do not move a stage or approve anything. Do-not-contact is respected (`assistant_throttle_do_not_contact` migration). | | |
| M-11 | Connect the organisation mailbox (shared mailbox, Management only) and revoke one member's connection. | Connection works through the real Google or Microsoft consent; revoking another person's connection needs `configuration.manage`. | | |
| M-12 | Communication group: open Chat, Mail and Meetings. Create a channel, post a message that mentions a colleague and a record. | Mentioned colleague is notified only if they may open the record; the message body is redacted for people who may not see the record's values. | | |
| M-13 | Audit log: read the entries for the actions you just did (approval decision, two-step, rule change). | Each action present with who and when. | | |
| M-14 | Try the platform console address as a Management user. | Refused; the platform console is a separate identity (`docs/PLATFORM_IDENTITY.md`). | | |
| M-15 | Help and What's new: open both. | Pages load and describe V1.1 features. | | |

## Script B: Sales

Participant: a Sales user. Docs as above.

| # | Task | Expected | Result | Defect ID |
|---|---|---|---|---|
| S-1 | Open a deal and create a quote from the catalogue items. Add a discount. | Quote saved against the deal; margin and cost fields are shown only if the role may see them. | | |
| S-2 | Send the quote for approval (discount above the rule). | An approval request is created; you can cancel your own request; you cannot decide it (`POST /approvals/{id}/decision`: Sales D). | | |
| S-3 | After approval, send the quote. Open the share link in a private window and accept or view it. | Link opens `/sign/{token}` without sign-in; an expired or wrong link gives the plain "not available" page. Note which address the quote email came from: `docs/M13_CLOSEOUT.md` (check a) records that quotes leave from the system address, not the seller's mailbox. Record what the participant expected. | | |
| S-4 | Open Forecast. Find your own target and how far you are. | Own figures shown; compare with your own count. | | |
| S-5 | Two-step sign-in: sign in with the second step. Lose the code and use a backup code. | As M-5. | | |
| S-6 | Assistant: ask "what should I do today", then ask it to draft a follow-up on a lead. Confirm one proposal and dismiss another. Give feedback on an answer. | Proposals wait for your confirmation. Nothing changes until you confirm. Only deals and leads you may see are used. | | |
| S-7 | Assistant masking: ask for the margin or cost on a deal where your role must not see it; ask about a payment. | Answer shows no cost, margin or payment figure. Payments are visible only to Finance and Management. | | |
| S-8 | Connect your own mailbox and calendar. Wait for sync. Send a mail to a contact from the CRM and schedule one for later. | Your own connection needs no Management step. Mail appears on the contact's timeline; the scheduled send leaves at the chosen time, late by up to the scheduler interval. | | |
| S-9 | Sequences: enrol a lead in a sequence; pause it. | Enrolment visible on the lead; pausing stops the next step. | | |
| S-10 | Chat: send a direct message and a channel message; mention a deal. | Delivered; the deal link opens only if you may open it. | | |
| S-11 | Meetings: schedule a meeting with a contact from a deal. | Meeting appears on the calendar and the deal timeline. | | |
| S-12 | Card capture: photograph a business card (invented). | A draft contact or lead is proposed for you to confirm; nothing is saved until you confirm. | | |
| S-13 | Saved views: save a filtered list as a view and reopen it. | View kept for you; reopens with the same filter. | | |
| S-14 | Try to open Settings, approval rules and the assistant audit. | Explained "no access" naming who to ask. | | |
| S-15 | Switcher (if you belong to two organisations). | As M-6. | | |

## Script C: Platform admin

Participant: a platform admin (Michael's console identity, not a tenant role). Docs: `docs/PLATFORM_IDENTITY.md`, `docs/PLATFORM_CONSOLE_API.md`, `docs/PLATFORM_ADMINS.md`, `docs/PLATFORM_BOOTSTRAP.md`, `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md`, `docs/SUPPORT_BY_EMAIL.md`. Console routes in the app: `/platform/sign-in`, `/platform/verify`, organisations, admins, audit, data requests, flags, health, announcements, security, preferences, support access, and the phone pages under `/platform/m`. The V2 items (support access, flags and limits, announcements) are hidden in the MVP (`DECISIONS.md` 7.1): record only whether they are hidden, do not test them as features.

| # | Task | Expected | Result | Defect ID |
|---|---|---|---|---|
| P-1 | Accept the invite (`/platform/accept-invite`), set a password, enrol two-step, save backup codes. | Platform sign-in always requires two-step; sign-in events are audited. | | |
| P-2 | Sign in and out with a wrong code, then a correct one. Trigger the lock with repeated wrong codes. | Lock message shown; lock audited. | | |
| P-3 | Create an organisation (provision) and invite its first Management user. | Organisation created with defaults; invite delivered by email. | | |
| P-4 | Open an organisation. Suspend it, then reactivate it. Sign in as one of its users while suspended. | Suspended users get the explained suspended message; state change audited. | | |
| P-5 | Set the organisation's release or a toggle (pilot a customer ahead of the rest) and check the tenant sees the feature appear. | Release override recorded as `release_override.changed`; the tenant's features follow. Note whether this is possible from the console UI or only by script (`docs/FEATURE_FLAGS.md` says the setter is not an HTTP route). | | |
| P-6 | Admins: invite a second platform admin; remove or lock one. Check that the last admin cannot be removed. | Changes audited; refusal for the last admin. | | |
| P-7 | Data requests: raise an export request for an organisation, approve it (a second admin if required), download within the window. | Export packaged; expires after 14 days; every step in the platform audit. Deletion is a separate, approved call and is not run in UAT. | | |
| P-8 | Platform audit: read the entries from P-3 to P-7; run the chain check if the console offers one. | All present; chain intact. | | |
| P-9 | Health page and phone pages (`/platform/m`, health, approvals). | Load at phone width; health matches `/api/health`. | | |
| P-10 | Support requests: ask a tenant user to email support (Resend); find the ticket in the console. | Ticket lives in the console. Needs the Resend key from Michael (`docs/SUPPORT_BY_EMAIL.md`). | | |
| P-11 | Try to reach a tenant organisation's records as a platform admin without support access. | Refused; no tenant data is readable through the platform identity (`tests/` platform denial suite, G2.02). | | |

## Questions to ask at the end of each session

1. What was hardest to find?
2. What did you expect to see that was not there?
3. Did anything look different from the design you saw?
4. Would you use this tomorrow instead of what you use now? What stops you?
5. Anything you saw (price, margin, payment, customer detail) that you feel your role should not see? Anything hidden that you need?
6. For the assistant: did you trust the answer? Did it ever show something it should not?

## Defect log template

Record each defect in `docs/QA_DEFECTS.md` (the same table V1 used) with the next free ID, or copy the row format below. Severity rules are the V1 rules from `docs/UAT_V1.md`; a masking or tenant-isolation failure is always a Blocker.

| Severity | Meaning | Rule |
|---|---|---|
| Blocker | Data loss or wrong data shown, a role sees what it must not (values, margins, payments, another organisation), a screen cannot be used, sign-in or two-step broken | Fix before release; no deferral |
| Major | A job can be done only by a workaround, or a clear design mismatch on a main screen | Fix before release, or Management defers it in writing |
| Minor | Cosmetic, copy, rare path | Triage to backlog |

| ID | Date | Script step | Role | Severity | Summary | Steps to reproduce | Expected | Actual | Screenshot | Owner | Status | Decision (fix / defer / won't fix) and who decided |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |

## Sign-off record (left empty on purpose)

| Role | Participant | Date | Session notes | Blockers open | Signed |
|---|---|---|---|---|---|
| Management | | | | | |
| Sales | | | | | |
| Platform admin | | | | | |

Release approval (see `docs/V1_1_RELEASE.md` section 11):

| Decision | Name | Date | Signature or written confirmation |
|---|---|---|---|
| UAT accepted by Management | | | |
| Given | | | |
| Michael | | | |

UAT sign-off is recorded by Management. Status: **not started**. Owner: Given (to arrange sessions and participants), not done.

## What these scripts do not cover

- Delivery, Finance and Restricted Technical roles: the V1.1 matrix shows them reaching few new routes (see `docs/PERMISSION_MATRIX_REPORT_V1_1.md`), so only the masking questions above touch them. Add a short script if a real Delivery, Finance or Restricted Technical user joins the session. Owner: facilitator, not done.
- Performance, accessibility and device passes for the V1.1 screens: not defined here.
- Customer Support role: removed (`DECISIONS.md` section 5, decision 12). Support is by email to the platform console.
- V2 screens: hidden in the MVP.
