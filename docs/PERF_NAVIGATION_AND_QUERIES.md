# Performance: navigation and query changes, measured at 40k leads (6 Nov 2026)

Branch `makeover/perf-navigation-and-queries`. This note records what the changes on that branch did to server time on the scale database, and what they did not. It does not replace `docs/PERF_BASELINE.md` (26 Oct), because the numbers here are not comparable with it (see Caveats).

## What was compared

- **Baseline:** commit `3fc0e04` (the branch point), checked out as a separate worktree.
- **Current:** the working tree on top of it (uncommitted): the membership query (one SQL statement), bounded assistant context, bounded "my work" lists with true counts, batched notification sweep, and the activities page and its total read in one transaction.
- **Data:** the scale database `figbloom_crm_perf` from `scripts/perf-seed.ts`. Organisation `perf-alpha` holds 40,000 leads, 16,000 contacts, 6,400 companies, 12,000 deals, 162,000 activities, 24,000 tasks. A second organisation holds the rest.
- Both trees ran against the same database, one after the other, never at the same time.

## Method

- `tests/perf/api.perf.ts` (existing harness): real route handlers, authorisation mocked, 40 serial calls then 5 rounds of 8 at once. Run once per tree with `PERF_ASSERT=0`.
- `tests/perf/compare.perf.ts` (new, this note): the same style of measurement for the paths the branch changed, which the harness does not cover. It runs the auth building blocks on their own (the harness mocks them), the lead-detail endpoint set, `getMyActionableWork` and `buildAssistantContext`. Run as three interleaved rounds (baseline, current, baseline, current, baseline, current); tables show the median of the rounds. Statement counts come from `log_statement = 'all'` on the perf database only, around one call.
- List and count experiment: parallel two-transaction against one merged transaction, at repository level, 60 serial calls and 10 rounds of 8, each shape measured in two interleaved passes.

## Results

### Auth path (`resolveActiveMembership`, plus the organisation lookup)

The harness mocks this, so it is measured on its own. Median of 3 rounds, 50 calls per round, milliseconds.

| Call | Statements | p50 before to after | p95 before to after |
|---|---|---|---|
| Organisation lookup plus membership, Management | 7 to 3 | 21.0 to 9.9 | 44.0 to 15.2 |
| Organisation lookup plus membership, Sales | 7 to 3 | 18.4 to 10.1 | 33.2 to 25.1 |
| Membership only, Management | | 16.7 to 5.2 | 33.7 to 16.4 |
| Membership only, Sales | | 13.4 to 5.9 | 18.4 to 18.4 |

The permission keys are identical before and after (57 for Management, 35 for Sales). The session lookup (2 statements) is unchanged and not in this table. The membership tables are small even on the scale database, so this is the same cost as on the dev database; it does not grow with leads.

### Changes that remove unbounded work (the large ones)

| Path | Before | After |
|---|---|---|
| `buildAssistantContext`, Management | **Failed on every round**: Prisma's 5 s transaction timeout (it loaded every lead) | 3 transactions, 75 items, p50 about 150 ms, p95 about 160 to 250 ms |
| `buildAssistantContext`, Sales | Failed on 2 of 3 rounds; the one success had p50 2,802 ms | p50 82 to 99 ms, p95 97 to 129 ms |
| `getMyActionableWork`, Management | 297 + 5,977 + 518 rows, p50 935 to 1,076 ms, p95 1,071 to 1,272 ms | 50 + 50 + 50 rows plus the true counts, p50 52 to 59 ms, p95 69 to 97 ms |
| `getMyActionableWork`, Sales | 15 + 416 + 63 rows, p50 79 to 141 ms | 15 + 50 + 50 rows plus counts, p50 50 to 65 ms |

`getMyActionableWork` now opens 8 transactions instead of 4 (the lists plus one COUNT each, in parallel). That is a deliberate trade: the page no longer loads thousands of rows, and the true totals are still shown. The new counts equal the old list lengths (for example overdue 5,978 against 5,977), give or take tasks that became overdue between runs.

### Lead-detail endpoint set (SALES role, a lead with its own activities)

Median of 3 rounds, milliseconds. The rounds disagree with each other by up to a factor of two, see Caveats.

| Endpoint | Transactions | p50 before to after | p95 before to after |
|---|---|---|---|
| GET lead | 1 to 1 | 24 to 32 | 43 to 60 |
| GET qualification | 2 to 2 | 44 to 49 | 81 to 89 |
| GET score | 1 to 1 | 22 to 25 | 54 to 37 |
| GET activities for the lead | **3 to 2** | 29 to 55 | 39 to 101 |
| GET tasks for the lead | 2 to 2 | 13 to 22 | 23 to 57 |
| GET audit for the lead (Management) | 1 to 1 | 11 to 12 | 15 to 21 |

