# Unused pages and dead routes: inventory (FIG-1593, P2-10)

Status: INVENTORY ONLY, written 16 Nov 2026 on branch `makeover/m19-p2-21-27`. Nothing has been deleted, moved or edited. **Nothing may be deleted until Given confirms the exact list in section 1 in writing (rule 4).**

## Done on 16 Nov 2026 (Given: "CONFIRM P2-10", delete all)

Given confirmed in writing. The section 1 list holds **52 files** (the "54" above was a miscount; the table in 2.1 also adds up to 52). Deleted, all still in git history (last touching commits in the table in 2.1):

- the 52 files of the orphan cluster (section 1 list);
- ASK #2 `src/ui/screens/team/index.ts` (unused barrel);
- ASK #7 `public/brand/*.svg` (5 files) and ASK #8 `public/figbloom-logo.jpg` (tracked, so recoverable from git: last commit f0c0941 and e83f461). If the logo work (P2-06, P2-07) wants the brand set, restore it from those commits;
- ASK #10, #11, #12 untracked files `scratch_e4.js`, `perf-v11-results.json`, `tsconfig.w2.tsbuildinfo` and `tsconfig.tsbuildinfo` (not in git, so not recoverable; build caches and a perf output).
- 33 entries for the deleted files were removed from `excludedFiles` in `.eslintrc.json` (the guard in `tests/uiGuards.test.ts` requires the list to shrink). The glob patterns in that file were left alone.

**Not deleted, although "delete all" was said, because deleting would break the build or breaks the issue's Must-keep rule:** ASK #1, #3, #4 (V2 pages and screens, hidden by flag but still imported or served), #5, #6 (demo data that live code and tests still import), #9 (`@types/bcryptjs`: `package.json` carries someone else's uncommitted edit), #13 (test and config entry points that knip cannot see), #14 (`design-spec/` is off limits; each script is named in a runbook or test).

**Checks after deleting:** typecheck clean; lint clean; `npm run build` and `npm run check:build-output` pass; route list before and after identical (493 routes, none removed, none added), as expected because only components were deleted; component test project 89 files, 902 tests pass; `uiGuards`, `frozenAuthSource`, `e2eTraceability`, `apiContract` pass. Not done: the full suite again, a link check on the built routes, and the new test that every route is reachable from navigation (no route changed, and the evidence is in section 3).

## How this was made

| Step | Method |
|---|---|
| Routes | File tree of `src/app`: 71 pages and 487 API route files. For each, searched `src`, `tests`, `e2e`, `docs`, `scripts`, `ops`, `config` and `vercel.json` for the URL (href, router.push, fetch, template strings, tests, contract files). `next.config.js` has no redirects or rewrites; `vercel.json` only lists the three cron routes. |
| Unused code | `npx knip@5` (default config, no custom entry points, read-only). Result cross-checked with a grep for import paths and for each file name in `tests`, `e2e`, `docs`, `scripts`. |
| Not run | `ts-prune` and `depcheck` were not run (knip covers both). Knip does not read CSS, so CSS was checked by grep for the file name (all 28 CSS files are imported). The build and its route list were NOT run (a preview server uses `.next-preview`); the before and after route list comparison belongs to the deletion step. |
| Left out on purpose | Knip's "unused exports" (236 values, 286 types) are not candidates: too noisy, low value, and some belong to the typed API contract. |

## 1. Summary and the list Given should confirm

| Verdict | Count | Notes |
|---|---|---|
| DELETE | 54 files (about 6,040 lines) | One orphan cluster of pre-makeover components under `src/app/o/[orgSlug]/` and `src/components/`. Section 2.1. |
| ASK | 14 items | Section 2.2. |
| KEEP | everything else | All 71 pages, all 487 API routes, 14 scripts, demo folders, public assets in use, dev-only things. Section 3. |

**No page and no API route is proposed for deletion.** Every page is linked from navigation, code, tests or docs. Every API route is in the frozen V1 contract, the operations files, or the public `/api/v1` API with tests. The dead code is components, not routes, so no redirects are needed (scope step 4 does not apply).

### Exact list for Given to confirm (DELETE, 54 files)

Reply in writing, for example "CONFIRM DELETE section 1 list" (or strike lines you want kept).

