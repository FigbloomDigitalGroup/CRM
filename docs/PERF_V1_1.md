# V1.1 performance review (G2.03, FIG-1158)

Measured on 9 Nov 2026 with `tests/perf/v11.perf.ts` against the scale database of G1.04 (an organisation with 40,000 leads and 12,000 deals), at release V1.1 with 60 catalogue items,
400 quotes, 100 approval requests, 20 saved views, 12 chat channels with 6,000 messages and 3 sequences. Every scenario calls the real route handler as a real role, once to warm,
then 40 times in a row (p50 and p95) and 8 at a time five times (c8). Times are server time for the handler, in milliseconds, without the network. The assistant is timed up to the
model call with a stub model, because the model's own time is not ours to budget. Run: `PERF_ORG_SLUG=<slug> npx vitest run --config vitest.perf.config.ts --project node tests/perf/v11.perf.ts`.

## Re-measured 12 Nov 2026 (FIG-1567): every target is met

Three consecutive runs of the same suite (`tests/perf/v11.perf.ts`, organisation perf-alpha: 40,000 leads and 12,000 deals, the scale database freshly seeded with `scripts/perf-seed.ts`) on a machine doing nothing else of mine. **Where:** the same Postgres container on this computer, not the Vercel or Neon deployment and not the staging Docker stack's database. Numbers are server time for the handler, without the network. Times in ms, three runs shown as run 1 / run 2 / run 3.

| Scenario | p50 | p95 | c8 p95 | DB calls | Target p95 | |
|---|---:|---:|---:|---:|---:|---|
| Quotes list, first page (Management) | 29 / 25 / 29 | 40 / 33 / 37 | 258 / 155 / 145 | 1 | 300 | ok |
| Quotes list, first page (Sales) | 151 / 154 / 154 | 174 / 182 / 170 | 209 / 228 / 221 | 1 | 300 | ok |
| Quotes list, deep page | 30 / 26 / 28 | 39 / 33 / 33 | 85 / 71 / 58 | 1 | 300 | ok |
| Quote detail with its versions | 34 / 35 / 39 | 39 / 48 / 48 | 147 / 125 / 108 | 2 | 500 | ok |
| Quote version with lines | 49 / 49 / 48 | 61 / 70 / 69 | 85 / 97 / 105 | 3 | 500 | ok |
| Approvals inbox (Management) | 22 / 25 / 23 | 36 / 33 / 38 | 178 / 230 / 180 | 2 | 300 | ok |
| Approvals inbox (Sales: own) | 15 / 18 / 15 | 21 / 22 / 21 | 46 / 74 / 52 | 2 | 300 | ok |
| Catalogue | 19 / 19 / 16 | 35 / 25 / 22 | 43 / 48 / 46 | 1 | 300 | ok |
| Forecast (Management) | 185 / 177 / 184 | 213 / 217 / 222 | 609 / 601 / 635 | 5 | 500 | ok |
| Forecast (Sales: own) | 44 / 44 / 50 | 54 / 56 / 63 | 131 / 128 / 121 | 5 | 500 | ok |
| Forecast targets | 16 / 14 / 14 | 28 / 20 / 16 | 39 / 30 / 22 | 1 | 500 | ok |
| Pipelines | 15 / 19 / 16 | 24 / 27 / 26 | 41 / 43 / 47 | 1 | 300 | ok |
| Saved views (Sales) | 17 / 18 / 14 | 24 / 32 / 21 | 58 / 79 / 52 | 3 | 300 | ok |
| Sequences | 18 / 21 / 18 | 24 / 36 / 27 | 67 / 88 / 56 | 1 | 300 | ok |
| Chat: channel list | 24 / 25 / 25 | 29 / 32 / 30 | 55 / 102 / 106 | 1 | 300 | ok |
| Chat: latest messages | 31 / 29 / 33 | 37 / 39 / 41 | 91 / 72 / 75 | 1 | 300 | ok |
| Chat: sync (the poll) | 35 / 35 / 36 | 47 / 43 / 50 | 69 / 65 / 71 | 2 | 300 | ok |
| Chat: unread totals | 12 / 12 / 10 | 15 / 16 / 15 | 22 / 37 / 43 | 1 | 300 | ok |
| Assistant: context, general question | 165 / 184 / 169 | 197 / 219 / 220 | 583 / 449 / 633 | 4 | 500 | ok |
| Assistant: context for a deal (Sales) | 120 / 128 / 124 | 151 / 147 / 143 | 340 / 408 / 311 | 4 | 500 | ok |

**Reading:** the 9 Nov misses (quotes list, quote version, forecast, chat messages) were machine noise. Every sequential p95 is under its target in all three runs (the largest is the Management forecast at about 220 ms against 500), and database calls per request are unchanged (no N+1). **No code was changed and none of the fixes below was applied**, because nothing misses a target. The 8-at-once column is not a target; the Management forecast (about 600 ms) and the assistant context (about 450 to 630 ms) are the two to watch with many users. The fixes below stay on the list for that day. **Not measured here:** the hosted Vercel and Neon deployment (network and cold starts); measure it once real use starts.

