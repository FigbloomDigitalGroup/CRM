# V1 quality gate: sign-off checklist (Q1.08, FIG-1122, G1.08 for the frontend)

Formal go or no-go for production readiness (M12). This page is the checklist, with the **real state of each line on 31 Oct 2026**. **The gate is not passed.** Several lines need people (UAT, manual accessibility and device passes, Management's approval) and three defects are open. Nothing here is signed.

## Checklist

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Q1.01 to Q1.07 done; every V1 checklist ID traced to a passing test | **Partly.** All 54 V1 IDs are traced to journey files that exist (`tests/e2eTraceability.test.ts`, passing). Role journeys pass for six roles on every V1 screen. The seven-role matrix in the issue is six desktop roles plus the phone persona (`mobile-*.spec.ts`). Flake rate over 20 consecutive runs: **not measured**. CI time under 15 minutes sharded: **not measured** (CI changes are in this pass but CI has not run them) | `e2e/qa/trace.ts`, `e2e/qa/role-journeys.spec.ts` |
| 2 | No open Blocker or Major defects | **No.** Three Majors are open: D-01 (React #418 in the production build), D-02 (Customer Support has no home), D-05 (phone Tasks LCP) | `docs/QA_DEFECTS.md` |
| 3 | Accessibility budget met | **Automated: yes.** Zero serious or critical axe violations on every V1 desktop screen and on the core screens in all nine looks. **Manual keyboard and screen-reader pass: not run** | `docs/A11Y_CHECKLIST.md` |
| 4 | Performance budget met | **Mostly.** Script weight inside budget on all 71 routes; tap and scroll inside budget; LCP inside budget on three of four phone screens (Tasks over). **The 50k-lead run and real-device timings were not done** | `docs/FRONTEND_PERFORMANCE.md` |
| 5 | Visual baselines approved by design; frozen pages pixel-identical | **Partly.** Windows baselines are recorded but **design has not approved them**, and the Linux baselines CI needs are not recorded, so the visual suite skips on Linux until they are. The frozen pages are held by the existing zero-pixel suite and by the new source comparison with `pre-makeover` (passing); a rendered comparison against a build of the `pre-makeover` tag was not made | `e2e/qa/visual.spec.ts`, `tests/frozenAuthSource.test.ts`, `e2e/frozen-auth.spec.ts` |
| 6 | Cross-browser matrix | **Automated: yes** (Chrome, Firefox, Safari, Android Chrome, iOS Safari profiles; one intermittent Safari failure, D-04). **Real-device pass: not run** | `docs/BROWSER_MATRIX.md` |
| 7 | UAT sign-off from Management | **No.** Scripts written; no session held (needs staging, FIG-1123) | `docs/UAT_V1.md` |
| 8 | Success metrics from FIG-444 baselined and agreed | **No.** Not started; FIG-444 is a product document and not part of this pass | |
| 9 | Michael and Given approval recorded | **No** | |
| 10 | Vitest toolchain upgraded (FIG-1259) | **Yes, with one note.** Vitest 5.0.5; full suite on Vitest 5: 2,452 of 2,454 passed, the two failures were stale assertions, fixed; the final full run is below. `npm audit`: the seven Vitest advisories are gone but 22 others (newer `minimatch` advisory via eslint and Sentry, no fix available) remain, so "0 vulnerabilities" is not met | `IMPLEMENTATION_NOTES.md` Stage 11, D-07 |

## Verification run for this pass

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Role journeys (`e2e/qa/role-journeys.spec.ts`) | 11 passed (the hydration test is an expected failure, D-01) |
| Axe sweep (`e2e/qa/a11y-sweep.spec.ts`) | all 11 passed after the fixes |
| Browser matrix (`e2e/qa/core-journeys.spec.ts`) | 12 passed, 2 skipped, 1 intermittent Safari failure (D-04) |
| Performance (`e2e/qa/perf-budget.spec.ts`) | 6 passed (phone Tasks is an expected failure, D-05) |
| `npm run check:bundle-budget` | 71 routes, none over |
| Full Vitest suite and the complete Playwright suite | see the "Final run" section |

## Final run

Run on 1 Nov 2026 against the production build, after the fixes listed in `docs/QA_DEFECTS.md`.

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| Full Vitest (`npx vitest run`, 204 files) | 2,456 of 2,457 passed after the calendar assertion was updated. **One failure is environmental:** `tests/permissionsV2.test.ts` "role catalogue sync" times out at 20 s because the test database now holds 12,500 organisations left by earlier runs and the sync audits each one (E-02). It passed on the first full run of this pass, when the database was smaller |
| Full Playwright (all projects, 298 tests) | Last complete run: 251 passed, 42 skipped, 5 failed. Four of those were fixed and re-run green on their own (payments journey, phone visual baseline after masking the live Today list, phone Tasks LCP now reported and not flipped, qualification loop partly). **Still open: `e2e/leads.spec.ts` "cannot be marked Qualified" (E-01), the phone Customers LCP at the budget line (2.66 s on one loaded run, passes alone), and the intermittent desktop Safari sign-in (D-04).** A complete Playwright run after the last test-only edits was not repeated |
| `npm run check:build-output`, `npm run check:bundle-budget` | clean, 71 routes within budget |

## What the gate still needs (in order)

1. Decide D-01, D-02, D-05: fix or defer in writing.
2. Run the 50k-lead performance pass; record Linux visual baselines in CI; have design approve the pictures.
3. Stand up staging (FIG-1123), then the UAT sessions, then the manual accessibility and device passes.
4. Baseline the FIG-444 metrics.
5. Michael and Given approve; record it as a comment on FIG-1122 with links to the reports above.
