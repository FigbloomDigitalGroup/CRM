# Observability (P1.02, FIG-1124)

Goal: we see problems before users report them. Everything here works with plain
PostgreSQL, Prometheus-format metrics and any log shipper; nothing is tied to one
hosting vendor, so it moves to AWS unchanged.

## What exists

| Signal | Where | Notes |
|---|---|---|
| Structured logs | `src/lib/logger.ts` (pino, JSON to stdout) | Secrets and masked values are redacted (`REDACTED_PATHS`): tokens, passwords, cookies, authorization, and deal value, margin, cost, payment amount (rule 7). |
| Request id | `src/middleware.ts`, `src/observability/instrument.ts` | Every request on the middleware's prefixes gets an `x-request-id` (the caller's if it is a safe 8 to 128 character token, otherwise a UUID). It is on the response, in the error envelope, on every log line written during the request (`requestId`), and stored on jobs the request queues. |
| Metrics | `GET /api/metrics`, `src/observability/metrics.ts` | Prometheus text. Off unless `METRICS_TOKEN` is set; send `Authorization: Bearer <token>` or `x-metrics-token`. |
| Health | `GET /api/health` (503 when the database is unreachable), Docker `HEALTHCHECK` | Also reports the last notifications sweep. |
| Error tracking | `@sentry/nextjs`, `src/lib/sentryScrub.ts`, `docs/DEPLOYMENT.md` | Every `logger.error` and `logger.fatal` also reports; PII is scrubbed. |
| Job queue | `figbloom_jobs_*` and `figbloom_job_lag_seconds` gauges; Management status API (`docs/JOBS.md`) | Counts per job type across organisations; no payloads. |

Wiring note: `handleRoute` (`src/app/api/_lib/handleRoute.ts`) wraps its work in
`instrumentRequest(...)` so the request id reaches the logger and the metrics are
recorded. The middleware does not cover `/api/cron`, `/api/health` and similar
non-tenant routes; those get a fresh id from `handleRoute` and are grouped as
`/api/other` in the metrics.

### Metrics reference

| Metric | Type | Labels |
|---|---|---|
| `figbloom_http_requests_total` | counter | `method`, `route` (ids replaced by `:id`, organisation by `:org`), `status` (`2xx`, `4xx`, `5xx`) |
| `figbloom_http_request_duration_seconds` | histogram | `method`, `route` |
| `figbloom_jobs_queued`, `figbloom_jobs_running`, `figbloom_jobs_dead` | gauge | `type` |
| `figbloom_job_lag_seconds` | gauge | `type`: age of the oldest queued job that is already due |

Counters are per process and reset on restart. With more than one instance,
scrape each instance and `sum by (...)` in queries. The job gauges come from the
database, so any instance reports the same values.

Set `METRICS_TOKEN` to a long random value in the host's secret store. Never put it in the repository.

## Alert rules

Prometheus-style expressions; any alert manager that accepts them works. Route
every page to the team channel and the on-call phone.

| Alert | Expression | For | Severity |
|---|---|---|---|
| Health down | uptime probe on `/api/health` fails (or `probe_success == 0`) | 2 probes (about 2 min) | Page |
| High error rate | `sum(rate(figbloom_http_requests_total{status="5xx"}[5m])) / sum(rate(figbloom_http_requests_total[5m])) > 0.02` | 3 min | Page |
| Slow requests (p95) | `histogram_quantile(0.95, sum by (le) (rate(figbloom_http_request_duration_seconds_bucket[5m]))) > 1` | 5 min | Warn; page above 3 |
| Job lag | `max(figbloom_job_lag_seconds) > 600` | 2 min | Warn; page above 1800 |
| Dead jobs | `sum(figbloom_jobs_dead) > 0` and increasing over 15 min | 0 | Warn |
| Metrics gone | `up{job="figbloom"} == 0` | 3 min | Warn |
| New error group in the error tracker | first seen in production | immediate | Notify channel |

The scrape interval is 30 s, so the slowest alert (3 to 5 min `for`) plus one
scrape fires inside the 5 minute target. Health down fires at about 2 minutes.

## Uptime checks

External probe every 60 s from at least two locations against `GET /api/health`
(expect 200 and `"status":"ok"`) and against `/login` (expect 200). Use any
uptime service; it needs only a public URL. Alert after two consecutive failures.

## Error-tracking triage rules

