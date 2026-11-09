# V1.1 test report (M16: Q2.01 to Q2.05, FIG-1179 to FIG-1182, FIG-1386)

Written 9 Nov 2026 on branch `makeover/m16-v11-qa`. Facts only. Anything not run, or that needs a person, is listed as such. **The V1.1 release gate is not passed** (section 7).

## 1. What was found first

The V1.1 journeys named in the Screen Checklist existed as files, but they were **not passing, and CI was not running most of them**.

- `commercial`, `engage-tools` and `m10-communication` skipped themselves unless `E2E_DEMO_SCREENS=true`. M14 (9 Nov) removed the demo-screens switch from the app, so that flag does nothing, CI never sets it, and the specs had been skipped in CI ever since. `m10-orgside` skipped its switcher test unless `E2E_RELEASE_V11=true`. `platform-console` and `mobile-platform` skip on any production build (the dev Super Admin works only when `NODE_ENV=development`).
- Run against a server where they could run, 19 of 38 failed. The specs still described the demo screens (demo names such as "Ruth Kibet", the demo signing tokens, the V2 API-token editor, a Connect button that completes with no provider). They were stale, not the app broken.
- Rewritten on the real screens: `platform-console`, `mobile-platform`, `commercial`, `engage-tools`, `m10-communication`, `m10-orgside` (gates removed, so the standard e2e server runs them). Added: `v11-settings`, `qa/v11-a11y`, `qa/v11-visual`, and the trace map `V11_TRACE` with `tests/e2eV11Traceability.test.ts`.

## 2. Traceability (Q2.01)

`e2e/qa/trace.ts` `V11_TRACE` maps all 29 V1.1 rows of `design-spec/TRACEABILITY.md` to journey files; `tests/e2eV11Traceability.test.ts` fails when an ID has none, or a file is missing or has no test (4 of 4 pass). That check shows the files exist, not that they pass. The journeys' own results:

| Server | Result |
|---|---|
| Production build (what CI starts), V1.1 organisation specs | pass (see section 6 for the full run) |
| `npm run dev` on port 3101, platform console, `platform-console.spec.ts` | 13 of 13 pass |
| `npm run dev` on port 3101, `mobile-platform.spec.ts` | 2 of 2 pass |
| Commercial, engage-tools, communication, org-side, v11-settings | pass on the preview and the standard builds (counts in section 6) |

**The platform console journeys cannot run on the CI server.** The console is a 404 there by design, so they skip. They run only on a dev server. A CI job that starts `npm run dev` (or a real platform identity, not the dev cookie) would be needed to run them in CI; not built. Decision for Given.

What the journeys do and do not prove (honest limits):

- Platform console journeys open every page and walk the provision wizard to its last button; the suspend dialog is opened, shown to need a reason and the exact name, and cancelled. **No journey creates, suspends or deletes an organisation**: that would change the shared dev database. The writes are covered by `tests/platform*.test.ts`. (An earlier run of the old spec did suspend "Figbloom Sandbox" in the local dev database; it was restored to Active and the platform audit log keeps the record.)
- Mail, Video Conference, Email and calendar connection and Ask Figbloom are tested in their **not-connected** state, up to the step that would leave for Google, Microsoft or the AI model. The connected paths are covered by `tests/mailSync.test.ts`, `tests/meetings.test.ts`, `tests/oauthConnections*.test.ts`, `tests/assistant*.test.ts`. **A journey with a real provider was not run.**
- Two-step sign-in: the new route and the untouched login page are tested in the browser; the code and backup-code steps are `tests/twoStep*.test.ts` (a browser cannot produce an authenticator code).
- OS1 (suspended screen): only the active-organisation side is a journey (the page sends a member home). Showing the paused screen needs a suspended organisation and is step P-4 in `docs/UAT_V1_1.md`.
- S6#2: only the catalogue editor has edit journeys; pipelines, sequences, web forms and approval rules are tested to open without error (`e2e/v11-settings.spec.ts`).

## 3. Accessibility and visual (Q2.02)

