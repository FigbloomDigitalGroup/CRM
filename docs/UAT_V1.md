# V1 user acceptance testing (Q1.06, FIG-1120)

Purpose: real people confirm the new CRM matches the approved design and supports their day. This document holds the **scripts**, the **defect log format**, and the **sign-off record**. The sessions themselves need people and the staging environment (P1.01, FIG-1123, in M12); nothing below has been run with users yet, and nothing is signed.

Depends on: Q1.01 (journeys in CI), P1.01 (staging with migrated data). Until staging exists, the scripts can be rehearsed on a local build with `npm run db:setup` and the dev accounts.

## How a session runs

1. 60 to 90 minutes per role, one facilitator, one note-taker, the participant drives. Facilitator reads the task, says nothing about where to click.
2. Participant signs in as themselves on staging (migrated data), not a dev chip.
3. For each step: pass, pass with a note, or fail. A fail is written to the defect log straight away with a screenshot.
4. At the end: five questions (below), and the five provisional permission departures are read out and answered.

## Scripts

### Management (organisation admin)
1. Sign in; read the Management home. Which number do you look at first? Does it match what you know? (D2)
2. Open Leads; filter to this week's website leads; assign three to Sales; export the list. (L1, L3)
3. Open a deal in Proposal Sent; read the value, margin and next step; move it to Won; fill the handoff. (P1, P2, P3)
4. Open Customer 360 for a company you know; check the contacts, deals, payments and renewal date are right. (C2)
5. Payments: find an invoice that is overdue; see who owes what. (F1)
6. Reports: pick last month; read lead sources and win rate; compare to your own number. (R1)
7. Settings: invite a member, change a role, read the audit log for that change. (S1, S2, S8)
8. Preferences: change theme, density and text size; sign out and in on a phone; check it followed you. (AP1, AP2)
9. Try to open a screen you should not need; read the "no access" message. Is it clear who to ask? (S4)

### Sales
1. Sign in; read "Today". Is the order of the list what you would work through? (D1)
2. Capture a lead from the phone (quick capture), with no signal, then reconnect. (M1, offline queue)
3. Qualify a lead; convert it to a deal; set the next step. (L2, L3, P1)
4. Log a call from a contact (call, then the "How did it go?" prompt). (C3)
5. Create a task for tomorrow; complete one; use the calendar. (T1, T2)
6. Search for a customer by phone number fragment; open the result. (G2)
7. Open a won deal's handoff to Delivery; read what Delivery sees. (P3, P4)
8. Try to open Payments and Settings; read the message. (S4)

### Delivery
1. Home: what is waiting for you? (D3)
2. Handoffs: open a received handoff; read the deal summary; confirm there is no price or margin shown. (P4, masking)
3. Tasks and calendar for your own work. (T1, T2)
4. Customer 360: read the services, renewal date and contacts; confirm values are hidden. (C2)

### Finance
1. Home. (D3)
2. Payments: record a payment; mark an invoice sent; read the summary. (F1)
3. Customer 360 payments tab. (C2)
4. Confirm you cannot see the leads list or the pipeline board. (S4)

### Restricted Technical
1. My work: tasks and the conversations you are on. (D3)
2. Confirm you cannot see deals, customers' values, payments or reports. (S4)

### Phone (any role): M1 to M3, PWA install, offline queue, 375 px
1. Install to the home screen; open from the icon.
2. Today, Leads, Customers, Tasks, Alerts, More. Everything reachable with a thumb?
3. Turn on aeroplane mode; capture a lead and log a note; turn it off; confirm both sync and nothing is duplicated.

## Questions to ask at the end of each session
1. What was hardest to find?
2. What did you expect to see that was not there?
3. Did anything look different from the design you saw?
4. Would you use this tomorrow instead of what you use now? What stops you?
5. The five provisional permission departures (`docs/DECISIONS.md`): do these match how your team really works? Which would you change?

## Defect log

Write each defect to `docs/QA_DEFECTS.md` (same table the bug bash uses). Severity rules:

| Severity | Meaning | Rule |
|---|---|---|
| Blocker | Data loss or wrong data shown, a role sees what it must not, a screen cannot be used, sign-in broken | Fix before the quality gate; no deferral |
| Major | A job can be done only by a workaround, or a clear design mismatch on a main screen | Fix before the quality gate, or Management defers it in writing |
| Minor | Cosmetic, copy, rare path | Triage to backlog |

## Sign-off record

| Role | Participant | Date | Session notes | Blockers open | Signed |
|---|---|---|---|---|---|
| Management | | | | | |
| Sales | | | | | |
| Delivery | | | | | |
| Finance | | | | | |

UAT sign-off is recorded by Management. Status: **not started** (waiting for staging, FIG-1123).