Read this table as "no change worth claiming", not as a regression: GET lead, tasks and audit run unchanged code and also read slower in the current runs, which shows the current runs were on a busier machine. The one change that could be real is the activities endpoint, which was slower in all 3 rounds (p50 29, 27, 34 against 40, 69, 55). The repository-level test below isolates that change: serial it costs about 2.5 ms more (merged transaction), at 8 concurrent calls p95 falls from 66 to 28 ms. Treat the activities merge as a trade for load behaviour, not as a latency win.

### List and count in one transaction (item 5): not applied

Two parallel transactions (what the code does today) against one merged transaction, repository level, averaged over two interleaved passes, milliseconds. "Same" confirms both shapes return the same total and row count.

| Path | p50 | p95 | 8 at once, p95 |
|---|---|---|---|
| Activities, a lead's page (50) | 9.2 to 11.7 | 12.7 to 16.2 | 66 to 28 |
| Leads, first page | 29.7 to 38.1 | 42.1 to 62.9 | 122 to 71 |
| Leads, Sales own | 31.6 to 48.7 | 45.9 to 61.1 | 114 to 129 |
| Leads, deep page 1,200 | 109.6 to 123.8 | 140.6 to 172.3 | 267 to 257 |
| Leads, text search | 188.7 to 234.9 | 255.6 to 311.8 | 680 to 543 |
| Tasks, Sales | 17.9 to 21.4 | 22.9 to 25.8 | 60 to 39 |
| Tasks, all | 17.5 to 24.0 | 23.7 to 29.5 | 52 to 86 |
| Deals, first page | 55.3 to 61.9 | 73.7 to 81.7 | 147 to 186 |
| Deals, Sales own | 40.4 to 43.0 | 53.6 to 56.9 | 138 to 91 |
| Companies, first page | 64.2 to 61.3 | 91.3 to 78.5 | 173 to 182 |
| Contacts, first page | 39.9 to 44.5 | 51.0 to 57.9 | 128 to 126 |
| Contacts, search | 96.9 to 142.8 | 139.8 to 181.1 | 440 to 397 |

Rule used: apply a merge only where the merged shape is not slower on serial p50, serial p95 and 8-at-once p95. **No path passes**, so none was applied (companies is the closest: faster serial, 173 to 182 at 8 at once, which is within noise). The five `…WithCount` functions written for the experiment were removed again. The existing activities merge from the earlier step stays, as a deliberate trade for fewer connections under load, but it fails this rule serially by about 2.5 ms; reverting it is a one-line change in `listActivitiesPage` if you prefer the rule.

### Existing harness (34 scenarios, authorisation mocked)

All 34 scenarios return 200 on both trees, and **the transaction count per request is identical on every scenario**. The N+1 check passes on both. Timings differ in both directions (for example Companies directory 177 to 70 ms p50, Global search phone 342 to 598 ms) with no pattern tied to the changed code, because none of the harness scenarios call the changed paths except through shared code that did not change. Do not read these as improvements or regressions. The raw JSON files were not kept in the repository.

## Caveats

- **The machine was shared.** Other work (test runs, end-to-end runs) used the same Postgres container during these measurements. Round-to-round spread on one tree reaches 2x (for example Leads first page p50 36 to 71 ms on unchanged code). Conclusions are limited to differences much larger than that: the unbounded-query fixes, the assistant timeout and the auth statement count.
- The numbers are about 2 to 3 times slower than `docs/PERF_BASELINE.md` (26 Oct) for the same scenarios. Not comparable, which is why that file was not rewritten.
- Server time for the handler or service function only, no network, no Next.js transport.
- The auth measurement uses the 2 organisations' membership tables. It says how many statements and milliseconds one call costs, not how it behaves with thousands of members.
- 8-at-once figures use one Node process and one Prisma pool; they show pool pressure, not production concurrency.

## Reproduce

1. Seed once: `npx tsx scripts/perf-seed.ts` (about 12 minutes; it creates `figbloom_crm_perf` only).
2. Baseline: `git worktree add --detach ../figbloom-crm-m13-baseline 3fc0e04`, link `node_modules`, copy `.env` and `tests/perf/compare.perf.ts` into it.
3. In each tree: `CMP_PGUSER=<postgres user> CMP_LABEL=<name> CMP_OUT=<file>.json npx vitest run --config vitest.perf.config.ts tests/perf/compare.perf.ts` (run baseline and current alternately, three times).
4. The harness: `PERF_ASSERT=0 PERF_WRITE=1 PERF_RESULTS=<file>.json npx vitest run --config vitest.perf.config.ts tests/perf/api.perf.ts -t "meets the response-time targets|no N\+1"`.
5. Drop the database when done: `DROP DATABASE figbloom_crm_perf WITH (FORCE)`.