`e2e/qa/v11-a11y.spec.ts` runs axe (WCAG 2.0 to 2.2 A and AA) on every V1.1 organisation screen as Management, the two-step pages, the core V1.1 screens in dark, Ocean and 375 px, the platform console and platform mobile.

| Area | Result |
|---|---|
| Every V1.1 organisation screen, default look, Management | no serious or critical violation |
| Two-step pages | none |
| Dark, core V1.1 screens | none |
| Ocean theme, core V1.1 screens | **1 serious**: Chat, avatar initials colour contrast (D-V11-01) |
| 375 px, core V1.1 screens | none on the standard build. The first run, on the `npm run preview` build, reported a touch-target size violation on the bottom-navigation "Today" link of `/m/leads` and `/m/sync`; it did not reproduce on the standard build (D-V11-02, retracted) |
| Platform console PL1 to PL12 and platform mobile (dev server) | none |

Visual baselines: `e2e/qa/v11-visual.spec.ts` recorded 82 pictures (7.7 MB) in four looks (light, dark, Ocean, 375 px), Windows only. Re-run against them: 4 of 4 pass, so they reproduce. **Design has not approved them**, they skip on Linux until Linux baselines are recorded (same as V1, `docs/V1_QUALITY_GATE.md` line 5), and the platform console has no baselines (it needs a dev server). Not run: the manual keyboard and screen-reader pass, real-device checks, and the custom-colour contrast check beyond the existing AP4 journey.

## 4. Communication group (Q2.05)

Detail and the bullet-by-bullet evidence table: `docs/Q2_05_COMMUNICATION_QA.md`. Ten new Vitest tests (`tests/q205MailMeetingMasking.test.ts`, `tests/q205ChatAndAutomationGuards.test.ts`), 10 of 10 pass: meeting and mail masking by role, cross-organisation attempts on mail, calendar, send and meetings, chat attachment links, deal-card masking in chat, a scan showing automations have no mail path, and draft-only sequences sending nothing. Playwright journeys: `e2e/m10-communication.spec.ts` (7 tests). Needs a person: screen reader, keyboard-only, real devices.

## 5. Defects and findings (for Given)

Severity is a recommendation. Given decides.

