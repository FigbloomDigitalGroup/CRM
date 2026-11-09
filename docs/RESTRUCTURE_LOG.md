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
| W4 | **FIG-1178 (Customer Support workspace)** is built although it is decision-gated ("only if approved", depends on B6.23). | Decision gate DECISIONS 2.4. | Given's approval for the demo is recorded here. **Closed 5 Nov 2026: decision 12 removed the Customer Support role and its screens; FIG-1178 and FIG-1155 are replaced by the email-support issues (`docs/SUPPORT_BY_EMAIL.md`).** |
| W5 | The dev sign-in chips on the frozen login page now also list the Dev Super Admin (approved by Given, 29 Oct 2026). | Hard rule 1 (frozen pages). | None; hashes in `tests/uiGuards.test.ts` were updated with a note. |
| W6 | **Database stays plain PostgreSQL, local now, AWS later** (Michael, recorded by Given on 4 Nov 2026). A hosted-database provider that was being evaluated for M12 (FIG-1255 to FIG-1258) is dropped, with no vendor-specific services. | CLAUDE.md: production host not chosen yet; `docs/DEPLOYMENT.md` platform-agnostic. | Rewrite the four M12 database issues for PostgreSQL and AWS portability (done in Linear 4 Nov); decide the AWS services and region when the move is planned. See `docs/DECISIONS.md` section 5. |

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
2. ~~Every screen that shows demo data says so on screen ("Demo data").~~ **Changed by Given on 29 Oct 2026: no screen shows a "Demo data" label or any demo wording any more.** Given and Claude know which screens are on demo data; this log and the `demo/` folders are now the only record. Production safety is unchanged: these screens still return 404 in production unless `DEMO_SCREENS=true` (`src/ui/demo/enabled.ts`).
3. The platform console and Customer Support screens stay behind the V1.1 release flags and `ALLOW_DEV_ACCOUNTS`/dev rules where the code already requires them; nothing here may reach a production build without the real API behind it.
4. Search for `demo/` to list what is left. **9 Nov 2026 (MVP-12, MVP-13): `src/ui/demo/enabled.ts`, `demoScreensEnabled`, `DEMO_SCREENS` and the V1.1 tools gate are gone from the app: every V1.1 screen that stays is on the real API, V2 screens are hidden and the remaining `demo/` folders (`commercial/`, `platform/`, `settingsplus/`) hold V2 or type-only code.** `tests/components/navigation/navLinks.test.tsx` fails on any dead or V2 link. Track each wired screen in the table below.

### Screens on demo data (all in M10) (fill in as they are built and as they are wired)

