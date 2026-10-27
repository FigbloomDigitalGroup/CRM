# Backend V1 test report (G1.01, FIG-1068)

Run on 26 Oct 2026 on the working tree at the end of M5 (not yet committed), against the local Docker Postgres test database.

## Result

| | |
|---|---|
| Test files | 130 passed, 0 failed |
| Tests | 1,679 passed, 0 failed, 0 skipped |
| Typecheck (`npm run typecheck`) | clean |
| Lint (`npm run lint`) | clean (0 errors, 0 warnings) |
| Duration | about 23 minutes (the route-walking tests are most of it) |
| Coverage (`npm run test:coverage`, same run) | lines 74.2%, statements 74.2%, branches 89.7%, functions 92.4%. Floors in `vitest.config.ts` are 42 / 42 / 80 / 69 and are met. |

Not included: the performance run (`npx vitest run --config vitest.perf.config.ts`, see `docs/PERF_BASELINE.md`; it needs the scale database) and the Playwright end-to-end suite (`npm run e2e`, needs a running app and browser; not run in M5, which changed no UI).

## What the M5 gate added

| Suite | What it proves |
|---|---|
| `apiWalk.test.ts` | Every route called as every role against the recorded permission matrix; sentinel scan for masked values; explained 403s; signed-out 401; no 5xx. |
| `tenantAttack.test.ts` | RLS on every tenant table; A sees none of B's rows; every route as A with B's ids; signed links, public keys, jobs. |
| `apiContract.test.ts` | The frozen OpenAPI file equals what the code produces and is named in the changelog; mock server answers every operation as every role; no masked value in any recorded example. |
| `securityHeaders`, `publicRateLimits`, `csvInjection`, `secretHandling`, `massAssignment` | The G1.05 fixes and checks. |
| `organizationDefaultsBackfill.test.ts` | The upgrade backfill keeps an organisation's edits. |

## Defects found by running the gate

Fixed: a file-access gap (attachments readable by file id without access to the record) and five server errors (500) that are now validation errors. Details in `docs/SECURITY_REVIEW_V1.md`. Also found and documented, not changed: the deal-rules migration's lock time (`docs/MIGRATION_REHEARSAL.md`).

During this report's own run, the first full pass had five failures: one my file-access fix being too strict (it also blocked unattached files; narrowed so it only applies to files attached to a record, the existing file tests unchanged), and four tests I had written wrongly (a status code, the mock-example check, a count of OpenAPI operations that no longer applied once derived operations were added, and a duplicate account operation). No existing test was skipped, deleted or loosened to get green; the OpenAPI test now checks that every explicit operation is present and ids are unique, instead of an exact total.

## Flaky-test sweep: not completed as specified

The issue asks for ten consecutive green runs. One full run takes about 23 minutes, so ten is about four hours of machine time; the final code has had one clean full pass (the coverage run above) after the first pass's five failures were fixed, and the two longest suites (walk and tenant attack) passed twice more. That is evidence of stability, not the sweep that was asked for. To finish it: `for i in $(seq 10); do npm test || break; done` overnight, or in CI.

The noisy `ERROR` lines in the output (route errors, failed job attempts, failed deliveries) are logged by tests that exercise failure paths on purpose; every such test passes.
