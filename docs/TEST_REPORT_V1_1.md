# Test report: V1.1 backend quality gate (G2.01 and G2.02)

Branch `makeover/m15-v11-gates`, from `dev-given` at "M14: MVP on Vercel (#32)". Run on 9 Nov 2026 on the local test database (plain PostgreSQL 16, port 25432).
Covers FIG-1156 (G2.01) and FIG-1157 (G2.02). G2.03 (performance, contract freeze) and G2.04 (sign-off) are reported separately.

## Result

| Check | Result |
|---|---|
| Full suite, `npx vitest run` | 263 test files, 3,239 tests. 259 files and 3,232 tests passed on the first run. The four files that failed are explained below and passed on the re-run with the CI release default. |
| `tests/apiWalkV11.test.ts` (new, 17 minutes) | 481 routes × 5 roles on a V1.1 organisation: no server error, every refusal explained, no deal value, margin, cost or payment shown to a role that may not see it, 401 when signed out, no V1.1 route refused as "not in your release". |
| `tests/accessMatrixV11Rules.test.ts` (new, seconds) | 10 of 10. |
| `tests/tenantAttackV11.test.ts` (new) | 11 of 11. |
| `tests/platformTenantDenialV11.test.ts` (new) | 5 of 5. |
| `tests/v11PermissionDenial.test.ts` (new) | 7 of 7. |
| Platform suites (changed by the G2.02 fixes) | `platformDataRequests` and `platformAdmins`: 56 of 56, three of them new. |
| Typecheck | Clean for `src`, `tests`, `prisma` and `scripts`. The local `.next-*` build folders (ignored by git) add stale errors that CI does not have. |
| Lint | Clean. |

### The four files that failed in the first full run

`tests/apiWalk.test.ts`, `catalogue.test.ts`, `pipelines.test.ts` and `dealGateBypass.test.ts` failed because the local `.env` sets `ACTIVE_RELEASE="v2"` (a
setting for the local preview build), so "a V1 organisation" was a V2 one. CI does not set it. They were re-run with `ACTIVE_RELEASE=v1` and passed (see the
Evidence line at the end). A fresh clone is not affected. Anyone running the suite on the same machine should unset it or use `ACTIVE_RELEASE=v1 npx vitest run`.

## G2.01: what was built

1. **A V1.1 organisation for the walks** (`tests/helpers/worldV11.ts`): the V1 world moved to release V1.1 with the assistant on, plus one real record of every V1.1 kind: catalogue
   item, quote with a version and a share link, discount approval, chat channel with a message, follow-up sequence and enrolment, web form, saved view, mail draft, camera capture,
   connection, assistant request and proposal, pipeline and stage. The world fails loudly if any of them cannot be built.
2. **The generated matrix on that organisation** (`tests/apiWalkV11.test.ts`): `src/api/contract/accessMatrixV11.json` and `docs/PERMISSION_MATRIX_REPORT_V1_1.md`
   (481 route and method pairs, 2,405 role answers: A 843, D 1,140, H 255, V 167). 126 routes that are closed to everyone in a V1 organisation are open here.
   No route that worked in V1 changed for any role.
3. **Reviewed role rules** (`tests/fixtures/roleFamiliesV11.ts`, `tests/accessMatrixV11Rules.test.ts`), written from the permission model, not from the answers: who may use quotes,
   approvals, the catalogue, forecast, sequences, the assistant, chat, mail and meetings. A cell answered `V` (rejected as invalid before the permission is judged) or `H` (record hidden)
   does not count as proof that a role may use a route, so those are covered by 4.
4. **Valid-request denial tests** (`tests/v11PermissionDenial.test.ts`): every V1.1 write a role must not make (catalogue, pipelines and stages, approval rules, quote settings, targets,
   sequences, web forms, assistant settings, approval decisions and cancels, quote versions and sending, chat channel deletion), made with a valid input as each role without the permission.
   All refused, nothing changed.
5. **Cross-tenant attacks** (`tests/tenantAttackV11.test.ts`): two V1.1 organisations. Row-level security and both policies on all 34 V1.1 tables, with rows of B present in 20 of them so the check is not
   vacuous; every route as each of A's five roles with B's real ids (2,405 calls, nothing of B's returned or changed); chat sync, typing, presence, attachment links and cards for B's records refused in A.
6. **Platform and tenant denial** (`tests/platformTenantDenialV11.test.ts`): all `/api/platform/*` routes as signed-out, tenant Management, tenant Sales and a tenant token offered as a platform cookie: 404,
   nothing written; sign-in routes create no session or identity; a platform admin with every key on all 481 organisation routes: refused, nothing of the organisation shown or changed. A positive control proves
   the same cookie jar is a real platform session.

## G2.01 findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| N-01 | Medium | Money typed into a **deal's own chat channel** is hidden from people who may not see that deal's value, but not from someone who may see the value and may not see payments (the deal's owner, Sales). An invoice amount typed there is visible to them. Card figures and text sent with an invoice card are hidden correctly. | **Open, product decision for Given and Michael.** Options: hide all money text in a deal channel from roles without payments access, or accept it as the author's own words (as comments are). The test covers the deal value and the cards. |
| N-02 | Low | Delivery and Restricted Technical read the active follow-up sequences, because the read needs `tasks.create`. | Accepted: matches the permission model; nothing in a sequence is customer data. |
| N-03 | Medium (outside this scope) | Migration `20261120090000_remove_customer_support` fails on a database where a task is assigned to the removed Customer Support dev user (`tasks_assignee_membership_id_fkey`). | **Open. Raise as its own issue.** The local dev database is stuck on it; the test database is not affected. Not changed here because it edits a merged migration. |
| N-04 | Info | The V1 matrix test depends on `ACTIVE_RELEASE`; the local `.env` sets `v2`. | Documented above. |

Walk limits worth knowing: the matrix cannot prove a refusal where the synthesised request is rejected first (`V`) or the record is hidden (`H`); that is what `v11PermissionDenial` is for.
The platform routes are not organisation routes and are not in the matrix; `platformTenantDenialV11` walks them for denial only. A generated guard that every mutating platform route asks for a fresh
verification is a follow-up (see the security review, section 6).

## G2.02: result

`docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md`: seven findings, no open High. Fixed with tests: F-01 (a deletion approval from a suspended or removed admin no longer counts), F-02 (sign-in timing no longer
reveals platform admin emails), F-05 (recovery links live 24 hours). Accepted with reasons: F-03 (audit chain not anchored off the database), F-04, F-06, F-07. Support access (break-glass for customer
data) is not built; the review lists 12 testable requirements for it.

## Not done

G2.03 (performance and contract freeze) and G2.04 (sign-off gate) are not part of this report. No tag was made and nothing was pushed to `dev-given`.

## Evidence

- Walk: `UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalkV11.test.ts` writes the matrix and report; without the flag it compares to them.
- Re-run of the four failed files with `ACTIVE_RELEASE=v1`: see the commit message for the final line of the output.
