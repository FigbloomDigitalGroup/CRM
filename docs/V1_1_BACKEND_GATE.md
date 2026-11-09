# V1.1 backend sign-off gate (G2.04, FIG-1159): checklist and evidence

The formal "V1.1 backend works" moment before frontend work is wired to it. This page is the checklist with the real state of each line on 9 Nov 2026.
**Not signed.** The tag, the published contract, Michael's approval and the demo recording are Given's to record. Nothing here has been tagged or pushed to `dev-given` by Claude.

| # | Checklist line (from FIG-1159) | State | Evidence |
|---|---|---|---|
| 1 | B6.01 to B6.23 done or consciously cancelled | **Yes.** B6.01 to B6.22 are Done in Linear. B6.23 (FIG-1155, Customer Support role and tickets) is Canceled by decision 12 (5 Nov 2026); its replacement B6.23b (FIG-1524, support requests by email through Resend) is still in Backlog and is decision-gated, not part of this gate. The Communication group B6.24 to B6.27 (FIG-1382 to FIG-1385) are Done. | Linear; `docs/DECISIONS.md` 12 |
| 2 | G2.01 to G2.03 done; no open Urgent or High findings | **G2.01 and G2.02: yes** (merged in PR #34; no open High; open Medium items need a decision, below). **G2.03: in progress** (load checks and contract freeze). | `docs/TEST_REPORT_V1_1.md`, `docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md` |
| 3 | API demo for platform console, quotes, approvals, assistant | **Script written, not recorded.** The requests are in `docs/demo/stage-6-v1-1.http`; the same behaviour is proved by tests (`tests/v11PermissionDenial.test.ts`, `tests/apiWalkV11.test.ts`, the platform suites). A recording needs a person running the dev server. | `docs/demo/stage-6-v1-1.http` |
| 4 | Tag `backend-v1.1`; OpenAPI v1.1 published | **No. Given's to do** after G2.03 merges. | |
| 5 | Michael approval recorded | **No. Given's to record.** | |

## Open decisions that should be answered before or at sign-off

| ID | What | Who decides |
|---|---|---|
| N-01 | Money text typed into a deal's own chat channel is visible to the deal owner who may not see payments (card figures are hidden). Hide it, or accept it as the author's own words. | Given and Michael |
| N-03 | Migration `20261120090000_remove_customer_support` fails on a database that has tasks assigned to the removed Customer Support dev user. Raise as its own issue. | Given |
| F-03 | The platform audit chain is not anchored outside the database. Add the audit export and head hash to the off-site encrypted backups. | Given, with the backup work |
| (open) | The independent penetration test is still open and should include the platform console. | Given |

## What the gate rests on

- Role matrix on a V1.1 organisation: `docs/PERMISSION_MATRIX_REPORT_V1_1.md` (481 routes x 5 roles, no server errors, no leaks, no V1 route changed).
- Tenant isolation: all 34 V1.1 tables have row-level security with read and write policies; 2,405 attacker calls returned and changed nothing of another organisation's.
- Platform wall: every platform route is 404 for tenant users and signed-out callers; a platform admin with every key is refused on every organisation route.
- Platform security review: seven findings, no open High, three fixed with tests.
- Full suite on 9 Nov 2026: 263 files, 3,239 tests (four files pass only with `ACTIVE_RELEASE=v1` on a machine whose `.env` sets another release; CI is unaffected).
