# Forecast and targets (FIG-1146, B6.14, design Q4)

V1.1. An estimate from stage probabilities, never a commitment. Code: `src/lib/forecast.ts` (pure arithmetic),
`src/services/forecastService.ts`, `src/repositories/forecast.ts`, migration `20261108134100_sales_targets`.
The screen is `src/ui/screens/commercial/Forecast.tsx`, still on demo data (`commercial/demo/`); it is wired later in M14.

## Routes (outside the frozen V1 contract)

| Route | Who | What |
|---|---|---|
| `GET /api/orgs/{org}/forecast?scope=mine\|team&month=YYYY-MM&months=1..12` | `mine`: Sales (`deals.view.own` or `deals.edit.own`); `team`: `forecast.view.all` (Management) | Weighted pipeline by month, won so far, per-person target progress |
| `GET /api/orgs/{org}/forecast/targets?month=` | everyone with forecast access reads their own target; `forecast.view.all` and `targets.manage` read all | Targets for a month |
| `PUT /api/orgs/{org}/forecast/targets` | `targets.manage` | Set a target `{month, membershipId \| null (team), amount}`; `amount: null` removes it |

Everything needs the organisation to be on release V1.1 (`release.v11`); in V1 each call answers the explained "not available yet".
Stage probabilities are edited where they already are: the pipeline stage's `probability` in the reference catalogs.

## The rules

- **Probability** of a stage is its own `probability` (whole percent). A stage that has none uses the default (Solution Presented 25, Proposal Sent 50, Negotiation 75, any other open stage 0) and is reported with `probabilitySet: false`. Won is 100, lost is 0.
- **Weighted value** of an open deal is its value times the probability, rounded to the cent once per deal, so the buckets always add up to the total.
- **Buckets.** Every open, non-archived deal lands in exactly one place: `earlier` (expected close before the first month), one of the `months` buckets, `later`, or `unscheduled` (no expected close date). `pipeline` is their sum and equals the open total of the Pipeline by stage report.
- **Won** is deals with outcome WON and `wonAt` inside the chosen month, so it reconciles with the won-deals reports.
- **Target progress** for a person is: `achieved` (won reaches the target), `on-track` (won plus the weighted open deals expected to close in the month reaches it), `short` (it does not; `shortBy` is the gap), `no-target` (never short). The team row uses the team target if one is set, otherwise the sum of the people's targets (`targetSource` says which).
- A month without a target for anyone gives `no-target` rows. Targets are for one calendar month; there is no quarter or year target.

## Masking

- A caller's own deals always show their values. Team totals need `deals.view.value`; without it the response carries counts, `valueMasked: true`, `null` money and state `masked` for people and team (never a partial sum). Sales cannot ask for the team (403 explained no-access) and never receive another person's id, deal or figure.
- Targets are not deal values; a person reads their own, `forecast.view.all` and `targets.manage` read all.

## Tests

`tests/forecast.test.ts`: pure arithmetic, fixtures that reconcile to the Pipeline by stage report and to won deals, on-track states, masking by role (including a team caller without `deals.view.value`), release gate, tenant isolation in the service and under RLS.
