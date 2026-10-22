# Test baseline (FIG-1010 / B0.02)

The numbers every later gate ("tests pass") is measured against. Recorded
on 22 Oct 2026 on `main` at `af11835` plus the B0.02 changes, Node 26.5,
Postgres 16 in Docker.

## How to run it

One command, from a clean checkout with `.env` copied from `.env.example`:

```bash
npm run test:local     # docker compose up -d --wait, then the full suite
npm run test:coverage  # same suite with the coverage floors enforced (what CI runs)
```

If Postgres is already running, `npm test` is enough. The suite starts with a
reachability check in `tests/globalSetup.ts`: when the database cannot be
reached the run fails immediately with the host, port and how to fix it. It
never skips database tests. `tests/databaseSmoke.test.ts` then checks the
rest of the foundation on every run (see "What the smoke test guards").

## Baseline numbers

| Measure | Value |
|---|---|
| Test files | 64 (54 integration, 10 component) |
| Tests | 698, all passing (as of FIG-801/802; 661 at FIG-1016, 521 at the original baseline) |
| Duration | 150 to 200 s (the last two runs: 189 s with coverage, 175 s without) |
| Failing / skipped | 0 / 0 |
| Lint, typecheck | clean |
| e2e (Playwright) | 20 tests, all passing (run separately, `npm run e2e`) |

Coverage (`npm run test:coverage`, Vitest v8):

| Metric | Value | CI floor (`vitest.config.ts`) |
|---|---|---|
| Lines and statements | 42.37 % (41.83 % at FIG-1016, 35.98 % at the original baseline) | 42 % |
| Branches | 81.28 % | 80 % |
| Functions | 69.76 % | 69 % |

By area (lines):

| Area | Covered | Note |
|---|---|---|
| `src/auth` | 96.0 % | |
| `src/db` | 93.1 % | |
| `src/repositories` | 92.5 % | |
| `src/services` | 88.2 % | |
| `src/lib` | 78.3 % | |
| `src/notifications` | 16.4 % | email/SMS transports |
| `src/app` | 9.9 % | routes and pages; 167 files at 0 % |
| `src/components` | 0 % | |

## Known gaps

- **UI is mostly untested at unit level.** `src/app` holds about 15,800 of
  the 24,000 measured lines and is at 9.9 %. Route handlers and pages are
  exercised only through the 20 Playwright tests, and v8 coverage cannot see
  code run by the separate server process. The 42 % floor is therefore held
  up by the service and repository layers; adding untested UI lowers it.
  This is the main risk to the floor during the makeover: new screens need
  component tests (see `tests/components/GlobalSearch.test.tsx` and
  `TaskTable.test.tsx` for the pattern) or the floor will fail in CI.
- No test yet for the frozen auth pages' visual regression guard (CLAUDE.md
  rule 1); it belongs to B0.04.
- e2e covers login, the lead lifecycle and website lead capture only.

## Flaky tests found and fixed

| Test | Cause | Fix |
|---|---|---|
| `authService password reset > returns the same generic message whether or not the email exists` (failed in 2 of 3 baseline runs) and the matching unknown-email login test | Both used the fixed address `nobody@example.test`. The durable auth rate limiter (FIG-784) stores attempts in the test database for an hour, so repeated runs pushed that address over its limit and the test got `RateLimitedError`. | A unique address per call (`tests/authService.test.ts`). No assertion changed. |

After the fix: two further full runs passed with no failures (521 of 521).

Nothing is quarantined, so no follow-up issues are needed.

## What the smoke test guards (`tests/databaseSmoke.test.ts`)

The database is reachable as the admin role and is the isolated test
database; it is reachable as `figbloom_app`; `figbloom_app` is neither
superuser nor `BYPASSRLS`; every migration is applied; every table with an
`organization_id` column (26 today) has row-level security both enabled and
forced; the role and permission catalog is seeded. The last check also fails
if a future tenant table is added without RLS.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`: a Postgres 16 service container, create the test database, lint,
typecheck, migrate, provision the `figbloom_app` role, `npm run test:coverage`
(the full suite with floors), seed, build, Playwright e2e, and a separate
job that builds the Docker image. Both jobs are green on `main` at `af11835`.

**Open item for Given:** the "Protect default branch" ruleset on GitHub
requires a pull request but has **no required status checks**, so a red CI
does not currently block a merge. To make it block, add the two checks
`Lint, typecheck, migrate, test, e2e` and `Docker image builds and runs` as
required status checks in that ruleset (Settings, Rules, Rulesets). This
needs repository admin and was not changed here.

## Local notes

- On Windows machines where port 55432 falls in the dynamic exclusion range,
  use the git-ignored `docker-compose.override.yml` (host port 25432) and
  match `.env`; the committed compose file, `.env.example` and CI keep 55432.
- Running the e2e suite repeatedly against a persistent dev database trips
  the login rate limiter (FIG-784) on that machine; CI starts fresh and is
  unaffected. Raise `LOGIN_RATE_LIMIT_MAX_PER_IP` and
  `LOGIN_RATE_LIMIT_MAX_PER_EMAIL` for local runs if needed.
