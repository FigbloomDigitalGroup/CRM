# M17 close-out: FIG-1183 (B7.01) support access, break-glass

Independent check of the builders' work (docs/M17_LANE_A_SUPPORT_FLAGS_ANNOUNCEMENTS.md, docs/M17_GATE_G3_01.md). Facts only.

Acceptance criterion: "No access without approval; expires automatically; everything logged."
Code: `src/services/supportAccessService.ts`, migration `prisma/migrations/20261121110000_support_access/migration.sql` (table, trigger `support_access_grants_guard`, function `support_access_read` and six more), routes under `src/app/api/platform/support-access/` and `src/app/api/orgs/[orgSlug]/support-access/`, job `support_access.expire` in `src/jobs/definitions.ts`.
Tests: existing `tests/supportAccess.test.ts` (SA, 20 tests); added `tests/m17closeSupportAccess.test.ts` (M17C, 16 tests).

## Verdict table

| Scope / criterion | Implemented in | Proving test | Verdict |
|---|---|---|---|
| Request by a platform admin | `requestSupportAccess`, `support_access_request()`; route needs `platform.support.request` and a fresh second step | SA "a request is its own record..."; SA "one open request per organisation..."; SA "the routes" | Proven |
| Approval by organisation Management | `decideSupportAccess` (`security.manage`), trigger: PENDING to APPROVED/DENIED only for the tenant role | SA "only Management decides..."; M17C "a state cannot be forged" (tenant role cannot skip PENDING or APPROVED to ACTIVE; platform role cannot write the table) | Proven |
| No access without approval, every state | `support_access_read()` requires ACTIVE + opener identity + clock window + org ACTIVE + scope | M17C "is refused in every state except ACTIVE" (requested, denied, request lapsed, withdrawn, approved-not-opened, approved-stale, ended, window over; all 5 resources; via service and via the DB function; no page view; refusal audited); SA R2 tests | Proven |
| Only the requesting admin can open or read; one admin cannot use another's grant | `openSupportAccess` check, `support_access_open` WHERE requester, read function checks `opened_by_identity_id` | SA "opens for exactly the approved minutes, only for the admin who asked"; M17C "cannot be turned into a session by a different platform admin"; M17C "an admin's grant on B cannot read A" | Proven |
| Scope | `scope` CHECK, read function `OUT_OF_SCOPE` | SA "refuses a kind of record outside the approved scope" | Proven |
| Expiry (automatic, no action) | window compared at read time in SQL; `effectiveStatus`; job only tidies | SA "refuses reads the moment the window ends..."; M17C "the clock refuses reads, the banner and the history show it expired, and nothing needs the job" (row still ACTIVE in the table, reads refused, banner null, history EXPIRED, org end/open refused, job writes both audits once); M17C "approval unopened for an hour / request 24 hours" | Proven |
| Active-banner data | `getSupportBanner` | SA "R9: the banner"; M17C asserts the banner is empty after clock expiry and after end, and that Sales sees no reason or ticket | Proven |
| End early | `endSupportAccess` (platform), `endSupportAccessByOrganisation` | SA "ending early" (3 tests); M17C "ending early is immediate and logged" (both sides: next read refused, no new page view, audit rows once, double end writes nothing); org withdraws an approval before opening | Proven |
| Masking of sensitive values | read function names columns; no value, currency, notes, custom fields, payment, cost or margin; emails and phones masked unless unmask requested | SA R4 and R5; M17C "never returns money, notes or custom fields for any resource, with or without unmasking"; odd email and phone forms | Proven. Payments and invoices are not seeded in the test (see "Not run") but the function selects only from companies, contacts, leads, deals, tasks and the platform role has no privilege on `invoices` / `payment_records` (M17C privilege test) |
| Platform DB role cannot read grant tables or tenant rows | no privileges for `figbloom_platform`; only EXECUTE on seven functions | SA "the platform database role has no privilege..."; M17C "has no SELECT, INSERT, UPDATE or DELETE on grants, page views, tenant records, memberships or audit" (13 tables) | Proven |
| Page-view log visible to the organisation (Management only) | `getOrganisationSupportAccess` (`security.manage`), RLS on `support_access_page_views` | SA R7; M17C "Management of the organisation reads it; other roles, other organisations and RLS do not" (Sales and Finance forbidden, other organisation 404 and zero rows by RLS, tenant role cannot update or insert a log row); M17C route test (200 / 403 / 404) | Proven |
| Everything logged | page view row inside the read function; platform audit per request, open, end, cancel, read, refused read, approve, deny, expire; organisation audit per lifecycle step | SA R7; M17C "writes the lifecycle to the organisation's audit and to the platform audit, and one page-view row plus one audit row per read" (incl. deny and withdraw); M17C "carry the reason and ticket and never customer data" | Proven |
| Cross-organisation (rule 8) | RLS on both tables, org id in every query, read function sets context from the grant | SA R6 and R12; M17C "another organisation's Management cannot decide, end or list this grant" | Proven |
| Page views cannot be edited or removed | trigger `support_access_page_views_append_only`, no privileges | SA R7 (owner update and platform/tenant delete); M17C (tenant insert/update refused, platform insert/update/delete refused) | Proven |
| Design refs PL7, OS2, OS3, OS4 | Backend only; screens are demo data until wired (lane A note) | none (UI) | Not part of this backend close-out; wiring is M18 |

