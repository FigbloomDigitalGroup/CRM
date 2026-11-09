# V1.1 performance review (G2.03, FIG-1158)

Measured on 9 Nov 2026 with `tests/perf/v11.perf.ts` against the scale database of G1.04 (an organisation with 40,000 leads and 12,000 deals), at release V1.1 with 60 catalogue items,
400 quotes, 100 approval requests, 20 saved views, 12 chat channels with 6,000 messages and 3 sequences. Every scenario calls the real route handler as a real role, once to warm,
then 40 times in a row (p50 and p95) and 8 at a time five times (c8). Times are server time for the handler, in milliseconds, without the network. The assistant is timed up to the
model call with a stub model, because the model's own time is not ours to budget. Run: `PERF_ORG_SLUG=<slug> npx vitest run --config vitest.perf.config.ts --project node tests/perf/v11.perf.ts`.

## How far to trust these numbers

**Not far.** This development machine also runs Docker containers (staging, observability, other projects), VS Code and the browser, and the same code measured very differently from
run to run: the management forecast p95 was 336 ms in one run and 844 ms in the next, chat message listing 47 ms and 410 ms. The run below was started with nothing else of mine
running and is still noisy. It shows what is slow in relative terms and that nothing is pathological (no endpoint above about 1 s sequentially, database calls per request stay at 1 to 5),
but it does **not** prove the targets are met or missed. A repeat on a quiet machine (the staging stack is the right place) is needed before this gate can say "targets met".

## Result (last run)

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
