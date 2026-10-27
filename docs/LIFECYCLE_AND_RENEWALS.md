# Customer lifecycle, recurring services, reminders and retention (Stage 3)

FIG-1048 (B3.02), FIG-1051 (B3.05), FIG-795, FIG-1052 (B3.06).

## Lifecycle engine (`src/services/lifecycleService.ts`)

A company's lifecycle state changes only through `transitionCompany`. It is **idempotent**, writes a history row
(`lifecycle_events`, shown on the Customer 360 timeline) and an audit event (`company.lifecycle_state_changed`), and
never skips either. A change made by two requests at once is a compare-and-set: one wins, one event is written.

| Trigger | Moves to | Reason code |
|---|---|---|
| A lead is converted | Prospect (only when the company has no state yet) | `LEAD_CONVERTED` |
| A deal is won | the state the handoff settings name, default Customer | `DEAL_WON` |
| A Delivery owner takes the handoff (or Management reopens a delivered one) | Onboarding | `DEAL_WON` |
| The handoff is marked Delivered | Active Customer | `HANDOFF_DELIVERED` |
| A renewal is due or lapsed (daily job) | Renewal | `RENEWAL_WINDOW` |
| Renewed, back inside the window (daily job) | Active Customer | `RENEWAL_DONE` |
| No activity beyond the dormancy threshold (daily job) | Dormant Customer | `DORMANT` |
| Activity returns (daily job) | Active Customer | `REACTIVATED` |
| A person, with a reason | any state | `MANUAL` |

- **Renewal outranks Dormant** when both are true.
- The daily job (`lifecycle.sweep`) looks at Customer, Active Customer, Renewal and Dormant companies and re-evaluates
  them from scratch, so **changing the dormancy threshold takes effect on the next run, in both directions**. Prospects
  and Onboarding customers are left to the events that move them. Archived companies are skipped.
- **Last activity** is the latest activity or message on the company or one of its contacts, a deal moving, or a service
  renewal (`LAST_ACTIVITY_SQL`). A company with none counts from when it was created.
- The threshold is the organisation's `reports.dormancy_days` (default 90), the same value the customer reports use.
- **Manual override** (`companies.edit`, reason required) sets `lifecycle_manual`; the job then leaves that company alone
  until the override is released (`DELETE /companies/{id}/lifecycle`). A real event (a deal won) still moves it.
- The state catalogue is the organisation's own (FIG-750); a missing state is skipped and logged, never invented.

## Recurring services (`src/services/recurringServiceService.ts`)

A service that renews on a date (hosting, Starlink plans, retainers): company, service, billing cycle (monthly,
quarterly, yearly), value, start, renewal date, owner, auto-renew. Existing running company services with an end date
were backfilled as yearly recurring services by the migration.

**The state is derived from the dates** (`src/lib/renewals.ts`), never set by hand:

1. cancelled wins; then a person's override (always with a reason);
2. starts in the future: `STARTS_LATER`;
3. renewal date past by more than the grace days: `LAPSED`;
4. renewal within the due window (default 30 days), or past but inside the grace (default 14): `DUE_SOON`;
5. otherwise `ACTIVE`.

The window and the grace are the organisation's (`renewal-settings`, Management). The value is masked like a deal's:
Management and Finance see it, and so does the person who owns the service.

**Renew** moves the date one period on (and, for a late renewal, ahead of today), clears any override, adds a note to
the company's timeline, and can also create a renewal task (`tasks.create`) and a draft invoice
(`finance.manage.payments`). A month-end renewal keeps the day where it exists (31 Jan becomes 28 Feb).

## Reminders (`src/services/reminderService.ts`, FIG-795)

They only tell people; they never move a stage, set a discount or approve anything (CLAUDE.md rule 9). Each rule can be
switched off and has its own threshold (`reminder-settings`, Management). Each is keyed on its trigger, so a repeat
run sends nothing twice (a partial unique index on the reminder notification types).

| Rule | Default | Tells | Trigger key |
|---|---|---|---|
| Proposal follow-up | a proposal SENT and untouched for 5 days | the proposal's owner, else the deal's | proposal and its last update |
| Renewal | a service renewing within 30 days, or already due | the service's owner, else the company's | service and renewal date |
| Dormant customer | a customer went dormant in the last run | the company's owner | company and the transition |
| Overdue invoice | past its due date | Finance and the deal owner (no amount) | invoice and due date |

Jobs: `lifecycle.sweep` and `reminders.sweep`, daily, through the job framework (`docs/JOBS.md`).

## Renewals and retention (`src/services/retentionService.ts`, design E2)

Five lists. **A customer appears in exactly one, the first that applies, with the reason stated**; anything else that
also applies is on the row as `alsoMatches`. The counts are the lists' own lengths.

| # | List | Rule |
|---|---|---|
| 1 | `LAPSED` | a recurring service past the grace window |
| 2 | `DUE_30` | renewing within 30 days, or past the date but inside the grace |
| 3 | `UNANSWERED_PROPOSALS` | a proposal sent more than the follow-up time ago, on an open deal |
| 4 | `GOING_QUIET` | no activity for half the dormancy time or more, not yet dormant |
| 5 | `CROSS_SELL` | a service at least two similar customers (same industry) use and this one does not |

A customer is a company in a customer lifecycle state, or with a won deal or a running recurring service. Management
sees every customer; Sales sees the customers it owns. Each row carries the owner, the reason, a suggested action and a
path for it.
