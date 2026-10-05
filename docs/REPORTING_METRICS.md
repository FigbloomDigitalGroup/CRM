# Reporting metric definitions

Canonical reference for every figure shown on the Reports page
(`/o/<org>/reports`), its chart, and the CSV export. The in-page "Metric
definitions" panel is a shorter version of this same content; this document
adds the query each metric is built from, for anyone debugging a number or
adding a new one.

All organization-wide metrics require the `reporting.view.all` permission
(Management only, by default). A caller without `deals.view.value` sees
deal-value figures as hidden (`--` in tables, counts instead of value in
charts) — see "Value masking" below.

## Date range

Every metric below is either **range-scoped** (affected by the `dateFrom`/
`dateTo` filter on the Reports page, defaulting to the last 30 days) or a
**live snapshot** (always "right now", ignoring the date filter). Each
metric's section says which it is.

## Lead volume by source

- **Scope:** range-scoped, by `Lead.createdAt`.
- **Query:** `getLeadVolumeBySource` (`src/repositories/reporting.ts`) —
  `Lead.groupBy({ by: ["leadSourceId"] })`, filtered by `organizationId`,
  the date range, and the optional owner/source filters.
- **Chart:** bar, one bar per source, height = lead count.
- **Definition:** count of leads created within the selected range, grouped
  by lead source.

## Conversion

- **Scope:** range-scoped by `Lead.createdAt` for the denominator; the
  conversion flag itself (`Lead.convertedAt IS NOT NULL`) is checked as of
  now, not gated to the same range.
- **Query:** `getLeadConversionSummary` — two `Lead.count()` calls against
  the same `where`, one with `convertedAt: { not: null }` added.
- **Chart:** donut, "Converted" vs. "Not yet", with the percentage in the
  center.
- **Definition:** of the leads created in the selected range, the
  percentage that have been converted to a deal as of today — regardless of
  when the conversion itself happened. This intentionally differs from
  gating on `convertedAt` falling in the range: a lead created on day 1 and
  converted on day 20 should still count as "created in the range and
  (now) converted," not disappear from the cohort.

## Won / Lost

- **Scope:** range-scoped, by `Deal.wonAt` / `Deal.lostAt` respectively —
  i.e., when the outcome happened, not when the deal was created.
- **Query:** `getDealOutcomeSummary` — two `Deal.aggregate()` calls, one
  `outcome: "WON"` filtered by `wonAt` in range, one `outcome: "LOST"`
  filtered by `lostAt` in range.
- **Chart:** donut, "Won" vs. "Lost" counts, with the win rate
  (`won / (won + lost)`) in the center.
- **Definition:** deals whose outcome changed to Won or Lost within the
  selected date range.

## Pipeline by stage

- **Scope:** live snapshot — **not** affected by the date range. "What's in
  the pipeline right now" isn't a historical question.
- **Query:** `getPipelineValueByStage` — `Deal.groupBy({ by:
  ["pipelineStageId"] })`, filtered to `outcome: "OPEN"`.
- **Chart:** bar, one bar per stage, height = open pipeline value (or deal
  count, when value is masked for the caller).
- **Definition:** a current snapshot of open deals' total value, grouped by
  pipeline stage.

## Sales by service

- **Scope:** range-scoped, by `Deal.wonAt`.
- **Query:** `getSalesByService` — `Deal.groupBy({ by: ["serviceId"] })`,
  filtered to `outcome: "WON"` and `wonAt` in range.
- **Chart:** bar, one bar per service, height = won value (or won-deal
  count, when value is masked).
- **Definition:** total value of deals won within the selected date range,
  grouped by service.

## Follow-up performance

- **Scope:** range-scoped, by `Task.dueAt`.
- **Query:** `getFollowUpStatusBreakdown` — `Task.groupBy({ by: ["status"]
  })`, filtered by `dueAt` in range and the optional owner filter.
- **Chart:** none — table only (not one of the five chart categories this
  feature covers).
- **Definition:** tasks whose due date fell within the selected range,
  grouped by their current status.

## Value masking

A caller who can view reports (`reporting.view.all`) but lacks
`deals.view.value` sees every value-bearing figure (won value, pipeline
value, sales-by-service value) hidden — the table shows `--` and the
corresponding bar chart falls back to plotting counts instead, with the
card's heading noting which it's showing. This mirrors the same masking
rule applied to individual deal records elsewhere in the app
(`dealService.ts`'s `maskValue`); an aggregate can't be partially masked,
so it's shown in full or not at all.

## Performance (FIG-603)

The five grouped/aggregated queries above filter on columns that, before
FIG-603, had no dedicated index: `Lead.createdAt`, `Lead.convertedAt`,
`Deal.outcome` + `wonAt`/`lostAt`, and `Deal.serviceId`. See migration
`20261005070422_reporting_indexes` for the composite indexes added to
cover them (all prefixed by `organizationId`, matching this schema's
tenant-isolation convention).
