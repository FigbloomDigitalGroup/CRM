# Restructure log: demo-first order (29 Oct 2026)

On 29 Oct 2026 Given re-ordered the remaining work so that the system can be presented on screen in two days. This file is the single place that records what was changed, what was waived, and what must be corrected afterwards. **Update it whenever a waived item is paid back.** Linear is still the source of truth for scope; this file is the source of truth for the deviations.

## Why

A presentation of the project in two days (about 31 Oct). Given asked for all remaining frontend first, with the Customer Support and Super Admin screens at the front of the queue, then the backend, then quality assurance and production readiness last.

## Decisions waived or changed (all by Given, 29 Oct 2026)

| # | Decision | What it replaces | Debt to pay back |
|---|---|---|---|
| W1 | Build the V1.1 and V2 frontend **before** the V1.1 backend gate (G2.04, FIG-1159) and before the backend exists. | CLAUDE.md: "Do not start a stage until the previous stage's exit gate is closed"; backend-first order. | Reconcile every demo screen with the real API in M13 and M14; the gate still has to close. |
| W2 | The new screens run on **demo data**. | Real API only. | Replace demo data with the real API (see "Demo data convention"). Nothing built on demo data counts as done for acceptance until it is wired and tested against the real API. |
| W3 | **V1 QA (now M11) and V1 production readiness and go-live (now M12) run after the presentation sprint (M10) and before the V1.1 and V2 work.** V1 go-live is no longer 8 Nov; it is now about 10 Nov. (Given first asked for them to go last; on review they were moved up so V1 ships first.) | CLAUDE.md: V1 live by 8 Nov. | Given will confirm the dates after the presentation. The final date (22 Nov 2026) is unchanged. |
| W4 | **FIG-1178 (Customer Support workspace)** is built although it is decision-gated ("only if approved", depends on B6.23). | Decision gate DECISIONS 2.4. | Given's approval for the demo is recorded here; the gate (build for real, or cancel with a note) is still open. |
| W5 | The dev sign-in chips on the frozen login page now also list the Dev Super Admin (approved by Given, 29 Oct 2026). | Hard rule 1 (frozen pages). | None; hashes in `tests/uiGuards.test.ts` were updated with a note. |

## New order of work (milestones renumbered twice on 29 Oct 2026)

The milestones were renamed so that their numbers follow the order of work. After Given's review, **V1 QA and go-live were moved up to run straight after the presentation sprint**, so V1 ships before the V1.1 and V2 work is tested and released. **From here on, "M10" means the frontend milestone, not V1 QA.** CLAUDE.md was updated on 29 Oct 2026; older docs (for example the M1 to M9 notes) still use the original numbers, so use this table to translate.

| Now | Originally | Name now | Due now (originally) | Contents |
|---|---|---|---|---|
| **M10** | M14 | Frontend V1.1 and V2 (demo data) | 4 Nov (1 Nov) | All remaining V1.1 and V2 frontend. **Do first, for the presentation (about 31 Oct):** FIG-1178 (Customer Support workspace) and FIG-1160 to FIG-1164 (Super Admin console, platform mobile). Then FIG-1165 to FIG-1177 and the V2 screens FIG-1192 to FIG-1194 (moved from the original M17) |
| **M11** | M10 | V1 quality assurance and UAT | 7 Nov (30 Oct) | the nine issues FIG-1115 to FIG-1122 and FIG-1259 |
| **M12** | M11 | V1 production readiness and go-live | 10 Nov (30 Oct) | unchanged contents; V1 go-live was 8 Nov |
| **M13** | M12 | Backend V1.1 | 14 Nov (31 Oct) | unchanged contents; wires the demo screens |
| **M14** | M13 | V1.1 backend quality gate | 15 Nov (31 Oct) | unchanged |
| **M15** | M15 | V1.1 quality assurance and release | 17 Nov (2 Nov) | unchanged |
| **M16** | M16 | Backend V2 | 19 Nov (2 Nov) | unchanged |
| **M17** | M17 | V2 quality assurance and release | 20 Nov (3 Nov) | only FIG-1195 now (the V2 screens moved to M10) |

M0 to M9 keep their numbers. This order leaves 21 and 22 Nov as buffer before the fixed 22 Nov final date.

The dates are my proposal to fit the fixed 22 Nov date; they are not signed off. Change them freely. Linear's list may still show the milestones in a different order (the tool cannot reorder them); drag them into the order above if you want the list to match.

**No issues were added.** Only existing issues were moved. A milestone "D1" was first created for the presentation work and then withdrawn the same day; it is now empty and named "D1 · UNUSED: please delete". The Linear tool cannot delete milestones, so please delete it in the Linear UI.

### Status changes made