1. A new error group in production is looked at the same working day; a regression (resolved, then back) the same hour.
2. Severity: data loss, wrong permissions or tenant leakage is Urgent (open an issue, tell Given at once); a failing core flow (login, create lead or deal, payments) is High; everything else Medium or lower.
3. Find the request: the event carries the `requestId`; search the logs for it to see the whole request.
4. Every issue gets an owner and a Linear issue (FIG-xxxx) or is marked ignored with a reason. No group stays unowned for more than two days.
5. Noise (bot traffic, cancelled requests, browser extension errors) is ignored with a filter, not left open.
6. Never paste customer data or a masked value into the tracker or an issue; the scrubber removes known fields, but check.

## Dashboards

Build these in any Grafana-compatible tool (one dashboard, four rows):

| Panel | Query |
|---|---|
| Request rate | `sum(rate(figbloom_http_requests_total[5m]))` and by `route` (top 10) |
| Errors | `sum(rate(figbloom_http_requests_total{status="5xx"}[5m]))` and the 5xx ratio |
| p50, p95, p99 latency | `histogram_quantile(0.95, sum by (le) (rate(figbloom_http_request_duration_seconds_bucket[5m])))` (repeat for 0.5 and 0.99) |
| Job lag by type | `figbloom_job_lag_seconds` |
| Job queue depth and dead jobs | `figbloom_jobs_queued`, `figbloom_jobs_dead` |
| Health | the uptime probe result |

## Synthetic-failure alert drill

Target: an alert reaches the team within 5 minutes. Run it on staging (never
production) after the alert rules are loaded, and record the result below.

1. Confirm the scrape works: `curl -H "Authorization: Bearer $METRICS_TOKEN" https://<staging>/api/metrics` shows `figbloom_http_requests_total`.
2. Note the start time (T0).
3. Error-rate drill: send failing requests for 4 minutes, for example one every second to a route that returns 5xx. Simplest on staging: stop the database (`docker compose stop postgres` or the managed equivalent) for the duration; `/api/health` returns 503 and every data route returns 500.
4. Expected: the health-down alert at about T0 + 2 min, the error-rate alert at about T0 + 4 min.
5. Job-lag drill: stop the worker (`npm run jobs:worker`, or pause the cron call) for 15 minutes with the database up; `figbloom_job_lag_seconds` passes 600 and the job-lag alert fires.
6. Restore the database or worker. Expected: the alerts resolve within 5 minutes.
7. Record in the table: date, who ran it, T0, time of the first alert, channel it arrived on, pass or fail (pass means under 5 minutes).
8. Also check one error group appears in the error tracker with its `requestId`, and that a search of the logs for that id returns the request.

| Date | Run by | T0 | First alert at | Channel | Result |
|---|---|---|---|---|---|
| (not run yet) | | | | | |

### Staging drill, 4 Nov 2026 (FIG-1124, Claude Code for Given): metrics and alert rules, no alert route

**Status: the metrics and the rule expressions are proven on the local staging stack. The "alert within 5 minutes" criterion is NOT proven end to end, because no alert route exists yet (no error-tracker project, no uptime service, no Prometheus or alert manager, no paging).** The rows above stay empty until a human runs the full drill with a real channel.

Setup (nothing shared was touched): a second app container from `figbloom-crm:staging` on port 33001 with a fresh `METRICS_TOKEN` (kept only in the shell), and a third on port 33002 pointed at a scratch copy of the schema (`figbloom_scratch_1124_x` on the staging Postgres, dropped at the end). All three drill artefacts were removed afterwards. The staging app and the `figbloom_crm_staging` database were not changed.