- `src/app/o/[orgSlug]/LogoutButton.tsx`
- `src/app/o/[orgSlug]/_shared/`: `AccountDrawer.tsx`, `AccountRowActions.tsx`, `ActivityTimeline.tsx`, `AuditHistory.tsx`, `CommunicationTimeline.tsx`, `NoAccess.tsx`, `OwnerChip.tsx`, `OwnerControl.tsx`, `ThemeToggle.tsx`, `accountCapabilities.ts`
- `src/app/o/[orgSlug]/companies/`: `CompanyRefs.tsx`, `CompanyRowActions.tsx`, `CompanyServicesSection.tsx`, `CreateCompanyForm.tsx`, `[companyId]/EditCompanyForm.tsx`
- `src/app/o/[orgSlug]/contacts/`: `ContactRefs.tsx`, `ContactRowActions.tsx`, `CreateContactForm.tsx`, `[contactId]/EditContactForm.tsx`
- `src/app/o/[orgSlug]/deals/`: `CreateDealForm.tsx`, `DealCardActions.tsx`, `dealCapabilities.ts`, `[dealId]/AssignDealControl.tsx`, `[dealId]/EditDealForm.tsx`, `[dealId]/ProposalReferences.tsx`
- `src/app/o/[orgSlug]/leads/`: `AssignLeadControl.tsx`, `CreateLeadForm.tsx`, `EditLeadDrawer.tsx`, `FilterComboField.tsx`, `LeadRefs.tsx`, `NoLeadAccess.tsx`, `leadCapabilities.ts`, `[leadId]/ConvertLeadControl.tsx`, `[leadId]/EditLeadForm.tsx`
- `src/app/o/[orgSlug]/settings/`: `InviteMemberForm.tsx`, `MembersTable.tsx`, `NotificationPreferencesForm.tsx`, `OrganizationProfileForm.tsx`, `RegenerateInboundEmailKeyButton.tsx`, `RegenerateWebsiteKeyButton.tsx`, `RevokeInboundEmailKeyButton.tsx`, `RevokeWebsiteKeyButton.tsx`, `WebsiteAcknowledgementToggle.tsx`, `WebsiteAssignmentModeToggle.tsx`, `WebsiteLeadAssignmentRulesEditor.tsx`, `WebsiteSecuritySettingsForm.tsx`
- `src/app/o/[orgSlug]/tasks/`: `CreateTaskForm.tsx`, `EditTaskDrawer.tsx`, `taskTypes.ts`
- `src/components/`: `ImportCsvForm.tsx`, `csvHeaderPreview.ts`

Also tell us KEEP or DELETE for each ASK item in section 2.2.

## 2. Candidates

### 2.1 DELETE: orphan cluster of pre-makeover components

**Evidence.** Knip reports all 54 as unused files. Every import of these files comes from another file in the same list (import-path grep): for example `CompanyRowActions` imports `AccountDrawer`, `AccountRowActions`, `CompanyRefs` and `EditCompanyForm`; `EditLeadDrawer` imports `LeadRefs` and `EditLeadForm`; `NoLeadAccess` re-exports `_shared/NoAccess`; `CreateTaskForm` and `EditTaskDrawer` import `taskTypes`; `ImportCsvForm` imports `csvHeaderPreview`. No live page, test (`tests/`, `e2e/`) or script imports any of them. Other mentions are prose only: `docs/M8_CONTACTS.md`, `docs/M9_SETTINGS.md`, `docs/DATA_MIGRATION.md` (names, not links). `NoAccess` and `OwnerChip` are also names in `@/ui`; the tests that mention them import the `@/ui` versions. These forms were replaced by `src/ui/screens/*` in M7 to M9; the live `page.tsx` files render the new screens. Same-folder files that ARE still imported (`Combobox`, `ArchiveControl`, `MergeControl`, `TaskSection`, `icons` in `_shared`; `CatalogEditor` in settings) are not on the list.

| Folder | Files | Latest commit touching the candidates |
|---|---|---|
| `src/app/o/[orgSlug]/` (LogoutButton) | 1 | d38f6ba, 2026-09-30 |
| `.../_shared/` | 10 | af11835, 2026-10-22 (oldest e93138f, 2026-09-24) |
| `.../companies/` | 5 | af11835, 2026-10-22 |
| `.../contacts/` | 4 | af11835, 2026-10-22 |
| `.../deals/` | 6 | af11835, 2026-10-22 (oldest 0b4780f, 2026-09-24) |
| `.../leads/` | 9 | af11835, 2026-10-22 (oldest 0843b95, 2026-10-05) |
| `.../settings/` | 12 | ca03a27, 2026-10-23 (oldest bb7f890, 2026-09-26) |
| `.../tasks/` | 3 | af11835, 2026-10-22 |
| `src/components/` | 2 | 121968a, 2026-10-03 |

