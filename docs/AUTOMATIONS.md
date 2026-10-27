# Automations (FIG-1059, B4.02)

Settings > Automations (S5) shows the things the CRM does on its own as **visible rules** that Management can switch on and off.

## The boundary

Automations **assign, remind and draft. They never decide.** No rule moves a deal stage, sets a discount, approves anything or changes
an owner, with one exception: the *website lead assignment* rule, which is explicitly an assignment rule and may choose the owner of a
lead it has just been given.

This is enforced in three places and tested in `tests/automations.test.ts`:

1. **The catalogue** (`src/automations/catalogue.ts`) is code. Each rule declares the only actions it may take (`ASSIGN_OWNER`, `CREATE_TASK`,
   `NOTIFY`, `FLAG`). `assertRuleMay` refuses any other. Only one rule may `ASSIGN_OWNER`.
2. **The effects module** (`src/automations/effects.ts`) is the only code that carries out a rule's effect (create a task, notify people).
   A source scan fails the build if anything in `src/automations/` names a stage, outcome, discount or approval field.
3. **A runtime test** runs every rule end to end and compares every deal, proposal and invoice before and after: nothing changes.

## The rules

| Rule | What it does | Off means | Settings |
|---|---|---|---|
| Assign website leads (FIG-751) | Owner by assignment rules, then round robin | Lead left unassigned | fallback: round robin or unassigned |
| Follow-up task on a new website lead | One task for the owner | No task | due after N hours (1 to 168, default 24) |
| Proposal follow-up (FIG-795) | Reminds the proposal owner | Nothing sent | days (default 5), audience |
| Renewal reminder (FIG-795) | Reminds the service owner | Nothing sent | days ahead (default 30), audience |
| Dormant customer flag (FIG-1048) | Flags a quiet customer Dormant and tells the owner | Nothing flagged | days (the dormancy threshold, default 90), audience |
| Stalled deal alert | Tells the deal owner a deal has stalled; never moves it | Nothing sent | audience; the number of days is the deal rules' own |
| Onboarding tasks at handoff (FIG-792) | Creates the onboarding task template for Delivery | Handoff without tasks | the template itself is in the handoff settings |
| Overdue invoice notice (FIG-795) | Tells Finance, and the deal owner without amounts | Nothing sent | none |

The first five of those that already had settings (reminders, the dormancy threshold, the assignment fallback) keep their state where it
already lived, so the older endpoints and this screen can never disagree. Audiences (`OWNER` or `OWNER_AND_MANAGEMENT`) live in `automation_rules`.

## One effect per trigger, and the run log

Every effect is keyed on a stable **trigger** (`lead:<id>`, `proposal:<id>:<date>`, `deal:<id>:<last activity date>`). A partial unique index
(`automation_runs_one_effect_key`) allows one APPLIED run per rule and trigger, so a repeat run, or two workers at once, does nothing the second time.
A rule that fails is logged FAILED, never throws into the request or job that raised it, and runs again next time.

`GET /automations/runs` lists each run: rule, record, result, newest first, with filters. Results never carry an invoice number or an amount; runs on
invoices are hidden from a reader who may not see payments.

## Jobs

`automations.sweep` (daily) raises the stalled deal alerts. The reminder and lifecycle sweeps (`reminders.sweep`, `lifecycle.sweep`) are described in
`docs/LIFECYCLE_AND_RENEWALS.md` and now log their effects here.

## Endpoints

`GET /automations`, `GET|PATCH /automations/{ruleKey}`, `GET /automations/runs`. Management only (`configuration.manage`). Every change is audited with before and after.