## Tests added

`tests/m17closeSupportAccess.test.ts`, 16 tests, all pass (60 s, own database `figbloom_crm_test_a`):

1. refused in every state except ACTIVE, no page view, refusal audited
2. a state cannot be forged (platform role writes; tenant role skipping approval; rewriting scope; deleting)
3. approved request cannot be opened by a different platform admin (service and DB function)
4. expiry by the clock alone (reads, banner, history, org end, open, job)
5. approval left unopened one hour (service and DB function)
6. ending early, platform and organisation, immediate and logged
7. organisation withdraws an approval before opening
8. platform role has no privilege on 13 tables
9. no money, notes or custom fields in any resource, masked and unmasked
10. odd email and phone masking
11. a grant reads only its own organisation, across two admins and two organisations
12. page-view log visible to Management only, RLS for others
13. same through the organisation routes
14. lifecycle and per-read audit counts
15. audit entries carry reason and ticket, no customer data
16. cross-organisation decide, end, list, banner

Also re-ran `tests/supportAccess.test.ts`: 20 of 20 pass.

## Bugs fixed

None. No product code was changed.

## Observations (not changed, for the lead or Given)

1. Any platform admin holding `platform.support.request` can end or withdraw another admin's request or session (`endSupportAccess` does not check the requester). Opening and reading are requester-only. Ending only reduces access, so it is probably intended; it is a product decision whether it should be requester-only. Not decided here.
2. A request that the clock has lapsed but the job has not yet marked EXPIRED still occupies the "one open request per organisation" index until `support_access.expire` runs (every 5 minutes). Worst case a new request waits about 5 minutes. Read access is never affected. I did not test the interval before the job runs.
3. R10 (declared-outage access) is not built (builders' note); it is outside the issue's stated scope.
4. docs/DECISIONS.md decision 7.1 (Given): V2 is out and hidden for the MVP, which includes support access. Whether FIG-1183 is marked Done for a feature that is hidden in the MVP is Given's call.
5. The independent security review and Michael's approval named in docs/M17_GATE_G3_01.md are human steps and are still open; this document is a test-based check, not that review.
6. The functions rely on the owner role bypassing RLS (docs/M17_GATE_G3_01.md item 4: confirm on AWS).

## Not run

- Full suite, Playwright, any server, the UI screens (PL7, OS2 to OS4 are demo data).
- Payment and invoice rows were not created in the test world; payment protection is shown by the function's fixed table list and the platform role's missing privileges.
- `npm run typecheck`: one error, in a different agent's file (`tests/m17closeRolesB706.test.ts(164,7)`: expected 3 arguments, got 2). No error in my file. `npx eslint tests/m17closeSupportAccess.test.ts`: clean.