All last changes are before 24 Oct 2026, before the makeover screens replaced them. Per-file hash: `git log -1 -- <file>`. Deleted files stay in history at those commits.

Risk: a hidden string or dynamic import would fail typecheck or the build; that is the check after deletion.

### 2.2 ASK (14 items)

| # | Path | Evidence | Last commit | Why ASK |
|---|---|---|---|---|
| 1 | `src/ui/screens/commercial/SignPreviewDialog.tsx` | Knip: unused, no importers | 38b362a, 2026-10-29 | E-signature is V2, hidden (MVP-13), parked per `docs/RESTRUCTURE_LOG.md` (FIG-1193). Must-keep rule. |
| 2 | `src/ui/screens/team/index.ts` | Knip: unused barrel; the page imports the screen directly | cf5eee8, 2026-11-13 | Fresh M19 work; harmless. |
| 3 | `src/app/sign/[token]/` (page, `SignClient.tsx`, `demoSigning.ts`) | Page is live (plain "link not available" while V2 is hidden); tests and docs name it | cd16777, 2026-11-09 | V2 page hidden by flag. KEEP unless Given says otherwise. |
| 4 | `src/ui/screens/settingsplus/Roles.tsx`, `Developers.tsx`, `settingsplus/demo/` | `docs/RESTRUCTURE_LOG.md` (FIG-1194): parked for V2; still imported by `settingsplus/index.tsx` and tests | 230fe85, 2026-11-06 | V2, hidden. Must-keep. |
| 5 | `src/ui/screens/commercial/demo/` (`data.ts`, `store.ts`) | Still imported by settingsplus data and `tests/components/commercial/*`; the log (line 167) says they stay | 38b362a, 2026-10-29 | Clean-up belongs to the wiring work, not P2-10. |
| 6 | `src/ui/screens/platform/demo/local.ts` | Imported by `platform/api.ts`, `logic.ts`, `model.ts`, `store.tsx` and tests (flags, announcements, support: V2) | 2eebb33, 2026-11-05 | Live code, not dead. |
| 7 | `public/brand/*.svg` (5 files) | No reference by name in `src`, `e2e`, `tests`, `scripts`, `docs`, `config` | f0c0941, 2026-11-01 | Brand asset set from the design; unreferenced but may be wanted. |
| 8 | `public/figbloom-logo.jpg` | No references | e83f461, 2026-09-25 | Probably the old logo; confirm nothing external links `/figbloom-logo.jpg` on the live domain. |
| 9 | `@types/bcryptjs` (devDependency) | Knip: unused; `bcryptjs` 3 ships its own types | package.json | Report only. `package.json` carries someone else's uncommitted edit, so do not touch it now. |
| 10 | `scratch_e4.js` (root, untracked) | Not in git, no references | none | Not recoverable from git if deleted; owner decides. |
| 11 | `perf-v11-results.json` (root, untracked) | Not in git; output of a perf run | none | Same; may be wanted as evidence. |
| 12 | `tsconfig.w2.tsbuildinfo` (untracked), `tsconfig.tsbuildinfo` | Build cache | none | Suggest `.gitignore`, not deletion, and not part of this issue. |
| 13 | `tests/perf/*.perf.ts`, ten `vitest.*-components.config.ts` and `vitest.perf.config.ts` | Knip lists them as unused; they are entry points for separate configs and docs | various | Knip false positive. KEEP. |
| 14 | `design-spec/**` (4 JS files flagged by knip), `scripts/*.ts` (14 flagged) | `design-spec/` is off limits by the issue; each script is a CLI named in docs (`RUNBOOKS`, `DATA_MIGRATION`, `PRIVACY`, `MIGRATION_REHEARSAL`) or tests | various | KEEP. |

## 3. KEEP (with the evidence)

### 3.1 Pages (71, all KEEP)

