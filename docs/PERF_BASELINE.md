# Performance baseline (G1.04, FIG-1071)

Measured on 26 Oct 2026 against the scale database (`npx tsx scripts/perf-seed.ts`, its own database `figbloom_crm_perf`, never dev or test). Organisation **perf-alpha** holds 40,000 leads, 16,000 contacts, 6,400 companies, 12,000 deals, 162,000 activities, 24,000 tasks, 24,000 communications, 32,000 notifications, 3,200 invoices; a second organisation (perf-beta) holds the other fifth, so every query also proves it stays inside its own organisation.

## How it is measured

- `npx vitest run --config vitest.perf.config.ts` (not part of `npm test`; it needs the scale database). `PERF_WRITE=1` also writes the raw results. The run fails when any target is missed (`PERF_ASSERT=0` to only print).
- Each scenario calls the **real route handler** as a real role (authorisation, validation, masking and data access are all in the time), once to warm, then 40 times one after another (p50, p95) and 8 at a time, five rounds (concurrent p95).
- These are server times for the handler on a laptop with the database in Docker. They leave out the network and Next.js transport, so a client adds its round trip. They are a baseline to compare later runs with, not a production promise.

## Targets and results

Targets (G1.04): lists and search p95 under 300 ms, dashboards under 500 ms, Customer 360 under 600 ms, other endpoints under 500 ms. All times in milliseconds; "DB calls" is the number of database transactions one request opens (it must not grow with the page size).

| Scenario | Role | Target p95 | p50 | p95 | 8 at once p95 | DB calls | Response KB |
|---|---|---|---|---|---|---|---|
| Leads, first page (Management) | MANAGEMENT | 300 | 35 | 57 | 137 | 2 | 71 |
| Leads, first page (Sales: own leads) | SALES | 300 | 28 | 36 | 83 | 2 | 71 |
| Leads, filtered by status, newest first | MANAGEMENT | 300 | 33 | 45 | 102 | 2 | 71 |
| Leads, deep page (page 1,200) | MANAGEMENT | 300 | 68 | 91 | 209 | 2 | 71 |
| Leads, search box text | MANAGEMENT | 300 | 92 | 130 | 227 | 2 | 3 |
| Contacts, first page | MANAGEMENT | 300 | 31 | 42 | 100 | 2 | 37 |
| Contacts, search | MANAGEMENT | 300 | 49 | 72 | 128 | 2 | 16 |
| Companies, first page | MANAGEMENT | 300 | 35 | 48 | 84 | 2 | 28 |
| Companies, directory | MANAGEMENT | 300 | 38 | 50 | 133 | 5 | 28 |
| Deals, first page (Management) | MANAGEMENT | 300 | 40 | 57 | 131 | 2 | 75 |
| Deals, board | MANAGEMENT | 300 | 91 | 114 | 186 | 7 | 1 |
| Deals, first page (Sales: own deals) | SALES | 300 | 31 | 41 | 108 | 2 | 75 |
| Tasks, grouped by due date (Sales) | SALES | 300 | 146 | 173 | 690 | 46 | 31 |
| Notifications (Sales) | SALES | 300 | 59 | 74 | 130 | 4 | 0 |
| Conversations hub | MANAGEMENT | 300 | 164 | 210 | 1015 | 14 | 14 |
| Invoices (Finance) | FINANCE | 300 | 30 | 38 | 91 | 2 | 15 |
| Global search: a company name | MANAGEMENT | 300 | 192 | 236 | 1011 | 15 | 7 |
| Global search: an email | MANAGEMENT | 300 | 223 | 282 | 1078 | 15 | 1 |
| Global search: a phone number | SALES | 300 | 168 | 219 | 791 | 16 | 1 |
| Global search: a short word (Sales) | SALES | 300 | 167 | 204 | 849 | 15 | 2 |
| Dashboard (Management) | MANAGEMENT | 500 | 63 | 76 | 330 | 20 | 12 |
| Dashboard section: management | MANAGEMENT | 500 | 40 | 50 | 225 | 15 | 11 |
| Dashboard section: sales today (Sales) | SALES | 500 | 50 | 67 | 257 | 7 | 1 |
| Dashboard section: finance (Finance) | FINANCE | 500 | 33 | 56 | 90 | 3 | 0 |
| My metrics (Sales) | SALES | 500 | 51 | 70 | 87 | 1 | 3 |
| Customer 360: the busiest customer | MANAGEMENT | 600 | 101 | 120 | 623 | 23 | 9 |
| Report: pipeline by stage | MANAGEMENT | 500 | 14 | 28 | 36 | 2 | 1 |
| Report: lead sources | MANAGEMENT | 500 | 16 | 20 | 46 | 2 | 2 |
| Report: conversion by source | MANAGEMENT | 500 | 16 | 22 | 61 | 2 | 2 |
| Report: per person | MANAGEMENT | 500 | 19 | 28 | 52 | 4 | 2 |
| Report: month against last month | MANAGEMENT | 500 | 19 | 27 | 66 | 4 | 2 |
| Report: customers | MANAGEMENT | 500 | 118 | 148 | 324 | 3 | 1 |
| Calendar: a week | SALES | 500 | 92 | 131 | 462 | 2 | 73 |
| Payments summary (Finance) | FINANCE | 500 | 7 | 16 | 40 | 2 | 0 |

Every scenario meets its target one at a time. **Under eight simultaneous callers** several scenarios (global search, tasks grouped by due date, conversations hub, Customer 360) take 0.7 to 1.1 seconds at p95, because one Node process and a small connection pool serve them one after another. That is a capacity figure to plan with (production runs more than one process), not a per-request cost.

## No N+1

For each list (leads, contacts, companies, deals, tasks, invoices) a page of 5 and a page of 100 open the same number of database transactions (2 each): the number of queries does not depend on the number of rows. The test fails if that ever changes.

## Streaming

- **Export:** 40,001 leads, 10.1 MB of CSV, streamed in 29 s; the process heap grew by at most 41 MB while it ran (limit 120 MB). It does not grow with the row count.
- **Import:** a 150,000-row file is read row by row in 3.3 s with at most 46 MB of heap growth (limit 60 MB). This measures the file reader (the part whose memory could grow with the file); the database writes are measured by the migration rehearsal (docs/MIGRATION_REHEARSAL.md).

## What changed to get here

The first run missed the search targets: global search p95 was 434 to 629 ms and the leads search box 269 ms. Two causes, both fixed:

1. **A relation filter inside an OR is written by Prisma as LEFT JOINs that no index can serve.** A lead search matched on the lead's notes, its company name and its contact's name and email; that scanned and joined every lead (about 195 ms). The list now looks up the matching companies and contacts first (each by its own trigram index) and filters by id, which gives the same result in about 70 ms. If a term matches more than 500 companies or contacts it falls back to the original filter, so the answer and its count stay exact (`src/repositories/searchMatch.ts`, used by leads, contacts and deals).
2. **One unindexed column in an OR forces a sequential scan.** Search v2 had trigram indexes on names, emails and task titles only. Migration `20261028100000_search_trgm_coverage` adds them for company and contact phone, lead and deal notes and task description.

## Known limits

- A very broad term (more than 500 matching companies or contacts) takes the slower, exact path; its page and total are still correct.
- The conversations hub, tasks grouped by due date and Customer 360 are the heaviest endpoints (14 to 46 transactions per request, about 90 to 200 ms). They are inside target; if the data grows five times, they are the first to look at.
- Numbers depend on the machine. CI runs the correctness suite, not this one.
