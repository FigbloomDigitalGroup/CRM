# Training plan

Status: plan only. No session has been scheduled, held or recorded yet (FIG-1129 needs people for that).

Goal: every user can do their first-10-minutes list and their daily routine without help. Teach from the role guide. Use the training organisation or staging with test data, not live customer data. Sign in as the learner, not as a shared account.

## Session outline per role

| Session | Who | Length | Guide |
|---|---|---|---|
| A. Management and admin | Management | 90 min | [Management](management.md), [Admin](admin.md) |
| B. Sales | Sales | 75 min | [Sales](sales.md) |
| C. Delivery | Delivery | 45 min | [Delivery](delivery.md) |
| D. Finance | Finance | 60 min | [Finance](finance.md) |
| E. Technical | Restricted Technical | 30 min | [Technical](technical.md) |
| F. Phone (every role) | Anyone using a phone | 20 min | role guide, More menu |

One trainer, one note-taker for the first round. Maximum eight people per session.

### A. Management and admin (90 min)
1. 10 min: Home, what each number means.
2. 20 min: Members, roles, invites, deactivate and hand over.
3. 20 min: Settings: profile, lists, automations, website key.
4. 20 min: Data migration wizard on a sample file, dry run, rollback.
5. 10 min: Audit log, security and privacy.
6. 10 min: Questions and the [first-run checklist](first-run-checklist.md).

### B. Sales (75 min)
1. 10 min: Today and Preferences.
2. 15 min: Capture a lead, duplicate warning, qualify, convert.
3. 15 min: Deals, next step, hand over a won deal.
4. 10 min: Log a call and the "How did it go?" prompt.
5. 10 min: Tasks, calendar, search.
6. 10 min: What is hidden and why. Practice reading a "no access" page.
7. 5 min: Questions.

### C. Delivery (45 min)
1. 10 min: Home and Handoffs. 2. 10 min: Read a handoff, no price shown. 3. 10 min: Tasks, calendar, notes. 4. 10 min: Customer page, mark Delivered. 5. 5 min: Questions.

### D. Finance (60 min)
1. 10 min: Home and Payments list. 2. 15 min: Invoice: mark sent, record a payment. 3. 10 min: Reverse a payment, void an invoice. 4. 10 min: Follow-up notes on overdue invoices. 5. 10 min: What is hidden and why. 6. 5 min: Questions.

### E. Technical (30 min)
1. 10 min: My work. 2. 10 min: Complete a task, add a note. 3. 10 min: Notifications, what is hidden.

### F. Phone (20 min)
Install to the home screen. Today, Capture, Customers, Tasks. Switch on aeroplane mode, capture a lead, switch off, check it synced once. Pipeline is read-only on the phone.

## Dry-run script: onboarding a new user

Do this with a test organisation before real training. It is the test for FIG-1129. Record pass or fail for each step.

| # | Who | Step | Expected result | Pass |
|---|---|---|---|---|
| 1 | Management | Settings, Members, Invite a test person with the Sales role | Row shows Invited | |
| 2 | New user | Open the email and set a password | Signed in, lands on Today | |
| 3 | New user | Open Preferences, change the look | Look changes and stays after sign-out | |
| 4 | New user | Open the phone page and install it | Icon on the home screen | |
| 5 | New user | Follow the "first 10 minutes" in the Sales guide | Each step possible without help | |
| 6 | New user | Open Payments and Settings | Explained no-access, says who to ask | |
| 7 | New user | Open a deal that is not theirs | Value shows Hidden | |
| 8 | Management | Settings, Audit log | Invite and role are listed | |
| 9 | Management | Change role to Delivery | The new user's menu changes to Delivery's | |
| 10 | Management | Deactivate the test user | Their sign-in stops, records stay | |

Repeat steps 1 to 6 with a Finance and a Delivery role. Write problems in `docs/QA_DEFECTS.md`.

## Attendance sheet (copy for each session)

Session: ____________  Date: ____________  Trainer: ____________  Note-taker: ____________

| Name | Role | Present | Finished the first-10-minutes list | Questions or problems |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

Trainer signature: ____________  Management confirmation: ____________

## What only a person can do

- Record the short walk-through videos (for example: first sign-in, capture a lead, record a payment).
- Schedule the sessions, hold them and fill in the attendance sheets.
- Run the dry run above on staging with a real inbox.
- Decide who signs off training as complete (Management).