- FIG-1115 to FIG-1122 and FIG-1259 (original M10, now M11): set back from In Progress to **Todo** (they had been set In Progress on 28 Oct, at Given's request, before this restructure).
- No other status was changed. The 13 M9 issues remain **In Review** until PR #25 (merged) and the follow-up PR are accepted; Given moves them to Done.

### Issues moved between milestones

| Issue | From | To |
|---|---|---|
| FIG-1192, 1193, 1194 | original M17 (still M17) | original M14 (now M10) |

## Demo data convention (so it can be found and replaced)

1. Demo data lives only in folders named `demo/` next to the screen that uses it (for example `src/ui/screens/platform/demo/`), and is read through one module per screen, so wiring to the API means swapping that module.
2. Every screen that shows demo data says so on screen ("Demo data"), so nobody mistakes it for real records in the presentation or later.
3. The platform console and Customer Support screens stay behind the V1.1 release flags and `ALLOW_DEV_ACCOUNTS`/dev rules where the code already requires them; nothing here may reach a production build without the real API behind it.
4. Search for `demo/` and "Demo data" to list what is left to wire. Track each wired screen in the table below.

### Screens on demo data (all in M10) (fill in as they are built and as they are wired)

| Screen | Issue | Built on demo data | Wired to real API |
|---|---|---|---|
| Platform shell and home | FIG-1160 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Organisations list, provisioning, detail, suspend | FIG-1161 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Offboarding, data requests, platform audit, health | FIG-1162 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Platform admins, security, verify, not-found | FIG-1163 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Platform mobile | FIG-1164 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Platform support access, flags and limits, announcements (PL7, PL12, PL13; platform half) | FIG-1192 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | no |
| Customer Support workspace (tickets, detail, satisfaction, role-limited customer) | FIG-1178 | yes (`src/ui/screens/support/demo/`) | no |
| Organisation switcher (TB4) | FIG-1165 | yes (`src/ui/screens/orgside/demo/`) | no |
| Suspended screen (OS1), Settings › Data requests (OS6) | FIG-1166 | yes (`orgside/demo/`; demo cookie `fb_demo_suspended`) | no |
| Two-step code screen (A5), enrolment, Settings › Two-step sign-in (S7#2) | FIG-1167 | yes (`orgside/demo/`, `src/app/two-step/`) | no |
| Support access approval card, banner, history, announcement banner (OS2, OS3, OS5; organisation side) | FIG-1192 | yes (`orgside/demo/`) | no |
| Ask Figbloom assistant panel (X2) | FIG-1171 | yes (`src/ui/screens/assistant/demo/`) | no |
| Command palette records, Help centre and What's new (X3) | FIG-1172 | palette records are demo (`assistant/demo/data.ts`); help copy is static | no |
| Saved views (X4) | FIG-1173 | yes (device storage, `src/ui/screens/views/store.ts`; sharing simulated) | no |
| Settings › Email and calendar, AI assistant (S7#2) | FIG-1175 | yes (`assistant/settings/`, device storage) | no |
| Your own colours (AP4) | FIG-1176 | no: uses the real preferences API (`ownColours`) | yes |
| Mobile camera photos, business-card scan, sync queue page (M4) | FIG-1177 | photos and card reading are demo (`mobile/capture/`); changes use the real offline queue | partly |
| Quote builder, document preview, versions (Q1) | FIG-1168 | yes (`src/ui/screens/commercial/demo/`, in-memory store) | no |
| Approvals inbox (Q3) | FIG-1169 | yes (`commercial/demo/`) | no |
| Forecast and targets (Q4) | FIG-1170 | yes (`commercial/demo/`) | no |
| Settings: catalogue, pipelines and stage rules, sequences, web forms, approval rules (S6#2) | FIG-1174 | yes (`src/ui/screens/settingsplus/demo/`) | no |
| E-signature page and deposit request (Q2) | FIG-1193 | yes (`src/app/sign/[token]/demoSigning.ts`, tokens `demo-unsigned`, `demo-signed`, `demo-deposit`) | no |
| Settings: roles and field access, developers (S8#2) | FIG-1194 | yes (`settingsplus/demo/`) | no |

## Clean-up list after the presentation

1. Delete the empty "D1 · UNUSED" milestone in Linear.
2. Wire every demo screen to the real API (M13), reconcile with the contract, close the V1.1 gate G2.04 (M14).
3. Confirm V1 QA (M11) and go-live (M12) dates; the 8 Nov date is gone.
4. Decide FIG-1178 and B6.23 (Customer Support) properly.
5. Re-check the Linear milestone order and dates in the UI.
6. Open items from M9, still to decide or finish:
   - The seed and login-page changes (Customer Support dev account, Super Admin chip) are **uncommitted** until a small PR is raised.
   - The Sky theme accent was nudged to `#2A7BB0` to pass the AA contrast test (design hex was `#2B7DB3`).
   - Custom-field visibility per role (FIG-1109) is not built; the API has no such control (suggest V2, B7.06).
   - The frozen contract types three CSV endpoints as JSON; `getCsvText` in `src/ui/data/client.ts` is a workaround until `npm run contract:update` marks them `text/csv`.
   - Old pre-redesign settings forms in `src/app/o/[orgSlug]/settings/` are unused; deleting them needs Given's say-so.
   - Several build folders (`.next-*`) use disk space; deleting needs Given's say-so.
   - CI takes about 27 minutes; splitting vitest and e2e into parallel jobs and sharding Playwright fits FIG-1115.

## How to undo this restructure

Linear milestone descriptions keep the original text after "Original text:" and the previous due dates are in the table above. To go back: set the old dates, rename the milestones back using the table above, move FIG-1192 to FIG-1194 back to the V2 milestone, and set the nine V1 QA issues to In Progress again if wanted.
