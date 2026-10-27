# Figbloom CRM: instructions for Claude Code

Stack: Next.js 15, React 19, TypeScript, Prisma 5, Postgres with row-level security (RLS), Vitest, Playwright.

## What we are doing

A full makeover of the CRM to the approved "Figbloom CRM – Final Design" (92 screens: 54 V1, 29 V1.1, 9 V2).
**Everything must be complete by 22 Nov 2026. The date does not change.** V1 goes live by 8 Nov; V1.1 and V2 follow, all scheduled to finish by 18 Nov with 19 to 22 Nov held as buffer.

The plan lives in Linear: project "CRM Project", team Figbloom, issues FIG-xxxx. Read the project's pathway document first when Linear is connected. Linear is the source of truth for scope; this file is the source of truth for how we work.

### Order of work (backend first)

| Milestone | What | Due |
|---|---|---|
| M0 | Baseline and guardrails | 23 Oct |
| M1 to M4 | Backend stages, each ends with an exit gate (B1.13, B2.17, B3.11, B4.10) | 25, 27, 29, 30 Oct |
| M5 | Backend V1 quality gate (G1.08): tag `backend-v1` on `dev-given`, Michael approves (recorded by Given) | 31 Oct |
| M6 to M9 | Frontend (design system, sales, customers and finance, settings and mobile) | 1 to 5 Nov |
| M10 / M11 | V1 QA and UAT / production readiness and go-live | 7 / 8 Nov |
| M12 to M15 | V1.1 backend, gate, frontend, QA | 12 to 16 Nov |
| M16 / M17 | V2 backend / V2 frontend and release | 17 / 18 Nov |

**Standing decision (Given, 27 Oct 2026): all work stays on `dev-given` until every milestone is complete. Nothing is moved to `dev-staging` or `main` before then, and the gate tags (`backend-v1`, `api-v1.0`) are placed on `dev-given`.** Do not start a stage until the previous stage's exit gate is closed. Frontend work against the real API starts only after G1.08.
If the date is at risk, the agreed cut order is: E1, E2, F1, S5, S7, then the decision-gated V2 items, then V2 polish. V1 is never cut. Do not cut anything without Given's say-so.

## Hard rules

1. **Frozen pages.** Login, sign-up, forgot password, reset password and accept-invite pages must not change (markup, styles, behaviour). New auth steps (for example two-step sign-in) are new routes only. A visual regression guard enforces this.
2. **One Linear issue at a time.** Read the whole issue first: goal, scope, acceptance criteria, tests, dependencies.
3. **Work autonomously to completion.** Do not stop to ask for a "go". Investigate, decide, implement, test and verify on your own, and finish the issue. Stop and ask only when (a) a decision is genuinely Given's or Michael's (scope, permissions, product behaviour), or (b) an action is irreversible and the prompt did not authorise it. When you must stop, say exactly what you need and what you already finished.
4. **Never commit, push, merge, tag, force-push or delete branches/files unless Given asks for that exact action.** A line in the prompt Given pastes (for example "COMMIT AUTHORISED") counts as Given asking. Authorisation covers only what the prompt lists and only for that issue. If an action is not listed, leave the work in the working tree with tests green and report it.
5. **Branches:** `makeover/<code>-<slug>`, for example `makeover/b1-04-sessions`. `main` is protected, squash merge, CI required. Never push to `main` directly.
6. **Tests are part of the work.** Never skip, delete or loosen a failing test to get green; report it. Run the relevant tests and the full suite before saying an issue is done.
7. **Permissions and masking.** Deal values, margins, costs and payments are masked by role everywhere: lists, detail, search, exports, notifications, timelines, assistant. Payments are visible only to Finance and Management.
8. **Tenant isolation.** Every tenant table needs RLS and a cross-organisation test. Jobs, webhooks, files and signed URLs check the organisation too.
9. **Automations never decide.** Rules may assign, remind and draft. They never move a deal stage, set a discount or approve anything. A test enforces it.
10. **Dev-only things stay dev-only.** Dev sign-in chips and the Dev Super Admin account (FIG-1196) exist only when not in production and when `ALLOW_DEV_ACCOUNTS=true`. Seeds refuse to run when `NODE_ENV=production`. Production boot fails if a dev account exists.
11. **Never put secrets, tokens or real customer data** in code, tests, logs or commits.
12. **Definition of done (closing an issue).** All acceptance criteria met; the issue's tests written; full suite, typecheck and lint green; docs the issue names updated. Then close it out: if Linear is connected, post a closing comment (what changed, how verified, commit/PR). Status changes are governed by rule 13. If Linear is not connected, print the closing comment for Given. Never mark Done on unmerged or unverified work.
13. **NEVER change a Linear issue's status (Done, In Progress, Todo, In Review, Canceled or anything else) unless Given asks you to do it, in that prompt, for that issue.** Given moves every status personally. Completing the work, merging it, or a prompt saying "close out" or "finish the issue" is NOT permission to change the status. Post the closing comment only. Do not reopen issues either: if an issue looks wrongly marked, say so in the report and let Given decide. If you are ever unsure, do not change it.

