# FIG-1188 (B7.06) close-out evidence, 11 Nov 2026

Branch `makeover/m17-closeout`. Database `figbloom_crm_test_b` only. Nothing committed, no Linear changes.

## Verdict table

| Criterion | Code | Proving test | Verdict |
|---|---|---|---|
| Custom roles | `roleEditorService.createRole/updateRole/archiveRole`, routes `src/app/api/orgs/[orgSlug]/roles/**`, migration `20261124090000_custom_roles` | `roleEditor.test.ts` "creates a role from a platform role..."; `roleMatrixLive.test.ts` "creates, previews, edits, assigns and archives through the handlers" | Proven |
| Permission editing within limits | `src/lib/roleLimits.ts` (reserved keys, view-before-change), `checkProposal` | `roleEditor` "refuses reserved keys, payments, a missing view right..."; new "audit, bulk export, payments, margin and every organisation-running key are refused on create, update and preview (service and routes)" (every reserved key, 6 entry points) | Proven |
| Field visibility rules (built, enforced) | `FIELD_CATALOGUE`, `role_field_rules`, `resolveActiveMembership` -> `ctx.hiddenFields`, read in `canSeeDealValue` (`src/auth/masking.ts`), `quoteService.presentVersion`, `dealService` summary, `dealRuleService` board, `customerReportService` | `roleEditor` "shows the value as the field rule says: all, own, or hidden even from the owner" (maskDeal, getDeal, listDeals); `m17closeRolesB706` "a field rule change shows on the next request" | Built and tested, but narrow (see gaps) |
| Safeguard: last Management cannot be locked out | `assertNotLastActiveManagement` in `membershipService` (change role, deactivate, remove); custom roles cannot hold admin keys | `roleEditor` "still refuses to move the last Management member away"; new "edit role, archive role, reassign, deactivate and remove all leave the last Management able to manage"; "once a second active Management exists..." | Proven |
| Platform roles read-only | `loadCustomRole` -> `PLATFORM_ROLE_FIXED` | `roleEditor` "fixes the platform roles"; new "every platform role refuses edit and archive through the routes" | Proven |
| Audit | `recordAuditEvent` on create/update/archive; `membership.role_changed` | `roleEditor` "takes effect on the very next request, and an edit is audited..."; new "create, update (permissions, field rule, name), and archive are each audited with the actor; a refused change writes nothing" | Proven |
| Preview of effect | `previewRole`, route `POST /roles/preview` (gained, lost, scopes per family, field rules before/after, people, warnings, writes nothing) | `roleEditor` "describes the change without writing anything", "warns, and answers an invalid proposal the way saving would"; `roleMatrixLive` route preview | Proven (service plus route) |
| Rule 8: cross-organisation | `findAssignableRole`, RLS on `roles`/`role_field_rules`, `loadRoleRows` filter | `roleEditor` "hides one organisation's custom roles..." (service and DB); new "cross-organisation role ids are refused on every route..." (GET/PATCH/DELETE/preview 404, list hides, assignment unknown), "a member whose row points at another organisation's role resolves to nothing", invite with foreign role refused | Proven |
| Changes take effect immediately | `resolveActiveMembership` reads the role per request (no cache); `invalidateMeContext` on every write | Builders: service-level resolve. New: through real route handlers, member re-resolved from the DB before each call: permission removed -> 403 with denial on next request, added -> 200, all removed -> 403; PATCH made through the route handler is effective for the next request | Proven |
| Matrix tests generated from live roles pass | `tests/roleMatrixLive.test.ts` builds the matrix from `listRoles` (platform + custom), 7 real handlers per role | that file, all green under `ACTIVE_RELEASE=v1` | Proven for the live matrix. The reviewed golden snapshots (`accessMatrix*.json`) were not re-run (see below) |
| Rule 7 (audit, bulk export, payments, margin never on a custom role) | `ADMIN_RESERVED_KEYS`, `SENSITIVE_RESERVED_KEYS` | as above; new "a role made from Management or Finance starts without the reserved keys" and "a custom role holder is refused the payments, audit and roles routes" | Enforced and tested. Policy unchanged |

## Tests added

`tests/m17closeRolesB706.test.ts`, 14 tests, all pass:

- changes take effect on the very next request (3): permission removed/added via routes; field rule change; PATCH via handler.
- last Management (3): every path; two Managements; invite with foreign role.
- platform roles and reserved powers (4): platform roles read-only via routes; reserved keys on create/update/preview via service and routes; created-from-platform roles start clean; custom holder refused payments/audit/roles routes.
- rule 8 (3): cross-organisation ids; foreign role row resolves to null; same name in two organisations.
- audit (1).

## Bugs fixed

None found. No product code changed.

## Gaps and open points

1. Field visibility covers one field only: `deal.value` (all / own / hidden). Margin and payments are fixed hidden. The builders' note says contact phone etc. need a masking surface first. If Design S8#2 expects further fields (for example contact phone or lead source), that is a real scope gap: size roughly 2 to 3 days per field (masking helper, `FIELD_CATALOGUE` entry, enforcement on every read path, export, search, tests). Proposed approach: add the field to `FIELD_CATALOGUE`, give it a `canSee<Field>` helper in `src/auth/masking.ts` next to `canSeeDealValue`, carry it in `hiddenFields`, then mask in the DTO mappers. Needs Given to confirm scope.
2. Hidden `deal.value` is enforced through `canSeeDealValue`, `maskDeal` and four sites with their own owner exception. Exports use `listDeals` (masked). Search and notifications contain no deal value reading outside those helpers, as far as a grep of `src` shows; I did not write a dedicated test for hidden value in export, search, notification text, chat card or mail panel. Those paths call `canSeeDealValue` (chat, mail, attachments, comments) so they follow the rule, but are not tested for the hidden case.
3. Not tested for the hidden case: `reportingService`, `reportsV2Service`, `forecastService` rely on `deals.view.value` only (hidden removes that key, and own-only exceptions use `hiddenFields` in `customerReportService`, `dealRuleService`); the salesperson-report path is covered by builders' notes only.
4. Product questions: custom roles can never hold audit, bulk export, payments, margin (decision 5 in the lane D note, G3.01 item 5): enforced and tested, awaiting Given's confirmation. AWS owner role must bypass RLS for `roles` writes (G3.01 item 4).
5. Reviewed golden matrices `src/api/contract/accessMatrix.json` and `accessMatrixV11.json` mention roles routes (8 matches each); I did not run `apiWalk*.test.ts` (long) and did not regenerate snapshots.

## What I ran

All with `TEST_DATABASE_URL` / `TEST_APP_DATABASE_URL` pointing at `figbloom_crm_test_b`:

- `ACTIVE_RELEASE=v1`: `tests/m17closeRolesB706.test.ts`, `tests/roleEditor.test.ts`, `tests/roleMatrixLive.test.ts`, `tests/accessMatrixV11Rules.test.ts`: 4 files, 44 tests passed. (Under `ACTIVE_RELEASE=v2`, `roleMatrixLive` "below V2" test fails because the organisation is then at V2 already; the lane note documents that this file needs v1.)
- `npm run typecheck`: clean. `npx eslint tests/m17closeRolesB706.test.ts`: clean.

Not run: `apiWalk*.test.ts`, `apiContract.test.ts`, the full suite, Playwright, any server. No UI check of the editor screen (S8#2) was done; the screen may still be on demo data (see `docs/RESTRUCTURE_LOG.md`).
