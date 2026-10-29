# M10: Platform console (demo data)

Issues: FIG-1160 (F6.01), FIG-1161 (F6.02), FIG-1162 (F6.03), FIG-1163 (F6.04), FIG-1164 (F6.05) and the platform half of FIG-1192 (F7.01). Design: `design-spec/CrmPlatform.dc.html` (PL1 to PL14, TB6, PLM) and the verify and not-found screens in `design-spec/Figbloom CRM.dc.html`.

**Everything here runs on demo data** (course change of 29 Oct 2026, `docs/RESTRUCTURE_LOG.md`). Every screen says "Demo data". The issues are **not Done** until the console is wired to the real API and tested against it (M13 and M14).

## Where it lives

| What | Where |
|---|---|
| Routes | `src/app/platform/` : `layout.tsx` (stylesheet, look, demo store), `(console)/` (shell and the ten pages), `m/` (platform mobile), `verify/` (PL14) |
| The door | `src/app/platform/requireConsole.ts`: 404 unless demo screens are on **and** the dev Super Admin's session is present |
| Screens and logic | `src/ui/screens/platform/` |
| Demo data | `src/ui/screens/platform/demo/data.ts` (the only place with records) and `store.tsx` (the only place that changes them) |
| Rules (pure, tested) | `src/ui/screens/platform/logic.ts` |
| Styles | `src/ui/screens/platform/platform.css`, loaded only by `src/app/platform/layout.tsx` |
| Shared demo helpers | `src/ui/demo/DemoBadge.tsx`, `src/ui/demo/enabled.ts` (`demoScreensEnabled`) |

## Pages

| URL | Screen | Issue |
|---|---|---|
| `/platform` | PL1 Platform home: what needs attention, seven tiles, trends; Live / All healthy / Degraded / Loading / Error states | FIG-1160 |
| `/platform/organisations` | PL2 list, search, status filter, sort, first-run note | FIG-1161 |
| `/platform/organisations/new` | PL3 provision wizard: name and slug check, region, first admin, editable default lists, keys, review (with a "make seeding fail" demo switch), done with invite link | FIG-1161 |
| `/platform/organisations/{id}` | PL4 detail (counts only) and PL5 suspend, reactivate and offboard dialogs (reason plus the exact name typed back) | FIG-1161 |
| `/platform/data-requests` | PL6 offboarding and data requests, steps, two-person rule, retention, export, certificate | FIG-1162 |
| `/platform/audit` | PL8 append-only log with admin, organisation and action filters, export | FIG-1162 |
| `/platform/health` | PL9 per-component status, what to do, eight-day timeline | FIG-1162 |
| `/platform/admins` | PL10 list, invite, lost device, remove (minimum two) | FIG-1163 |
| `/platform/security` | PL11 verification locked on, IP allowlist, alerts, session length | FIG-1163 |
| `/platform/verify` | PL14 Verify it's you (new route, the frozen sign-in pages are untouched) | FIG-1163 |
| not found inside the console | PL15 | FIG-1163 |
| `/platform/m`, `/platform/m/health`, `/platform/m/approvals` | PLM at 375 px; the desktop pages hand a phone over to these | FIG-1164 |
| `/platform/support-access` | PL7 request, sessions, running session with countdown and End | FIG-1192 |
| `/platform/flags` | PL12 per-organisation flags and limits, change history | FIG-1192 |
| `/platform/announcements` | PL13 compose, preview in the organisation shell, publish, expire | FIG-1192 |
| `/platform/preferences` | The admin's own appearance (light or dark, on this device) | FIG-1160 |

The sidebar follows the design: Support access is always listed; Flags and limits and Announcements (V2) appear when the **Demo release** switch (bottom of the sidebar) is on V2. It starts on V2 so the whole console can be shown.

## Rules the code enforces (all in `logic.ts`, all unit-tested)