| Area | Pages | Evidence and notes |
|---|---|---|
| Frozen auth | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite` | Guards `tests/frozenAuthSource.test.ts`, `e2e/frozen-auth.spec.ts`. |
| New auth steps | `/two-step`, `/two-step/setup`, `/platform/sign-in`, `/platform/verify`, `/platform/accept-invite` | Linked from the sign-in flow and tests. |
| Dev-only | `/dev-sentry-test` (+ `/api/dev-sentry-test`), `/o/[orgSlug]/dev/gallery` | Rule 10. Named in `e2e/smoke/production.spec.ts` (must 404 in production), `e2e/ui-gallery.spec.ts`, `src/api/accountOperations.ts`, `docs/DESIGN_SYSTEM.md`. Last commits 76adafb (2026-10-29), 570eec9 (2026-10-27). |
| Sales | leads, deals, handoffs, tasks, calendar, search, notifications, home | `src/ui/shell/navigation.ts`, many tests. |
| Customers, finance | companies, contacts, conversations, merge, renewals, payments, reports | Navigation and tests. |
| Settings and others | settings, preferences, team, help, help/whats-new, suspended | `suspended` has no link: `src/app/o/[orgSlug]/layout.tsx` serves it for suspended organisations (B6.05); 3 tests. |
| V1.1 | approvals, quotes, quotes/[dealId], forecast, chat, mail, video | Navigation (Communication group) and `e2e/m10-communication.spec.ts`. |
| Mobile | `/o/[orgSlug]/m` and `alerts`, `customers`, `leads`, `pipeline`, `record/[type]/[id]`, `sync`, `tasks` | `/m/pipeline` has no code link; it is reached from the tab bar mapping and named in `docs/M9_MOBILE.md` and `e2e/qa/catalogue.ts`. |
| Platform console | admins, announcements, audit, data-requests, flags, health, organisations (+ new, [id]), preferences, security, support-access, `/platform/m/*` | Flags, announcements and support-access are V2, hidden by flag (`e2e/platform-console.spec.ts`, `tests/components/navigation/navLinks.test.tsx`). |
| Public | `/sign/[token]` | V2, hidden; ASK item 3. |

### 3.2 API routes (487 route files, all KEEP)

Method: each `route.ts` path was normalised (`[x]` and `${x}` to `*`) and matched against every `/api/...` string in the repo.

| Result | Count | Meaning |
|---|---|---|
| Called from UI code, and in the contract | 442 | In use. |
| No static UI caller | 45 | 34 are in the contract or operations files with docs or tests (platform console actions built from dynamic URLs, V2 support-access, two-step management, OAuth callback, public form key); 8 are public API v1 routes covered by tests; 3 are `/api/v1/{contacts,leads,tasks}/[id]`, which share the v1 handlers (`src/api/publicApi/handlers.ts`). |

The 18 routes named only in contract and operations files (no UI, test or doc string): `/api/me/trusted-devices/[deviceId]`, `/api/me/two-step/backup-codes`, `/api/me/two-step/disable`, `/api/platform/admins/[adminId]/{recovery-link,reinstate,suspend,two-step-reset}`, `/api/platform/data-requests/[requestId]` with `cancel`, `certificate`, `decision`, `delete`, `retry-export`, `/api/platform/health/incidents/[incidentId]/resolve`, `/api/platform/organizations/[organizationId]`, `/api/platform/support-access/[grantId]/{end,open,read}`. They back demo screens not yet wired (`docs/RESTRUCTURE_LOG.md`) or V2. The frozen contract lists them, so deleting them is a contract change. KEEP.

Cron routes (`/api/cron/jobs`, `notifications-sweep`, `platform-maintenance`) are in `vercel.json`. Health, `dev-session` (dev only, rule 10), `openapi.json`, inbound email and web form routes are external callers named in docs. KEEP.

### 3.3 Other KEEP findings

| Item | Evidence |
|---|---|
| `public/sw.js`, `public/offline.html`, `public/icons/*` | Service worker (M9, header in `next.config.js`), manifest and icons referenced. |
| `pino-pretty` (devDependency) | Knip flags it, but `src/lib/logger.ts` loads it by name as a transport target. |
| Unused npm dependencies | Knip: none in `dependencies`; only `@types/bcryptjs` (ASK 9). |
| CSS | All 28 `.css` files under `src` are imported. |
| Seeds, migrations, `design-spec/` | Out of scope by the issue. |
| Dev sign-in chips, Dev Super Admin, `npm run preview` support | Rule 10. |

## 4. Plan once Given confirms

1. Record the route list of a fresh build (before). Not done in this inventory step.
2. Delete only the confirmed files. Update the three docs that mention them by name.
3. Typecheck, lint, full suite (about 25 minutes), `npm run build`, `npm run check:build-output`; the route list must be unchanged (no route is deleted).
4. Add the issue's test: every route in the build is reachable from navigation, a redirect, or an allow-list file with a reason. Starting allow-list: `/dev-sentry-test`, `/o/[orgSlug]/dev/gallery`, `/o/[orgSlug]/suspended`, `/o/[orgSlug]/m/pipeline`, `/sign/[token]`, the V2 platform pages, and the API-only routes in section 3.2.
5. No redirects needed (no route is removed).
