# V1.1 backend sign-off gate (G2.04, FIG-1159): checklist and evidence

The formal "V1.1 backend works" moment before frontend work is wired to it. This page is the checklist with the real state of each line on 9 Nov 2026.
**Signed off by Given on behalf of Michael, 10 Nov 2026.** The tags (`api-v1.1`, `backend-v1.1`) and the demo recording are Given's to place after #37 merges. Nothing here has been tagged or pushed to `dev-given` by Claude.

| # | Checklist line (from FIG-1159) | State | Evidence |
|---|---|---|---|
| 1 | B6.01 to B6.23 done or consciously cancelled | **Yes.** B6.01 to B6.22 are Done in Linear. B6.23 (FIG-1155, Customer Support role and tickets) is Canceled by decision 12 (5 Nov 2026); its replacement B6.23b (FIG-1524, support requests by email through Resend) is still in Backlog and is decision-gated, not part of this gate. The Communication group B6.24 to B6.27 (FIG-1382 to FIG-1385) are Done. | Linear; `docs/DECISIONS.md` 12 |
| 2 | G2.01 to G2.03 done; no open Urgent or High findings | **G2.01 and G2.02: yes** (merged in PR #34; no open High; open Medium items need a decision, below). **G2.03: contract freeze done (PR #37); performance not demonstrated.** No N+1 and no pathological path, but on this noisy machine the targets are not shown for the forecast, assistant context and chat; fixes are recommended in `docs/PERF_V1_1.md` and need a decision. | `docs/TEST_REPORT_V1_1.md`, `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md`, `docs/PERF_V1_1.md` |
| 3 | API demo for platform console, quotes, approvals, assistant | **Script written, not recorded.** The requests are in `docs/demo/stage-6-v1-1.http`; the same behaviour is proved by tests (`tests/v11PermissionDenial.test.ts`, `tests/apiWalkV11.test.ts`, the platform suites). A recording needs a person running the dev server. | `docs/demo/stage-6-v1-1.http` |
| 4 | Tag `backend-v1.1`; OpenAPI v1.1 published | **No. Given's to do** after G2.03 merges. | |
| 5 | Michael approval recorded | **Yes**, by Given on Michael's behalf, 10 Nov 2026. | This page |

## Decisions recorded by Given, 10 Nov 2026

Given approved every recommendation and gave the sign-off on behalf of Michael (recorded here from Given's message; the tags are still Given's to place).

| ID | Decision |
|---|---|
| G2.03 perf | Accept the contract freeze now. The forecast, assistant context and chat fixes in `docs/PERF_V1_1.md` are a follow-up measured on the staging stack; the gate is not held for them. |
| N-01 | Accepted for now: money text typed into a deal's own chat channel is the author's own words. Revisit whether deal channels should hide all money text. |
| N-03 | Raised as its own issue: FIG-1565 (migration `20261120090000_remove_customer_support`). |
| F-03 | Raised as FIG-1566 (platform audit export and chain head hash in the off-site backups). |
| (open) | The independent penetration test stays open and should include the platform console. |
| Sign-off | Given, on behalf of Michael, 10 Nov 2026. |

## What the gate rests on

- Role matrix on a V1.1 organisation: `docs/PERMISSION_MATRIX_REPORT_V1_1.md` (481 routes x 5 roles, no server errors, no leaks, no V1 route changed).
- Tenant isolation: all 34 V1.1 tables have row-level security with read and write policies; 2,405 attacker calls returned and changed nothing of another organisation's.
- Platform wall: every platform route is 404 for tenant users and signed-out callers; a platform admin with every key is refused on every organisation route.
- Platform security review: seven findings, no open High, three fixed with tests.
- Full suite on 9 Nov 2026: 263 files, 3,239 tests (four files pass only with `ACTIVE_RELEASE=v1` on a machine whose `.env` sets another release; CI is unaffected).
