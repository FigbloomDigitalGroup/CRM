# Backend V1 sign-off gate review (G1.08, FIG-1075)

Reviewed 27 Oct 2026 by Claude on Given's behalf, at Given's request. Given has said he takes this recommendation as his final decision and approves on Michael's behalf.

## Verdict

**Approve the backend as V1.** Technically it meets the gate. Standing decision (Given, 27 Oct): everything stays on `dev-given` until all milestones are complete, so the gate closes on `dev-given`: the work merged there with green CI, and the tags created there (see "Before this can be Done").

## The checklist, item by item

| Checklist item | State | Evidence |
|---|---|---|
| Stage gates B1.13, B2.17, B3.11, B4.10 closed | B1.13, B2.17, B3.11 are Done in Linear. **B4.10 (FIG-1067) is open** | Its evidence is complete (below); it closes with the merge. |
| G1.01 to G1.07 done | Done in Linear (moved by Given) | Comments on each issue; one known gap, the 10-run flaky sweep (below). |
| No open Urgent or High bugs or security findings | None open from this review. Given must confirm none exist against M1 to M4. | `docs/SECURITY_REVIEW_V1.md`: findings fixed; accepted items listed with reasons. |
| End-to-end API demo for every role, recorded | **Done** | `docs/demo/BACKEND_V1_DEMO_RUN.md`, produced by `tests/backendV1Demo.test.ts` (a passing run, every line asserted). Per-stage demos: `docs/demo/stage-2.http`, `stage-3.http`, `stage-4.http` with the three exit-gate tests. |
| Permission matrix and tenant isolation reports attached | **Done** | `docs/PERMISSION_MATRIX_REPORT.md`; `tests/tenantAttack.test.ts` (RLS on 63 tables, attacker walk of every route). |
| Performance baseline and security review attached | **Done** | `docs/PERF_BASELINE.md`, `docs/SECURITY_REVIEW_V1.md`. |
| Tag `backend-v1` on `dev-given`; OpenAPI v1.0 published | Contract frozen; the tag needs Given's explicit instruction | The frozen contract is `src/api/contract/openapi.v1.json` (1.0.0, hash in `docs/API_CHANGELOG.md`); it is published by being merged to `dev-given`. |
| Michael's approval recorded | Given approves on Michael's behalf (recorded on FIG-1075). Nothing goes to `dev-staging` or `main` before all milestones are complete; when it does, GitHub needs Michael's own approval on those pull requests (`BRANCHING.md`). | |

## B4.10 (FIG-1067), the open stage gate

Checklist against evidence: M4 issues built and in the working tree; API tests per role for settings, automations, integrations, migration, data and privacy, and sync (`tests/stage4ExitGate.test.ts` plus the generated walk); automation boundary test passes; tenant isolation for migration sessions, retention, requests, the sync queue and push subscriptions (`stage4ExitGate` and `tenantAttack`); demo script `docs/demo/stage-4.http` (migration with a bad row, dry run, import, rollback, automations, erasure, replayed sync batch with no duplicates); job fault-injection tests pass; contract tests and OpenAPI diff reviewed (hash-gated). Full suite green (130 files, 1,679 tests). The only unmet item is "merged, CI green".

## What I looked for and did not find

- A route that opens an area to the wrong role (the matrix walk and the reviewed role families agree for all six roles).
- Any way across organisations (RLS on every tenant table, an attacker walk of every route, signed links, jobs, public keys).
- A server error reachable from input (five found and fixed during M5; the walks now fail on any).
- A masked value (deal value, payment) in any answer to a role that may not see it, including the mock server's examples.
- An unreviewed secret, an unlimited public endpoint, or a CSV export that runs a formula.

## Residual risk, and my recommendation on each

| Item | Recommendation | Why |
|---|---|---|
| The deal-rules migration locks `deals` for about 9.5 s at 3,500 deals / 40,000 activities | **Do not edit the migration.** Use the two temporary indexes in the runbook (tested: 0.7 s) and run the upgrade in a quiet window. | The migration is already on `dev-given` and applied on dev and test databases; editing history is a bigger risk than the lock. Re-run the rehearsal on a copy of real data before go-live. |
| Seven dev-only advisories in Vitest 2 | **Accept now; upgrade as its own change** (FIG-1259). | Nothing shipped is affected; changing the test runner at the moment of the freeze is the larger risk. |
| Rate limits on the API routes behind two frozen auth pages | **Accept.** | The pages are unchanged; the limits close a real abuse path. Note it in the release notes. |
| Request bodies ignore unknown fields instead of rejecting them | **Accept.** | Proven harmless (`tests/massAssignment.test.ts`); rejecting would be a contract change. |
| Script CSP is Report-Only | **Accept until the frontend can send per-request nonces.** | Enforcing it now would break the app's own scripts. |
| No production antivirus without `CLAMD_HOST` | **Make it a go-live condition** (FIG-1257, P1.06). | Config, not code. |
| 10 consecutive green full runs not done | **Run it before the tag.** A sweep is running (about 4 hours); result goes on FIG-1068. | It is the one explicit G1.01 criterion not yet met. |
| Performance measured on a laptop | **Re-measure on the real host** (FIG-1255 does this for Supabase). | Server time only, no network. |
| No independent penetration test | **Schedule one before real customer data** (P1.06). | Out of this gate's scope; stated plainly in the security review. |

## Before this can be Done

1. **Commit and merge into `dev-given`** (authorised by Given on 27 Oct): commit on `makeover/m3-customers-delivery-finance`, push it, open the pull request into `dev-given` and merge it when CI is green (`BRANCHING.md`; Given merges his own branch). Nothing moves to `dev-staging` or `main` yet.
2. **Tag `backend-v1`** (and `api-v1.0` for the contract) on `dev-given` after that. Needs Given's explicit instruction.
3. **Flaky sweep** result recorded.
4. **Frontend:** M6 can start from the frozen contract and the typed client once they are merged to `dev-given`; until then there is nothing to build against.

On those conditions: **approved.**