- **At least two platform admins.** Removing is blocked at two (and the signed-in admin cannot remove themselves). Removing or inviting an admin first asks "Verify it's you".
- **Two-person approval.** Deleting data needs two different platform admins. The same admin cannot approve twice; the "delete" step stays locked until two have approved. Exports need no second admin. In the demo there is one sign-in, so a "Demo: approve as Given" button stands in for the second admin.
- **Suspend, reactivate, offboard** need a reason and the organisation's exact name. Offboarding opens a data request.
- **Support access** is read-only, needs a reason, ends on its own (the countdown ticks once a second and expires the session) or by one click.
- **Verify it's you:** five tries, then a 30-minute lock. Demo codes: any six digits except `000000` (the wrong-code demo), or a backup code shaped `XXXX-XXXX`.
- Every change is written to the platform audit log (append-only; nothing in the UI edits it).

## Separation from the tenant app (FIG-1160)

- Its own shell, tokens and look (purple "Platform console" bar, PRODUCTION · v1.1.3 tag, sidebar with no tenant links). It never loads `ui.css`, so `tests/uiGuards.test.ts` ("only the organisation layout loads that stylesheet") still holds. `platform.css` follows the same rule (every rule starts with a `.fb-` class) and resets the global element styles at zero specificity, because `globals.css` styles bare buttons, labels and tables.
- No tenant data: the demo records are platform-level (organisation names, counts, member names and emails as the design shows them). Nothing calls a tenant API.
- Access: only the dev Super Admin (`resolveDevPlatformIdentity`: development plus `ALLOW_DEV_ACCOUNTS=true`) and only where `demoScreensEnabled()` is true (not production, unless `DEMO_SCREENS=true`). Everyone else, an organisation user included, gets the ordinary 404 (PL15 says nothing about the console). `e2e/dev-accounts-closed.spec.ts` still proves `/platform` is a 404 in the production build.
- Sign out uses the existing `PlatformSignOut` (now accepts a class and label); the dev sign-in chip is not touched and not duplicated.
- The platform code is compiled into the production bundle but the pages are unreachable there (server-side 404). Nothing in it contains the dev-chip markers checked by `npm run check:build-output`.

## Tests

- `tests/components/platform/logic.test.ts` (23): wizard rules, minimum two admins, two-person rule, suspend/offboard, support sessions, flags, announcements, attention list, verify codes, no mutation.
- `tests/components/platform/screens.test.tsx` (13) and `shell.test.tsx` (5): each screen, the dialogs, the two-approver and Verify it's you flows, mobile, shell separation, V2 gating, search by organisation name only.
- `tests/devSuperAdmin.test.ts`: the holding-page test became the door test for `requireConsole` (signed-in dev admin in; 404 without a session and in production).
- `e2e/platform-console.spec.ts` and `e2e/mobile-platform.spec.ts`: need a dev server (the console exists only for the dev Super Admin in development). They skip themselves against the production e2e server. Run: `ALLOW_DEV_ACCOUNTS=true npm run dev -- -p 3100` then `E2E_BASE_URL=http://localhost:3100 npx playwright test platform-console mobile-platform`. Run once on 29 Oct 2026: 12 of 12 pass.

## Wiring to the real API (M13/M14)

1. Replace `demo/data.ts` and the `apply` calls in `store.tsx` with the typed client (`src/ui/data/client.ts`); screens only read `usePlatform()` and call `dispatch`.
2. Delete the `DemoNotice` lines and the Demo release switch; take the release from the platform flags.
3. Replace `requireConsole` with the real Platform Super Admin session (B6.03); keep the 404 for everyone else.
4. Move the two-person rule, the minimum-two-admins rule and the Verify it's you check to the API (the UI keeps them as explanations, not as the boundary). Then prove them with the API tests the issues name.
5. Real countdown from the server's session end, real audit rows, real health.

## Known gaps

- Support access (PL7) shows the platform side only; the organisation's approval card, banner and history are the organisation-side screens (OS2, OS3, OS5).
- The demo store resets on a full page reload (it lives in the layout; moving between console pages keeps it).
- Platform preferences are appearance only; the design reuses the member preferences screen, which belongs to organisations.
- Fonts: the console uses the app's loaded fonts, not a separate download.
