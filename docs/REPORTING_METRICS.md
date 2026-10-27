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

## Page usage (FIG-752)

- **Scope:** fixed trailing 7-day window (`Date.now() - 7 days`) -- **not**
  affected by the Reports page's `dateFrom`/`dateTo` filter, same treatment
  as "Pipeline by stage"'s live-snapshot exemption.
- **Query:** `getWeeklyPageUsage` (`src/services/pageViewService.ts`) ->
  `getPageUsageSummary` (`src/repositories/pageViews.ts`) --
  `PageView.groupBy({ by: ["page"] })` for visit counts, plus two
  `distinct` row fetches (`["membershipId"]` org-wide, `["page",
  "membershipId"]` per page) for active-user counts, since Prisma's
  `groupBy` can't produce a distinct-count aggregate directly.
- **Chart:** none -- a single stat (org-wide weekly active users) plus a
  table, one row per page.
- **Definition:** for each page label, how many page-view rows were
  recorded in the last 7 days (visits) and how many distinct memberships
  generated at least one of them (active users); separately, the count of
  distinct memberships active on *any* page in that window.
- **What's recorded, and what isn't:** `recordPageView` (called once near
  the top of every top-level org page, right after `resolveRequestContext`
  resolves) writes exactly `organizationId` + `membershipId` + a page
  label + a timestamp. The page label is always a literal from the fixed
  `PAGE_VIEW_LABELS` set in `pageViewService.ts` (e.g. `"leads"`,
  `"leads_detail"`) -- never a raw pathname, so a specific lead/deal/
  company/contact id is never recorded, satisfying the ticket's "don't
  record record contents or anything beyond page + user + time."
  Recording is best-effort: a failure is logged and swallowed, never
  surfaced to the caller, so instrumentation can't break a page render.
- **Permission:** `reporting.view.all` (Management only) -- same gate as
  every other organization-wide metric on this page.

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

## Personal reports (`reporting.view.own`)

Roles without `reporting.view.all` get the same figures, scoped to what the
role may already see (`getMyMetrics` / `getReportScope` in
`src/services/reportingService.ts`; API: `GET /api/orgs/<org>/reports/my-metrics`):

- **Leads / deals:** own-only roles (Sales) report on records they own; a
  role that can view every deal (Delivery, Finance) reports on every deal.
- **Tasks:** follow-up figures cover tasks assigned to the caller.
- **Areas a role cannot open are omitted** (Finance has no lead or task
  figures, Delivery has no lead figures).
- **Deal values:** shown for deals you own, otherwise only with
  `deals.view.value`; otherwise counts are shown instead.
- No owner filter, page usage or CSV export (Management only).

## Customer reports (FIG-793)

Three reports for the customer base, built as service functions in
`src/services/customerReportService.ts` (queries in
`src/repositories/customerReports.ts`). They feed the Reports v2 screens
(B3.09 / F3.07). API: `GET /api/orgs/<org>/reports/customers`,
`.../sales-by-salesperson`, `.../renewals`, CSV at
`.../reports/customers-export`, and the dormancy default at
`.../reports/settings`.

### Active, repeat and dormant customers

- **Scope:** live snapshot -- not affected by the date range.
- **Customer:** a non-archived company with at least one won deal (not
  archived), or a running service.
- **Active:** the company has a service that is `ACTIVE` and not past its end
  date, **or** it won a deal within the dormancy threshold.
- **Dormant:** a customer that is not active.
- **Repeat:** two or more won deals. Independent of active/dormant, so a
  customer can be "active and repeat" or "dormant and repeat".
- **Dormancy threshold:** default 90 days. Each organisation can save its own
  (`PUT .../reports/settings`, 1 to 3650 days, Management only, audited as
  `report_settings.updated`), and a request can override it with
  `dormantAfterDays`.
- **Output:** a summary (`customers`, `active`, `repeat`, `dormant`; always
  the whole customer base) and a paged list (`segment` filter), most recent
  win first, with won count, won value, last won date, running services.
- **Chart:** donut or bar of active / dormant with the repeat share.
- **Permission and masking:** `reporting.view.all`. `wonValue` is hidden
  without `deals.view.value`.

### Won value and count by salesperson

- **Scope:** range-scoped, by `Deal.wonAt` (same window rules as above), with
  optional `ownerMembershipId`, `serviceId` filters and `period=month`
  (calendar months, UTC) to split each salesperson by month of the win.
