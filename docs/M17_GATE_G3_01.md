# G3.01 · V2 backend gate (FIG-1191), 9 Nov 2026

Status: **signed off by Given, also on Michael's behalf, 12 Nov 2026 (see "Sign-off" below); tag not placed.** Earlier: checks run, sign-off open. The gate closes when Given confirms there are no open Urgent or High bugs and Michael's approval is recorded. The tag `backend-v2` is not placed: tags are placed only when Given asks (CLAUDE.md rule 4).

## Checklist (from the issue)

| Item | State |
|---|---|
| B7.01 to B7.08, FIG-804, FIG-805 done or consciously cancelled | Built: FIG-1183, 1184, 1185, 1186, 1188, 1190, 804, 805 and FIG-1189. **FIG-1187 (deposit request) is not built and not cancelled**: it needs the payments decision (docs/DECISIONS.md 2.5 and 13). Only Given cancels. |
| Regression, authorization matrix, tenant isolation, support-access abuse tests green | Full suite run on the merged branch (see Results). Matrices regenerated: `accessMatrix.json`, `accessMatrixV11.json`, reports in `docs/PERMISSION_MATRIX_REPORT*.md`. Tenant isolation: every new tenant table has RLS and a cross-organisation test in its lane's test file; four were added to `tests/tenantAttackV11.test.ts`. Support-access abuse tests: `tests/supportAccess.test.ts` (20). |
| Security review of support access, e-signature, API tokens, webhooks | Below. Written by the builders from their own code and tests: **an independent review has not happened.** |
| OpenAPI v2 frozen; tag `backend-v2` | The new internal routes are in `src/api/contract/openapi.v1.json` (regenerated, hash in `docs/API_CHANGELOG.md`); the public API has its own document at `/api/v1/openapi.json`. **Tag not placed.** The separate "v2 contract" is not a second file: it is the same document at version 1.1.0 (additive). |
| Michael approval recorded | **Open.** |

## Security review (self-review, for an independent reviewer to confirm)

**Support access (FIG-1183).** No access without approval: grant states move only through database triggers (request, approve, open, end, expire). The platform database role has no privilege on `support_access_grants` or `support_access_page_views`; it reads tenant records only through the function `support_access_read`, which returns no money fields and masks contact details. The window counts from opening and ends by expiry on every read (the clock is compared at read time; the job `support_access.expire` only tidies). Every page view is logged and visible to the organisation. Gap: R10 (declared-outage access) is not built.

**E-signature (FIG-1186).** Token-based public endpoint; expired links refused; one append-only signature record with a seal hash over signer, consent, document hash, time, IP and device; triggers make the record and the sent document immutable; `verifySignatureRecord` re-checks both. Gap: no PDF of the signed quote, no owner notification.

**API tokens (FIG-805).** `fbk_` tokens, SHA-256 only, shown once, 1 to 365 days, revocable; requests run as the owning membership so permission checks, tenant scoping and RLS apply; scopes only narrow; rate limit 120 per minute per token and 600 per address. Open: the API-call limit counter (FIG-1184, `recordApiCall`) must be called from the token guard; check it in the next pass.

**Webhooks (FIG-804).** HMAC-SHA256 over `timestamp.body` with a per-endpoint secret (encrypted at rest with `INTEGRATION_ENCRYPTION_KEY`, shown once, rotatable); retries 1, 3, 9, 27 minutes up to 6 hours, dead after 8 attempts; endpoint switched off after a 410 or ten dead deliveries in a row. SSRF guard: https only, public addresses only in every IPv4 and IPv6 form, address checked again at connect (rebinding), redirects not followed. Payloads are built as the endpoint's creator, so masking follows that person's role. Cost: one indexed endpoint lookup per created lead (the `quickCapture` call budget went from 16 to 17 database calls, constant per capture).

**Custom roles (FIG-1188).** Organisation-running keys, payments and margin can never be granted to a custom role (hard rule 7); the last Management member cannot be locked out; edits take effect on the next request; platform roles are read-only. `roles` now has forced RLS: this assumes the production owner role bypasses RLS as local Postgres does (**to confirm on AWS**).

## Results

See the "Verification" section at the end of this file, filled in after the final run.

## Open for Given and Michael

1. FIG-1187: approve taking payments through the CRM and choose a provider, or cancel with a note.
2. Native review of the Swahili text (FIG-1189).
3. Independent security review of the four areas above; Michael's approval; the `backend-v2` tag.
4. Confirm the AWS owner role bypasses RLS.
5. Custom roles can never hold audit, bulk export, payments or margin: product confirmation.
6. The V2 screens are still on demo data and must be wired to these routes (M18).

## Verification (10 Nov 2026)

- Full suite on the merged branch (`ACTIVE_RELEASE=v1`, own Postgres on port 55433): **274 of 274 files, 3428 tests passed, 8 skipped.** `npm run typecheck` and `npm run lint` clean.
- A first full run had 7 failures; all were fixed, none by weakening a test's meaning:
  - Contract and typed-client tests: the contract was regenerated after the matrix snapshots (`contract:update`; hash in `docs/API_CHANGELOG.md`).
  - Matrix rules and V1.1 walk: the V2 route families are expected to answer `FEATURE_UNAVAILABLE` below release V2 (they are walked under V2 in their own tests).
  - V1.1 walk, `PUT .../stages/{stageId}/rules`: a **pre-existing flaky fixture** (an unordered `findFirst` could hand the walk the Closed Lost stage); the fixture now picks the first open stage by sequence.
  - `seed.test`: counts the five platform roles only; custom roles (organisation-owned) are not seed data.
  - `quickCapture` database-call budget raised from 16 to 17: **a deliberate change**, one indexed webhook-endpoint lookup per created lead (FIG-804), constant per capture.