| Screen | Issue | Built on demo data | Wired to real API |
|---|---|---|---|
| Platform shell and home | FIG-1160 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | wired 5 Nov 2026 (lane W1, `src/ui/screens/platform/api.ts`, `/api/platform/*`): home, organisation search, data-requests badge; trends and the release switch are not API data |
| Organisations list, provisioning, detail, suspend | FIG-1161 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | wired 5 Nov 2026 (lane W1, `src/ui/screens/platform/api.ts`, `/api/platform/*`); wizard sends name, slug and first admin only (no region, currency, keys or list edits); detail shows counts, owner, status history, no member list |
| Offboarding, data requests, platform audit, health | FIG-1162 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | wired 5 Nov 2026 (lane W1, `src/ui/screens/platform/api.ts`, `/api/platform/*`); approve, reject, cancel, retry export, run deletion, certificate, audit filter/export/verify, health and incidents; no 8-day timelines, no evidence-notes editing |
| Platform admins, security, verify, not-found | FIG-1163 | built 29 Oct 2026 | **wired 9 Nov 2026 (MVP-12)**: roster, invite, remove, lost device and security read `/api/platform/*`; the Verify page is now the real platform sign-in (`/platform/sign-in` password, `/platform/verify` code or first-time set-up, `src/ui/screens/platform/SignIn.tsx`, `/api/platform/auth/*`); the console door no longer depends on demo screens being on; sign-out ends the platform session |
| Platform mobile | FIG-1164 | built 29 Oct 2026 (`src/ui/screens/platform/demo/`, see docs/M10_PLATFORM.md) | wired 5 Nov 2026 (lane W1, `src/ui/screens/platform/api.ts`, `/api/platform/*`) |
| Platform sign-in and identity (the real API behind the console door) | FIG-1135 | n/a (backend) | identity, sessions, role and counts built 4 Nov 2026 (`docs/PLATFORM_IDENTITY.md`); the console screens still read demo data, and real sign-in waits for B6.02 |
| Platform support access, flags and limits, announcements (PL7, PL12, PL13; platform half) | FIG-1192 | built 29 Oct 2026 | **V2, hidden 9 Nov 2026 (MVP-13)**: not in the console navigation, no release switch, the three pages answer the console 404. Code and its in-memory module (`platform/demo/local.ts`, still used for types) stay for V2 |
| ~~Customer Support workspace~~ **removed 5 Nov 2026 (decision 12)** | FIG-1178 | no | (was wired in W6 and then removed, with the role and the ticket tables; tickets, ticket detail, role-limited customer, surveys and the Support home read `/tickets`, `/surveys`, `/support/customers`; `support/demo/` deleted; FEATURE_UNAVAILABLE explained; survey scores are 1 to 5) |
| Organisation switcher (TB4) | FIG-1165 | yes (`src/ui/screens/orgside/demo/`) | yes, 5 Nov 2026 (W6): `GET /api/me/organizations`, `POST .../switch`; layout shows it when the person has more than one organisation (demo cookie `fb_demo_multiorg` removed) |
| Suspended screen (OS1), Settings › Data requests (OS6) | FIG-1166 | yes | **yes, 9 Nov 2026 (MVP-12)**: OS1 is real (organisation status). Settings › Data requests reads and files `/privacy/organisation-requests` (export or delete) and downloads a ready export through `/{id}/download`; the demo cookie `fb_demo_suspended`, the suspended-screen preview and `orgside/demo/` are removed |
| Two-step code screen (A5), enrolment, Settings › Two-step sign-in (S7#2) | FIG-1167 | yes (`orgside/demo/`, `src/app/two-step/`) | partly, 5 Nov 2026 (W6): A5 code step, enrolment (sign-in and Settings) and Settings › Two-step policy and trusted devices are on the real routes; no QR image (key and otpauth link only); the unusual-activity list is removed (no API) |
| Support access approval card, banner, history, announcement banner (OS2, OS3, OS5; organisation side) | FIG-1192 | yes | **V2, hidden and deleted 9 Nov 2026 (MVP-13)**: `OrgBanners`, `orgside/demo/` and the Settings › Support access history tab are removed; nothing links to them |
| Ask Figbloom assistant panel (X2) | FIG-1171 | demo built 29 Oct 2026 | **yes, 5 Nov 2026 (lane W5)**: `/assistant/ask`, `/assistant/settings`, confirm, dismiss and feedback (`assistant/api.ts`); the demo folder is deleted. Confirm creates the task on the server and the card says Done only after it answers |
| Command palette records, Help centre and What's new (X3) | FIG-1172 | demo built 29 Oct 2026 | **yes, 5 Nov 2026 (lane W5)**: `/commands` (with the role's own tables as fallback when the organisation is not on V1.1), `/search` for records, `/help`, `/help/{slug}`, `/whats-new`; the RECENT group is gone (no recent-records API) |
| Saved views (X4) | FIG-1173 | demo built 29 Oct 2026 | **yes, 5 Nov 2026 (lane W5)**: `/views` and the pin and pinned-order routes (`views/store.ts`); sharing is real; reordering applies to pinned views only |
| Settings › Email and calendar, AI assistant (S7#2) | FIG-1175 | demo built 29 Oct 2026 | AI assistant: **yes, 5 Nov 2026 (lane W5)**, `/assistant/settings`. Email and calendar (`Connections.tsx`): **yes, 9 Nov 2026 (MVP-12)**: status `GET /integrations/connections`, connect `POST .../start` (the provider's own sign-in, returns to `?tab=connect&connection=connected\|denied`), disconnect `DELETE .../{id}`; device storage removed. Needs `GOOGLE_OAUTH_*`/`MICROSOFT_OAUTH_*` and `INTEGRATION_ENCRYPTION_KEY` set to connect for real |
| Your own colours (AP4) | FIG-1176 | no: uses the real preferences API (`ownColours`) | yes |
| Mobile camera photos, business-card scan, sync queue page (M4) | FIG-1177 | demo built 29 Oct 2026 | **yes, 5 Nov 2026 (lane W5)**: card scan uses start, upload, extract and confirm (Save confirms the capture and attaches the photo); photos upload to the record's attachments. Gap: no offline queue entry for photos or cards, so a photo waiting on the phone is held in memory and a card needs a connection |
| Quote builder, document preview, versions (Q1) | FIG-1168 | built on demo data | **yes, wired 5 Nov 2026 (W3)**: `commercial/api.ts`, `GET/POST /deals/{id}/quote`, quote versions, preview, send, request-approval, response, apply-to-deal. Client e-signature preview and deposit request dropped from the page (no API, V2) |
| Approvals inbox (Q3) | FIG-1169 | built on demo data | **yes, wired 5 Nov 2026 (W3)**: `GET /approvals`, decision, cancel |
| Forecast and targets (Q4) | FIG-1170 | built on demo data | **yes (W4, 5 Nov 2026)**: `GET /forecast`, `GET/PUT /forecast/targets`, open deals from `GET /deals`; per-deal probability override dropped (the API has stage probabilities only) |
| Settings: catalogue, pipelines and stage rules, sequences, web forms, approval rules (S6#2) | FIG-1174 | built on demo data | **partly (W3, 5 Nov 2026)**: catalogue, pipelines and stage rules, approval rules wired (`GET/POST/PATCH /catalogue`, `/pipelines`, `/approval-rules`); sequences (`GET/POST/PATCH /sequences`) and web forms (`GET/POST/PATCH /web-forms`, rotate-key, submissions) wired by W4, 5 Nov 2026; Settings › Sequences and Web forms no longer need demo screens enabled |
| E-signature page and deposit request (Q2) | FIG-1193 | yes | **V2, hidden 9 Nov 2026 (MVP-13)**: `/sign/{token}` answers a plain "this link is not available" page with no data. `SignClient.tsx` and `demoSigning.ts` stay (parked for V2, they have their own test) but no route uses them |
| Settings: roles and field access, developers (S8#2) | FIG-1194 | yes (`settingsplus/demo/`) | **V2, hidden 9 Nov 2026 (MVP-13)**: no Settings tab; `Roles.tsx`, `Developers.tsx` and `settingsplus/demo/` stay parked for V2 and are used by no screen |
| Communication group in the sidebar (Conversations moved in, not duplicated) | FIG-1378 | built 29 Oct 2026; the group is real navigation, the Mail, Chat and Video links are demo-only (`src/ui/shell/navigation.ts`, see docs/M10_COMMUNICATION.md) | Mail, Chat and Video links are real now (keys `mail.use`, `chat.view`, `meetings.schedule`, no demo flag) |
| Chat workspace | FIG-1379 | yes (demo store removed) | wired 5 Nov 2026 to `/chat/*` (`src/ui/screens/communication/api.ts`, polling); gaps: no mute, no unread badge in the sidebar yet; needs test against a live database |
| Mail workspace | FIG-1380 | yes (demo store removed) | wired 5 Nov 2026: Conversations (EMAIL), Needs linking, drafts, send, reply, connection status; gaps: only a 240-character preview of received mail, no read flag, no templates or attachments, no automation-draft marker |
| Video Conference | FIG-1381 | yes (demo store removed) | wired 5 Nov 2026: meetings from `GET /calendar`, schedule, reschedule, cancel, connection status; gaps: list has no join link, attendees or cancelled state (shown only for meetings scheduled in this session) |

### Scope added on 29 Oct 2026: the Communication group

Given added a sidebar dropdown "Communication" (Mail, Chat, Video Conference) and asked that Conversations move into it. Nine issues were created (FIG-1378 to FIG-1386) and six existing issues got extra scope (FIG-807, 808, 1153, 1156, 1179, 1180). **V1 side effect:** Conversations left the Customers section, so the V1 role journeys and sidebar pixel baselines (FIG-1115, FIG-1117) need re-recording; `e2e/ui-shell.spec.ts` already opens the group. Scope, decisions and the cut-order proposal: `docs/COMMUNICATION_HUB_SCOPE.md`.

## Clean-up list after the presentation

1. Delete the empty "D1 · UNUSED" milestone in Linear.
2. Wire every demo screen to the real API (M13), reconcile with the contract, close the V1.1 gate G2.04 (M14).
3. Confirm V1 QA (M11) and go-live (M12) dates; the 8 Nov date is gone.
4. ~~Decide FIG-1178 and B6.23 (Customer Support) properly.~~ Decided 5 Nov 2026: no Customer Support role; tickets go to Figbloom by email (decision 12).
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

## Platform console backend (M13, 5 Nov 2026): screens still to wire

The backend for the platform console exists (`docs/PLATFORM_CONSOLE_API.md`); these screens still read `src/ui/screens/platform/demo/` and are not wired yet (M14).

| Screen | Issue | Backend now | Screen state |
|---|---|---|---|
| Home and health (PL1, PL9) | FIG-1139 | `GET /api/platform/home`, `/health`, `/health/incidents` | demo data; swap the demo module for these |
| Organisations list, provisioning, detail (PL2 to PL4) | FIG-1136 | `/api/platform/organizations` (+ `slug-check`, `defaults-preview`, `{id}`) | demo data |
| Suspend, reactivate, offboard (PL5, OS1) | FIG-1137 | `POST /api/platform/organizations/{id}/status`; the suspended screen (OS1) now shows from the real organisation status | platform half demo; OS1 is real |
| Audit log (PL8) | FIG-1138 | `/api/platform/audit`, `/export`, `/verify` | demo data |
| Data requests and offboarding (PL6, OS6) | FIG-1141 | `/api/platform/data-requests/*`; org side `/privacy/organisation-requests` (+ `/{id}/download`) | demo data |

## M13 close-out (4 Nov 2026)

The V1.1 backend is built and committed on `makeover/m13-backend-v11` (`bbdc883`). The table lists which backend issues exist for each demo-screen row above. **The "Wired to real API" column of the table above is unchanged: nothing is wired yet** (that is M14). Checks and gaps found: `docs/M13_CLOSEOUT.md`.

| Demo-screen row (issue) | Backend issues built in M13 | Not covered by the backend yet |
|---|---|---|
| Platform shell and home (FIG-1160) | FIG-1135, FIG-1139 | none |
| Organisations list, provisioning, detail, suspend (FIG-1161) | FIG-1136, FIG-1137 | none |
| Offboarding, data requests, audit, health (FIG-1162) | FIG-1137, FIG-1138, FIG-1139, FIG-1141 | none |
| Platform admins, security, verify (FIG-1163) | FIG-1134, FIG-1140 | none |
| Platform mobile (FIG-1164) | same routes as FIG-1160 to FIG-1163 | none |
| Platform support access, flags, announcements (FIG-1192, platform half) | none | whole backend (support access, flags and limits, announcements) |
| ~~Customer Support workspace (FIG-1178)~~ removed, decision 12 | ~~FIG-1155~~ | (none: tickets are held by the platform console) |
| Organisation switcher (FIG-1165) | FIG-1133 | none |
| Suspended screen, Settings data requests (FIG-1166) | FIG-1137, FIG-1141 | "notify the organisation" switch on suspend |
| Two-step code, enrolment, Settings two-step (FIG-1167) | FIG-1134 | in-app alert notification |
| Support access card, banner, history, announcements (FIG-1192, organisation side) | none | whole backend |
| Ask Figbloom panel (FIG-1171) | FIG-1152 | summaries, scoring, churn options, history |
| Command palette, Help, What's new (FIG-1172) | FIG-1149 | recent records |
| Saved views (FIG-1173) | FIG-1148 | none |
| Settings: email and calendar, AI assistant (FIG-1175) | FIG-1153, FIG-807, FIG-808, FIG-1152 | none |
| Mobile camera photos, card scan (FIG-1177) | FIG-1154 | offline queue entry for photos |
| Quote builder, document, versions (FIG-1168) | FIG-1142, FIG-1143, FIG-1144 | PDF output, a viewer page for the quote link |
| Approvals inbox (FIG-1169) | FIG-1145 | none |
| Forecast and targets (FIG-1170) | FIG-1146 | none |
| Settings: catalogue, pipelines, sequences, web forms, approval rules (FIG-1174) | FIG-1142, FIG-1147, FIG-1150, FIG-1151, FIG-1145 | none |
| E-signature and deposit request (FIG-1193) | none | V2 backend (M16) |
| Settings: roles and field access, developers (FIG-1194) | none | V2 backend (M16) |
| Communication group (FIG-1378) | FIG-1384 (`communication.group` toggle and keys) | none |
| Chat workspace (FIG-1379) | FIG-1382 to FIG-1385 | none |
| Mail workspace (FIG-1380) | FIG-807, FIG-1153 | none |
| Video Conference (FIG-1381) | FIG-808, FIG-1153 | none |

### W3 wiring notes (5 Nov 2026)

- Deals board: a Pipeline switcher appears when the organisation has more than one active pipeline (`GET /pipelines`, V1.1); `GET /deals` has no pipeline filter, so the board filters client-side by the chosen pipeline's stage ids.
- Contract gaps (response types are `unknown` and bodies of PUT version, send, request-approval and response are untyped in `openapi.v1.json` 1.1.0): the shapes are declared in `src/ui/screens/commercial/api.ts`. Not changed in the contract.
- Pipelines editor switches the quote and approval rules per stage; new pipelines are created with three starter stages (no service picker yet, no stage reorder or add UI).
- `commercial/demo/store.ts` and `demo/data.ts` stay: Forecast and `settingsplus/demo/data.ts` (sequences, web forms) still import them.

## M17 close-out (9 Nov 2026)

Backend V2 is built on `makeover/m17-backend-v2` (see the Stage 17 section of `IMPLEMENTATION_NOTES.md`). **Nothing is wired yet:** the V2 demo screens (support access, flags and limits, announcements, e-signature, roles and field access, developers) still read demo data and are to be wired to these routes. FIG-1187 (deposit request) is not built and waits for the payments decision.
