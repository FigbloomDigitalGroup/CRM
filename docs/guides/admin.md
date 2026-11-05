# Admin guide (Management)

Only Management reaches **Settings**. Everyone else sees an explained "no access" page. Every change you make is recorded in the audit log, and each editor says what a change affects before you save.

Open Settings from the sidebar. Each section is a tab on the left (on a phone, a scrolling row).

## Members and roles (Settings, Members)

| Task | How |
|---|---|
| Invite someone | Invite: name, email and role. They get an email to set their password. |
| Change a role | Pick the new role on their row. Check the [role table](#who-sees-what) first. |
| Invite not accepted | The row says Invited, with an "expired" flag when it ran out. Resend or cancel it. |
| Someone leaves | **Deactivate**. Their records stay and the open work is listed. Hand it over to a colleague. You can reactivate later. |
| Remove completely | Refused while the person owns open records. The dialog lists them and lets you hand them over, then remove. |
| Locked out | **Unlock** on their row. |

You cannot act on your own membership. Customer Support is not offered in the role list (it is switched off). Someone who already has it keeps it.

### Who sees what

| Role | Sees | Does not see |
|---|---|---|
| Management | Everything, including values, margins and payments | Nothing is hidden |
| Sales | Own leads and deals, the shared lead pool, customers | Others' deals and values, margins, payments, settings |
| Delivery | Won deals (no price or margin), handoffs, customers | Leads, open pipeline, payments, settings |
| Finance | Won deals with values, payments, customers | Leads, open pipeline, margins, settings |
| Restricted Technical | Own tasks and the work given to them | Deals, customers, money, reports |

The read-only role table is in Settings, Security & access.

## Organisation settings

- **Organization profile**: name, phone, website, address, time zone, working days and hours, logo (PNG, JPG or WebP, up to 2 MB). Set the default look for new members. You can stop members personalising the brand look. Text size, density and accessibility always stay personal.
- **Reference data**: lead sources, lead statuses, lost reasons, services, customer lifecycle. Add, rename, reorder, hide or merge. A value in use can be hidden, not deleted. A value marked "Used by the system" cannot be changed that way. Pipeline stages can only be renamed in V1.
- **Customer lifecycle**: days for renewals due soon and grace, and the reminder switches. Reminders create tasks and notices. They never move a customer.
- **Onboarding template**: the tasks offered when a deal is won.
- **Message templates, Tags, Custom fields**: hide instead of delete. A required custom field is enforced only when a lead is qualified, never at quick capture.
- **Automations**: each rule has a switch and a run log. Automations assign, remind and draft. They never move a deal stage, set a discount or approve anything.
- **Integrations**: Website form and Inbound email have their own tabs. WhatsApp click-to-chat is set up here.

### Website form key

Open Settings, Website integration. A new key is shown **once**, so copy it straight away. Afterwards only its start is shown. To change it, **rotate** with a grace period of 0 to 72 hours so the old key keeps working while the website is updated. The state says Connected only after a real lead has been received.

## Data migration wizard (Settings, Data migration)

Seven steps. The session is saved on the server, so you can leave and come back to the same step ("Earlier migrations").

1. **Source**: what to bring in (companies, contacts, leads, deals, tasks, activities), our template or your own spreadsheet, and what to do with duplicates.
2. **Upload**: a `.csv` or `.xlsx` file up to 20 MB. Download the template here.
3. **Map**: match each CRM field to a column. Required fields are marked.
4. **Validate**: see the problem rows (with a downloadable error report) and choose what to do with values the CRM does not know. Nothing is guessed.
5. **Dry run**: shows what would be added, updated and skipped. It writes nothing. Read it.
6. **Import**: tick to confirm. You can cancel until it finishes.
7. **Report**: added, updated, skipped and failed, plus the error report. You can **roll back** for a limited time. Records edited since, and records others now depend on, are kept.

Tip: import a 20-row sample first.

## Audit log (Settings, Audit log)

Read-only. Filter by person, record type, action and dates. Open a row to see before and after. Export the filtered list as CSV. Payment changes are also shown on the invoice itself (Payments, open the invoice).

## Security and privacy

- **Security & access**: set how long a session lasts (applies to new sign-ins). Sign-in rules are fixed: five wrong passwords lock the account for 15 minutes, and a password needs at least 10 characters. See every member's sign-in events and the read-only role table.
- **Data & privacy**: who may export, the approval threshold, how long each type of data is kept (empty keeps it), legal hold (needs a reason), and data-subject requests with deadlines. Deleting someone's data needs a second person to confirm.
- Never paste passwords, account numbers or customer secrets into notes or the payment label.

## Your weekly check

1. Members: anyone to deactivate? Any invite expired?
2. Home: usage. Is anyone not using the CRM?
3. Audit log: anything unexpected?
4. Reports: do the numbers match what you know?