## Conventions

- API: Zod DTOs are the source of truth, OpenAPI is generated from them, one error envelope, one pagination/filter/sort standard, idempotency keys on creates (B0.06). Roles get an explained "no access", not a silent hide.
- Roles in play: Management (organisation admin), Sales, Delivery, Finance, Restricted Technical, Customer Support (proposed, behind a flag), Platform Super Admin (separate platform identity, V1.1).
- Feature flags per release train (V1 / V1.1 / V2) and per organisation (B0.07).
- Design reference IDs (A1, L2, P1, S5, PL3 and so on) come from the design's Screen Checklist and are named in each issue.
- Background work uses the job framework (B2.18, FIG-1066). Do not build ad hoc schedulers.

## Commands (from package.json)

```
npm run dev               # next dev
npm run build
npm test                  # vitest run
npm run test:coverage
npm run e2e               # playwright (npm run e2e:install first)
npm run typecheck         # tsc --noEmit
npm run lint
npm run db:setup          # migrate, bootstrap role, grant role, seed
npm run seed
```

`seed:dev`, docker-compose Postgres with the `figbloom_app` role, and the CI Postgres service are delivered by B0.02 and B0.08. Until they land, check that the database is reachable before trusting a test run.

## Where we are right now (update as milestones close)

**M0 (baseline and guardrails): built and merged to `main`** (PRs #9 to #17). Test baseline in `docs/TEST_BASELINE.md`; decisions signed 22 Oct in `docs/DECISIONS.md`; design in `design-spec/`; API conventions, release flags, seed v2 and the dev Super Admin with its three guards are on `main`. The FIG-789/792/793/794 backend halves are merged; their UI halves live in M7 to M9.

**M1 (identity, preferences, organisation profile): merged to `main`** (PR #18). The OpenAPI document still lacks some Stage 1 routes: `/me/sessions/*`, `/me/sign-in-events`, `/orgs/{org}/security/*`, the membership lifecycle routes, `/files/{id}/content`, `/storage/blob`, `/platform/preferences`. Add them (Zod DTO per route, B0.06) before G1.06 freezes the contract.

**M2 (sales core and record extras): merged to `dev-given`** (PR #20; branch rules in `BRANCHING.md`: work on `feature/` or `makeover/` branches, PR into `dev-given`, Mike approves `dev-staging` and `main`). FIG-1030 to FIG-1046, FIG-1066, FIG-796, 797, 798, 803. Migrations `20261023140000` to `20261024060000` are applied to the dev and test databases. Docs: `docs/JOBS.md`, `docs/MASKING.md`, `docs/SCORING.md`, the Stage 2 section of `IMPLEMENTATION_NOTES.md`, demo in `docs/demo/stage-2.http` and `tests/stage2ExitGate.test.ts`. The gate (B2.17, FIG-1046) closes when the work is committed, merged with green CI, and Given confirms there are no open Urgent or High bugs. Known gaps: `q:` qualification columns are exported but not imported; OpenAPI lists the main Stage 2 endpoints only.

**M3 (customers, delivery, finance, reporting): all 12 issues built, in the working tree, not committed.** FIG-1047 to FIG-1057 and FIG-795. Migrations `20261026090000` to `20261026120000` are applied to the dev and test databases. Docs: `docs/PAYMENTS.md`, `docs/LIFECYCLE_AND_RENEWALS.md`, `docs/CUSTOMER_360_AND_CONVERSATIONS.md`, `docs/REPORTING_METRICS.md` (Reports v2), the Stage 3 section of `IMPLEMENTATION_NOTES.md` (it lists the decisions taken without being asked), demo in `docs/demo/stage-3.http` and `tests/stage3ExitGate.test.ts`. The gate (B3.11, FIG-1057) closes when the work is merged with green CI and Given confirms there are no open Urgent or High bugs. Known gaps: the audit reader (M4) must hide `PAYMENT_ENTITIES`; OpenAPI lists the Stage 3 endpoints in `src/api/stage3Operations.ts` with loose per-role schemas.

**M4 (admin, automation, data and mobile sync): all 11 issues built, in the working tree, not committed.** FIG-1058 to FIG-1065, FIG-1067, FIG-799, FIG-800. Migrations `20261027090000`, `20261027100000` and `20261027110000` are applied to the dev and test databases. Docs: `docs/SETTINGS_ADMIN.md`, `docs/AUTOMATIONS.md`, `docs/DATA_MIGRATION.md`, `docs/PRIVACY.md`, `docs/SYNC_AND_PUSH.md`, the Stage 4 section of `IMPLEMENTATION_NOTES.md` (it lists the decisions taken without being asked), demo in `docs/demo/stage-4.http` and `tests/stage4ExitGate.test.ts`. The gate (B4.10, FIG-1067) closes when the work is merged with green CI and Given confirms there are no open Urgent or High bugs. New dependencies: `web-push`, `exceljs`. OpenAPI lists the Stage 4 endpoints in `src/api/stage4Operations.ts` with loose per-role schemas.

**M5 (Backend V1 quality gate): G1.01 to G1.07 built, in the working tree, not committed.** FIG-1068 to FIG-1074; the sign-off gate G1.08 (FIG-1075) needs Given (tag `backend-v1` and `api-v1.0`, Michael's approval, demo). Migrations `20261028090000_rate_limit_actions` and `20261028100000_search_trgm_coverage`. Docs: `docs/PERMISSION_MATRIX_REPORT.md`, `docs/PERF_BASELINE.md`, `docs/SECURITY_REVIEW_V1.md`, `docs/MIGRATION_REHEARSAL.md` (upgrade runbook), `docs/TEST_REPORT_BACKEND_V1.md`, `docs/API_REFERENCE.md`, `docs/API_CHANGELOG.md`, the Stage 5 section of `IMPLEMENTATION_NOTES.md`. The V1 API contract is frozen in `src/api/contract/openapi.v1.json` (change it only with `npm run contract:update` plus a changelog note); typed client in `src/api-client/`, mock server `npm run mock:api`. The full suite takes about 25 minutes (the route walks); the performance run is separate (`npx vitest run --config vitest.perf.config.ts`). Open decisions for Given: the deal-rules migration lock (see the rehearsal), the Vitest 2 upgrade, `CLAMD_HOST` in production.

**Next: M6 (frontend), once G1.08 is signed off.** Frontend work against the real API starts only after G1.08.

Ops reminders: new migrations need `npm run migrate:deploy`; `ALLOW_DEV_ACCOUNTS=true` in local `.env` for dev sign-in; Docker Desktop must be running for the test database (`docker compose up -d --wait`).

## How to start a session

Do a quick read-only status check (branch, `git status`, `main` against the remote, unmerged branches, whether tests run), mention anything surprising in one short paragraph, then carry on with the task in the prompt. Do not wait for permission to continue.

## Per-issue routine

1. Read the Linear issue and investigate the current state.
2. Decide the approach yourself; note it briefly.
3. Implement, with tests.
4. Run the relevant tests, then the full suite, typecheck and lint. Fix what you break.
5. Perform only the git actions the prompt authorises.
6. Close out per rule 12 and give a short final report: outcome, verification, anything Given must do.