| Check | Result |
|---|---|
| `GET /api/metrics` with no token header, with a wrong token | 401 and 401 |
| With the right token (`Authorization: Bearer` and `x-metrics-token`) | 200 and 200, `text/plain; version=0.0.4` |
| Series present | `figbloom_http_requests_total` (method, route with `:org`, status class), `figbloom_http_request_duration_seconds` (`_bucket` 0.025 to 10 and `+Inf`, `_sum`, `_count`), and the four job gauges as HELP/TYPE lines |
| Counters and histogram move | after 1 wrong-password login, 1 good login, 2 unauthenticated and 4 signed-in org calls: `requests_total` 4xx and 2xx series for login, leads, deals, companies, tasks; leads `_count` 1 to 2; the 0.1 s bucket filled; sum and count grew |
| Request id | `x-request-id` is on every middleware-covered response (login, org routes, 404 under an org); a caller-supplied `drill1124-trace-0001` was echoed back |
| Log correlation | 10 failing requests on the third container wrote 10 error lines with `requestId`; request `27c6ea58-...` (from the 500 envelope) is found by grep in `docker logs`, with its Prisma error |
| Secrets in logs | 0 hits in the container logs for the UAT password, the metrics token, `figbloom_session=`, `bearer `, or a `postgresql://` URL. Success paths log nothing at all (the app logs errors only), so masked values (deal value and so on) were not exercised by a log line; redaction is covered by tests, not by this drill |
| Job gauges | HELP/TYPE only, no samples: the queue was empty, so `sampleJobQueue` returns no rows and no series exist. `max(figbloom_job_lag_seconds)` is then empty, not 0. Lag and dead-job values were not measured |

Synthetic failure (T0 15:43:00 local): the container started against a copy of the database, then the database was dropped under it (a wrong `DATABASE_URL` host is not testable: the production boot guard refuses to start and the container exits with code 1, which is a different failure, a dead process). Ten one-second probes, then the metrics:

| Measure | Value |
|---|---|
| `/api/health` | 503 `{"status":"error"}` on 10 of 10 probes, 0.24 to 0.41 s each; the Docker health check fails the same way |
| Org data route | 500 `INTERNAL_ERROR` on 10 of 10, each with its `requestId` |
| `figbloom_http_requests_total` | `5xx` = 10 for leads, `4xx` = 3 (earlier, normal), login `2xx` = 1; total 14 |
| leads latency histogram | 13 samples: le 0.025 = 1, 0.05 = 7, 0.1 = 13 |

Rules evaluated by hand against those samples:

| Alert | Expression and threshold | Value | Would fire? |
|---|---|---|---|
| Health down | uptime probe on `/api/health`, `probe_success == 0`, 2 probes | 503 on every probe | Yes, after the 2nd failed probe (about 2 min at 60 s) |
| High error rate | `sum(rate(...{status="5xx"}[5m])) / sum(rate(...[5m])) > 0.02` for 3 min | 10 / 14 = 0.71 (about 36 times the threshold) | Yes once held for 3 min |
| Slow requests (p95) | `histogram_quantile(0.95, ...) > 1` for 5 min | about 0.095 s by bucket interpolation | No (correct: the failures are fast) |
| Job lag, dead jobs | `max(figbloom_job_lag_seconds) > 600`, `sum(figbloom_jobs_dead) > 0` | no series (empty queue; with the database gone the gauges are absent too, by design) | No, not measured |
| Metrics gone | `up{job="figbloom"} == 0` | the container answered the scrape | Not exercised (needs a scraper) |

Findings:

1. `GET /api/health` is outside the instrumentation, contrary to the "Wiring note" above. Its responses have no `x-request-id`, its error log lines (`src/app/api/health/route.ts` lines 39 and 44) carry no `requestId`, and it appears in no metric (there is no `/api/other` series after health and 404 calls). Consequence: a database outage is visible to the error-rate rule only through the data routes (it was, 71 percent), and the health-down alert depends entirely on the external uptime probe. Either wrap the health route in `handleRoute` or correct the wiring note.
2. Unknown URLs (404 under an org) return an `x-request-id` but are not counted in `figbloom_http_requests_total`. A 404 flood is therefore invisible to the metrics.
3. With a wrong database host the process refuses to boot in production mode and exits (code 1), so the uptime probe sees "connection refused", not 503. Both are covered by the health-down rule (a failed probe), but `up` and the Docker restart policy must be part of the alert design.
4. Sign-in from a different origin than `APP_BASE_URL` is rejected with 403 `CSRF_REJECTED` (expected); the drill sent `Origin: http://localhost:33000`.

Not proven, only a human can do it: the uptime service, an alert manager that loads these rules, routing to the team channel and the on-call phone, the Sentry project and DSN (so no error group with its `requestId` was seen in a tracker), the 5 minute timing, the job-lag drill with a stopped worker for 15 minutes, and recovery of the alerts.

## What a human still has to do

- Create the error-tracking project and set its DSN in the host secrets (`docs/DEPLOYMENT.md`).
- Choose and configure the uptime service and the metrics/alert stack, load the rules above, and set `METRICS_TOKEN`.
- Route alerts to the team channel and the on-call phone.
- Run the drill and fill in the table.