- **Definition:** won deals in the window per deal owner: count and total value.
- **Chart:** bar per salesperson (value, or count when masked); grouped bars
  by month for `period=month`.
- **Permission and masking:** every role with report access, scoped like
  personal reports. Management sees everyone. An own-only role (Sales) sees
  only their own row, and an owner filter cannot widen it. Roles that view
  every deal (Delivery, Finance) see all rows. Values are shown on your own
  deals, otherwise only with `deals.view.value` (so Delivery sees counts only).

### Upcoming renewals / service end dates

- **Scope:** live snapshot of company services (`CompanyService`).
- **Definition:** services with status `ACTIVE` and an end date within the
  next `withinDays` days (default 90, 1 to 365), soonest first. Services past
  their end date but still `ACTIVE` are included and flagged `lapsed`.
  Open-ended services (no end date), completed and cancelled ones, and
  archived companies are excluded.
- **Output:** summary (`renewing`, `lapsed`) and a paged list with company,
  service, end date, days left.
- **Permission:** `reporting.view.all` and `company_services.view`.

### CSV

`GET .../reports/customers-export` (needs `export.bulk`, so Management)
writes four sections: customer summary, customers, won by salesperson,
upcoming renewals. It calls the same service functions, so scope and masking
are identical to the screens. Each export is audited (`reports.exported`).

## Date range and integrity notes

- A date-only "to" includes that whole day; unreadable dates fall back to
  the default window; a reversed range is swapped.
- The open-pipeline snapshot excludes archived deals.

## Reports v2 and My metrics (FIG-1055, B3.09)

`src/services/reportsV2Service.ts` (aggregations in `src/repositories/reportsV2.ts`, all in SQL). API:
`GET /api/orgs/<org>/reports/v2` (every report), `.../reports/v2/<KEY>`, `.../reports/v2/<KEY>/export` (CSV),
`.../reports/v2/my-metrics` and `.../my-metrics/export`. Forecast arrives in B6.14.

Every report answers in one shape: `table` (columns, rows and a totals row), `chart` (type, the metric plotted and
the series, **read from the same rows as the table**, so a chart and its table are the same numbers), `definition` (the
sentence below), `scope`, `range` and `valueMasked`. A rate with nothing to divide by is **0, never NaN or
"UNDEFINED"**; a percentage change against a zero is empty (`null`).

Organisation reports need `reporting.view.all` (Management). A caller without `deals.view.value` gets every money
column as `null` and the chart falls back to counts. CSV is the same table with its totals row; above 500 rows it needs
`export.bulk`, like every export, and each export is audited (`report.exported`).

| Key | Definition (also returned with the report) | Range |
|---|---|---|
| `LEAD_SOURCES` | Leads created in the date range, counted by the source they came from. A lead with no source is counted as No source. | range |
| `CONVERSION_BY_SOURCE` | Of the leads created in the date range, how many have become a deal as of today, by source. Conversion is converted divided by created, shown as 0% when no leads were created. | range |
| `CONVERSION_BY_STAGE` | Of the leads created in the date range, how many sit at each lead status now, and how many of those have become a deal. | range |
| `PIPELINE_BY_STAGE` | A live snapshot of open, un-archived deals: the count and total value at each pipeline stage. | live |
| `LOST_REASONS` | Deals marked lost in the date range, counted by the reason recorded. Share is the reason's deals divided by all lost deals. | range, by `lostAt` |
| `PER_PERSON` | For each salesperson: leads they were given in the range, how many converted, deals they won in the range with their value, and tasks they completed. | range |
| `MONTH_VS_LAST` | The same measures for this calendar month so far and for the whole of last month. Change is this month minus last month. | this and last month (UTC) |
| `CUSTOMERS` | A live snapshot of customers: active, repeat and dormant, following the customer report. | live |
| `RENEWALS` | A live snapshot of recurring services by renewal state, with their total value. | live |

**My metrics** counts only the caller's own records, whatever else their role can see, and shows the cards that fit the
role: Sales leads, conversion, deals won and value, open pipeline and calls logged; Delivery handoffs taken and
delivered and onboarding in progress; Finance invoices created, payments recorded and the amount, and follow-up notes
kept; everyone with tasks their tasks done, open and overdue. Technical has no reporting permission and is refused.
Counts of "live" figures (open deals, open tasks, onboarding) ignore the date range.
