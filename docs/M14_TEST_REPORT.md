# M14 test and consolidation report (MVP-14, FIG-1553)

Written 9 Nov 2026. Scope: one branch holds all the work, builds, and the suites pass, so Vercel deploys something known to be good. Facts only; anything not run is listed as not run.

## 1. Branches

| Item | Result |
|---|---|
| Deploy branch | `dev-given` (decision of Given, 9 Nov; `docs/DECISIONS.md` section 7) |
| M13 backend | Already in `dev-given` (merged earlier as #29; the M13 branch had no content missing) |
| `makeover/perf-navigation-and-queries` | Its uncommitted work (49 files) was carried onto `makeover/m14-vercel-mvp` and committed there |
| Conflicts with #31 (decision 12) | `dev-given` had a squash (#31) of commits this branch already had. The two trees were identical before M14 work (same tree hash), so `origin/dev-given` was merged with `-s ours`. Tree hash before and after the merge: identical. Nothing lost, nothing changed |
| Pull requests | #32 (M14 work), #33 (follow-up fixes), both merged into `dev-given` (`6a2025f`, `ade4f9b`) |
| Migrations | All 81 applied and `migrate status` clean on the local dev and test databases, and on the hosted production and preview databases |

## 2. Commands

| Command | Result |
|---|---|
| `npm run typecheck` | Clean (after the three parallel work packages were combined, and again after each later change) |
| `npm run lint` | Clean |
| `npm run build` | Passes |
| `npm run check:build-output` | "Production build is clean: none of 4 dev-only markers found" |
| Full `npx vitest run` (local, 58 min) | 257 of 258 files passed; **3195 of 3196 tests passed** |

### The one failing test

`tests/migrations.test.ts` "have all been applied, in order, with nothing pending" took 22.6 s inside the full run and failed. Run alone it passes (2 of 2, 29 s). It shells out to `npx prisma migrate status` and times out under the load of the full run. It was not skipped, loosened or changed. A longer timeout for the two tests in that file would be a reasonable follow-up; not done here because the rule is not to change a failing test to get green.

### Known causes found and fixed

- `tests/permissionsV2.test.ts` "role catalogue sync" timed out at 20 s. Cause: the local test database held **6,680 leftover test organisations** (it writes an audit entry in every organisation). The test database was dropped and recreated; the test now passes (about 45 s for the four files run together).
- `tests/apiWalk.test.ts` did not finish in 9 minutes when another run was using the same database. In the full run, on its own database, it finished. Rule: one run per test database. A second checkout must use its own database.

## 3. GitHub CI

| Pull request | Result |
|---|---|
| #32 | 15 of 16 checks passed. Failure: `e2e/commercial.spec.ts:167` (the new `/sign/[token]` page answered 200, the spec expects 404) |
| #33 | Fix: the page is a real 404 with the same plain message (`not-found.tsx`). No test changed. All **19 of 19** checks passed, including lint, typecheck, migrations, production build, Docker image, the six unit shards and the four e2e shards |

Note: `dev-given` has no required status checks, so #32 merged before its CI finished. CI is on `pull_request` only (and `push` to `main`); nothing runs on a push to `dev-given`.

## 4. Not run

- The complete Playwright suite locally (only `e2e/commercial.spec.ts` "without demo screens enabled", against a fresh production build, passed locally). The four e2e shards ran in CI on #33 and passed. Whether the frozen-auth pixel spec is in those shards was not checked individually.
- The performance run (`vitest.perf.config.ts`).

## 5. Isolation on the hosted database (MVP-05)

The production and preview databases are Neon (plain PostgreSQL 18.6, Frankfurt). The preview database is empty and disposable, so the isolation tests were run against it (never against production data), with the application role connecting through the **pooled** URL with the production flags (`sslmode=require&pgbouncer=true`). The same role passwords as Vercel Preview were used, so nothing was reset. The runs were made from a PC in Kenya, so every query crosses the internet to Frankfurt; the test setup that builds two full test organisations is slow there.

Checked by hand on both databases (production and preview): `figbloom_app` is not a superuser and has no RLS bypass; with no organisation set it sees 0 leads; 117 public tables have row-level security enabled; it cannot read `platform_identities`; `figbloom_platform` is not a superuser and has no RLS bypass.

| File | Result on the hosted database |
|---|---|
| `tests/tenant-isolation.test.ts` | Passed |
| `tests/appRoleGuard.test.ts` | Passed |
| `tests/platformIdentityFoundation.test.ts` | Passed (45 tests; the first run timed out at 20 s on three tests because of the network distance, the rerun with longer limits passed) |
| `tests/tenantAttack.test.ts` | 6 of 8 passed. **Not conclusive**, see below |

### `tests/tenantAttack.test.ts` on the hosted database

The file's setup step has a hard-coded 120 s limit, too short from Kenya. The repository test was **not** changed. A temporary copy that differs only in that one number (`120000` to `1500000`) was run and then deleted. Two tests did not pass:

1. "the attacker walk: every route, A's callers, B's ids": timed out at the 15 minute test limit. It calls every route over the internet and needs longer. No assertion in it failed.
2. "keeps a background job inside the organisation it was queued for ...": an assertion failed: organisation A's `notification_preferences` went from 0 to 2 rows during the test. Hypothesis: the timed-out walk (1) kept running in the background (a timed-out test is not cancelled) and, acting as A's two callers, created default notification-preference rows in A, which is their own organisation. This test was therefore re-run alone (see below).

**Result of the re-run of (2) alone** (temporary copy, `-t "keeps a background job inside the organisation"`, nothing else running): **passed** (557 s, almost all of it building the two test organisations over the internet). So the earlier failure was the side effect of the timed-out walk, not a leak.

Summary for `tenantAttack.test.ts` on the hosted database: **7 of 8 tests passed** (6 in the first run, plus the re-run of the seventh). **The eighth, the full route walk (every route, A's callers, B's ids), has not completed on the hosted database**: it needs more than 15 minutes from Kenya. It passed in the local full suite on Postgres 16. To close it: run it from a machine close to Frankfurt (for example a CI runner in Europe with the preview database as a secret) or with a much longer limit (an hour). Until then the isolation claim for the hosted database rests on: the passing `tenant-isolation` (policy on every tenant table, app role refused) and `platformIdentityFoundation` files, the 7 passing attack tests, and the manual checks above.

On Postgres 16 (local Docker) the whole `tenantAttack.test.ts` passed in the full suite (3195 of 3196).