- Found and fixed during integration: the organisation's monthly API-call limit (FIG-1184) was never called from the API-token guard. It now is (`authenticateApiToken`), with a test (`tests/publicApi.test.ts`).
- Not run: e2e (Playwright), the performance suite, the 50k-lead run. Nothing in M17 changes a frozen page.

## Close-out (11 Nov 2026)

Branch `makeover/m17-closeout`. Four independent agent passes, each on its own test database, wrote their evidence in these files:

| Issue | Evidence | Result |
|---|---|---|
| FIG-1183 B7.01 support access | `docs/M17_CLOSEOUT_B7_01.md`, `tests/m17closeSupportAccess.test.ts` (16 tests) | Every scope bullet and criterion proven. No bug found. |
| FIG-1188 B7.06 roles and field access | `docs/M17_CLOSEOUT_B7_06.md`, `tests/m17closeRolesB706.test.ts` (14 tests) | Backend proven. Field visibility covers `deal.value` only: **accepted by Given, 11 Nov 2026** (`docs/DECISIONS.md` 9.2). The Roles screen is still on demo data and hidden (M18). |
| FIG-1189 B7.07 Swahili | `docs/M17_CLOSEOUT_B7_07.md`, `tests/m17closeSwahili.test.ts` (14), `tests/components/commercial/m17closeSwahiliSign.test.tsx` (5, 3 snapshots) | Every criterion met except "reviewed translations": **a native speaker has not reviewed the Swahili** (`TRANSLATION_REVIEW.sw` is `PENDING_HUMAN_REVIEW`). |
| FIG-1187 B7.05 deposit request | `docs/DECISIONS.md` 9.1 | **Cancelled by Given**, 11 Nov 2026. |
| FIG-1191 G3.01 security review | `docs/M17_SECURITY_REVIEW_G3_01.md`, six `tests/g301Review*.test.ts` files | An agent that did not write the code reviewed it. About 115 defences confirmed; 10 gaps found. **It is an AI code read with targeted tests, not a penetration test, and does not replace Michael's approval.** |

### The High finding, fixed

**R-1 (rule 7).** `GET /api/orgs/{slug}/reports/v2` (default report "This month against last month") showed the total "Won value" to any role holding `reporting.view.all` without `deals.view.value`, including a custom role with the deal value hidden. The report keeps money in a row, and the masking only hid money columns. Fixed in `src/services/reportsV2Service.ts`: a report can declare `valueRows`, and `assemble` blanks every figure on those rows and reports `valueMasked: true`. The CSV export builds from the same function. The reviewer's `it.fails` test is now a passing test, the route crawl no longer excuses this route, and a service test checks both the masked role and Management (not over-masked).

### Open findings (not fixed, for Given and Michael)

| ID | Severity | What | Where it stands |
|---|---|---|---|
| W-1 | Medium | A webhook endpoint is built "as its creator" only for deal values. Contact, lead, company and task payloads go out whatever the creator's role is now. | `it.fails` test in `tests/g301ReviewWebhooks.test.ts`. Needs a decision. |
| P-1 | Medium | The public API pages every record the token owner may view (100 per call, 120 calls per minute) with no export permission, approval or audit entry. The 500-row cap and `export.bulk` are bypassed. Browser lists behave the same way. | Decision for Michael. |
| A-1 | Low | The per-address API limit uses the first `X-Forwarded-For` entry, not the trusted-hop entry. | `TRUSTED_PROXY_HOPS` is set on Vercel production (name seen; value not read). Not fixed. |
| S-1, S-2 | Low | The schema owner role can approve and open a support grant at the database level; `support_access_open` takes the window start from the caller. | Needs a migration. Not fixed. |
| G-1 | Low | With no readable client address every per-address limit is skipped. | Production sets `TRUSTED_PROXY_HOPS`. |
| E-1, SC-1, H-1 | Low | Signer name accepts bidi-override characters; a token with `activities:read` reads timelines without record scopes; two rarely used IPv6 ranges not blocked by the SSRF guard. | Not fixed. |

Each `it.fails` test carries a `FINDING` comment; when a gap is fixed, change `it.fails` to `it`.

### Sign-off (12 Nov 2026)

- **Swahili (FIG-1189):** reviewed and approved by a native Swahili speaker (Given). `TRANSLATION_REVIEW.sw` is `COMPLETE`.
- **G3.01 (FIG-1191):** Given signed off on Michael's behalf, as for `backend-v1`. Michael has not signed himself. Given knew at sign-off that the review was an AI code read, not a penetration test, and that W-1 and P-1 (Medium) and the Low findings are open and accepted for now. No Urgent or High bug is open (R-1 was fixed).
- The `backend-v2` tag is not placed: it needs Given's separate word.

### Still open (human steps, not done)

- Michael's own approval (Given signed on his behalf), and the `backend-v2` tag (tags are placed only when Given asks).
- A real independent security review or penetration test of the public endpoints.
- Confirm on AWS that the owner role bypasses RLS.
- Wiring the V2 screens to these routes (M18).

### Verification

`npm run typecheck` and `npm run lint` clean. The full suite runs in CI on the pull request (six shards). The new files were run alone on their own databases: B7.01 16 of 16, B7.06 14 of 14 (with the existing role tests, 44 of 44), B7.07 14 of 14 and 5 of 5, the six review files plus the existing public API, signature and role tests 187 passed and 10 expected failures.