## How far to trust the 9 Nov numbers (history)

**Not far.** This development machine also runs Docker containers (staging, observability, other projects), VS Code and the browser, and the same code measured very differently from
run to run: the management forecast p95 was 336 ms in one run and 844 ms in the next, chat message listing 47 ms and 410 ms. The run below was started with nothing else of mine
running and is still noisy. It shows what is slow in relative terms and that nothing is pathological (no endpoint above about 1 s sequentially, database calls per request stay at 1 to 5),
but it does **not** prove the targets are met or missed. A repeat on a quiet machine (the staging stack is the right place) is needed before this gate can say "targets met".

## Result of the 9 Nov run (noisy machine; superseded by the 12 Nov table above)

| Scenario | p50 | p95 | c8 p95 | DB calls | Target p95 | |
|---|---:|---:|---:|---:|---:|---|
| Quotes list, first page (Management) | 132 | 315 | 502 | 1 | 300 | **over** |
| Quotes list, first page (Sales) | 295 | 530 | 877 | 1 | 300 | **over** |
| Quotes list, deep page | 107 | 197 | 379 | 1 | 300 | ok |
| Quote detail with its versions | 155 | 261 | 721 | 2 | 500 | ok |
| Quote version with lines | 276 | 629 | 823 | 3 | 500 | **over** |
| Approvals inbox (Management) | 128 | 214 | 915 | 2 | 300 | ok |
| Approvals inbox (Sales: own requests) | 88 | 203 | 343 | 2 | 300 | ok |
| Catalogue | 75 | 158 | 183 | 1 | 300 | ok |
| Forecast (Management) | 535 | 844 | 3675 | 5 | 500 | **over** |
| Forecast (Sales: own) | 141 | 371 | 303 | 5 | 500 | ok |
| Forecast targets | 77 | 365 | 80 | 1 | 500 | ok |
| Pipelines | 95 | 292 | 210 | 1 | 300 | ok |
| Saved views (Sales) | 99 | 183 | 205 | 3 | 300 | ok |
| Sequences | 53 | 127 | 156 | 1 | 300 | ok |
| Chat: channel list | 99 | 216 | 262 | 1 | 300 | ok |
| Chat: latest messages in a channel | 153 | 410 | 149 | 1 | 300 | **over** |
| Chat: sync (the poll) | 56 | 86 | 118 | 2 | 300 | ok |
| Chat: unread totals | 15 | 33 | 45 | 1 | 300 | ok |
| Assistant: context for a general question | 309 | 469 | 1398 | 4 | 500 | ok |
| Assistant: context for a deal (Sales) | 171 | 226 | 803 | 4 | 500 | ok |

The no-N+1 check passes: the number of database calls for a page of 5 equals a page of 100 for quotes, approvals and the catalogue. The index check passes when sequential scans are
switched off (an index exists that each hot query can use); on tables of a few hundred rows the planner rightly reads them whole.

## What is probably slow, and the fixes (from a read of the code; not yet measured one by one)

These keep behaviour identical (permissions and masking unchanged). They are **not** applied in this PR: they change hot paths and money arithmetic, and the noisy machine cannot show a
before and after. Recommended as a follow-up issue, to be measured on the staging stack.

1. **Management forecast** (`src/services/forecastService.ts`, `src/repositories/forecast.ts`): it loads every open deal (about 12,000 rows) and totals them in JavaScript, with five separate
   database round trips per request, which is why 8 at once is much worse than one. Total in SQL grouped by stage, owner and close date (keep the per-deal rounding of `weightedCents`), and read
   the five inputs in one organisation-scoped transaction. Index: `deals (organization_id, owner_membership_id) INCLUDE (pipeline_stage_id, value, expected_close_date) WHERE outcome = 'OPEN' AND archived_at IS NULL`.
2. **Assistant context** (`src/services/assistantService.ts`, `src/assistant/context.ts`): the leads, deals, tasks and assignee reads run one after another, each in its own transaction, and the
   deal read sorts by stage sequence then creation date with no supporting index and loads whole related rows. Run the independent reads together, select only the fields the context uses (keep calling
   `maskValue`), and index `leads (organization_id, created_at DESC, id) WHERE converted_at IS NULL AND archived_at IS NULL` and `deals (organization_id, outcome, created_at DESC)`. Changing which 25 deals
   the model sees (for example by last activity) is a product decision, not a performance fix.
3. **Chat**: unread totals count the whole unread backlog on every poll (`unreadCounts` in `src/services/chatService.ts`); keep an unread count on the read marker, or count only channels where the last
   sequence is past the last read. `presentMessages` runs per channel group in a sync; batch it once. Index `chat_messages (organization_id, channel_id, updated_at)` for the changed-messages query.
4. **Quote lists and version detail** are a little over target in the noisy run; nothing structural found (one database call for the list, three for a version). Re-measure first.

## Conclusion for the gate

No pathological path and no N+1. The targets are **not demonstrated** on this machine for the forecast, the assistant context and chat. Decision for Given: accept the V1.1 contract freeze now and
take the three fixes above as a follow-up measured on staging, or hold the gate for them.