| ID | Finding | Rule | Suggested severity |
|---|---|---|---|
| D-V11-01 | Chat avatar initials fail colour contrast in the Ocean theme (`.fb-chat__avatar > .fb-avatar`). Reproduced on both builds; it is the one failure in the full Playwright run | AA contrast | Major (serious axe violation; acceptance says none). Not fixed: the colour comes from the shared theme tokens, which the V1 baselines also use. The Ocean check in `e2e/qa/v11-a11y.spec.ts` is marked `test.fail` with this ID so CI is honest and the test flags itself when the colours are fixed |
| D-V11-02 | **Retracted.** axe reported the bottom-navigation "Today" link as too small at 375 px on `/m/leads` and `/m/sync` on the preview build only. On the standard build the same sweep passes. The preview build adds a floating "Dev sign-in" button, which is the likely cause (not verified); the tab itself is styled 44 by 52 px | AA 2.5.8 | None |
| D-V11-03 | **Free-text figures in chat are not redacted.** In an ordinary channel with no card, a typed "KES 90,000" shows to Delivery in the message list and in search (the notification for the same message is redacted) | Rule 7 | Major, needs a product decision: redact, or accept for typed text |
| D-V11-04 | **Synced mail and meeting text is shown as written** on the timeline, so a customer's quoted price is visible to any role that can open the record and has `communications.view` | Rule 7 (timelines) | Major, product decision |
| D-V11-05 | **Sequence SEND steps send mail.** `src/sequences/engine.ts` sends an approved template through `sendAndLogEmail` when Management sets a step to SEND. The issue and rule 9 say automations only draft. The rule catalogue in `src/automations/` itself cannot send | Rule 9 | Major, Given to confirm the intended reading |
| D-V11-06 | **`/api/cron/jobs` runs once a day** (`vercel.json`: `0 2 * * *`) but `docs/M13_CLOSEOUT.md` says mail and calendar sync need 5 minutes or less. `docs/VERCEL_SETUP.md` section 10 names the free-plan answer: an external caller every 5 minutes | Release | Release gate (`docs/V1_1_RELEASE.md`, row 9), owner Given |
| D-V11-07 | `e2e/smoke/production.spec.ts` covers V1 screens only and still lists a Customer Support role removed by decision 12. No V1.1 step | Release | Minor (a manual V1.1 smoke list is in `docs/V1_1_RELEASE.md`) |
| D-V11-08 | CI never ran the V1.1 journeys (section 1). Fixed here by removing the gates; the platform console specs still skip in CI | Process | Fixed, remainder noted above |
| D-V11-10 | **CI on `dev-given` has been red since PR #34 (M15).** Four G2.01 and G2.02 files (`apiWalkV11`, `platformTenantDenialV11`, `tenantAttackV11`, `v11PermissionDenial`) need the deployment release at V1.1 or later, and CI has no `.env` to set `ACTIVE_RELEASE`. Unit shards 3 and 6 failed with `catalogue item` missing, and the final gate failed. #34 merged anyway because `dev-given` has no required checks. **Fixed**: `tests/helpers/worldV11.ts` sets `ACTIVE_RELEASE` to v2 when it is unset (same convention as `tests/chat.test.ts`); no assertion or reviewed matrix was changed. Run without the variable set: `tenantAttackV11` 11 of 11, `platformTenantDenialV11` 5 of 5, `v11PermissionDenial` 7 of 7, `apiWalkV11` 7 of 7 | Process | Fixed here; CI itself not re-run yet |
| D-V11-11 | **One cell of the reviewed authorization matrix is intermittent.** `apiWalkV11` "equals the reviewed matrix" failed in 2 of 4 runs with one difference, `PUT /api/orgs/{orgSlug}/pipelines/{pipelineId}/stages/{stageId}/rules: reviewed ADDDD, now VDDDD` (Management reviewed as allowed, sometimes answers a validation refusal). Passed in the other two. Cause not found; neither the test nor the matrix was changed | G2.01 | Open, for the G2.04 review. Needs a look at how the walk builds that request body |
| D-V11-09 | `assistant.enabled` is off by default per organisation, so "Ask Figbloom" is not in the top bar for a new organisation until Management switches it on | Product | Info, for the rollout plan |

## 6. Full-suite regression

Runs of 9 Nov 2026. Typecheck and lint were clean after the last change.

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Unit tests added or touched here (`e2eV11Traceability`, `e2eTraceability`, `q205*`) | 18 of 18 pass |
| Full `npx vitest run` (61 min, local) | 263 of 267 files passed; 3,218 tests passed, 38 skipped. The four failing files were the G2.01 and G2.02 ones in D-V11-10, which are fixed and re-run alone (results in the table above); **the full suite was not re-run after that fix** |
| Full Playwright, `chromium` and `mobile-chrome` projects, on the standard production build as CI starts it | 294 passed, 29 skipped, 1 failed. The failure is the Ocean contrast check (D-V11-01). The skips are the 13 platform console and mobile specs (404 on a production build), the visual specs that wait for Linux baselines, and files that were already skipping |

## 7. State of the gate

Automated: the V1.1 journeys are now real and run on the standard e2e server (except the platform console, which needs a dev server). **Not done, and not doable by an agent:** UAT with Management, Sales and a platform admin and its sign-off (`docs/UAT_V1_1.md`, sign-off table empty); the manual screen-reader and keyboard pass; design approval of the baselines; Linux baselines; the migration rehearsal on a restored copy of the target; the release itself and hypercare (`docs/V1_1_RELEASE.md`); the V1.1 backend sign-off gate G2.04 (FIG-1159, still Backlog). Q2.04 depends on G2.04. Open Major findings above (D-V11-01, D-V11-03 to D-V11-05) mean "zero blockers or majors open" in Q2.03 is not met.
