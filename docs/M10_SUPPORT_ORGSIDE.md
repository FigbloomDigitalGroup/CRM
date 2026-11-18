# M10 · The organisation side of V1.1 / V2 (demo data)

> **5 Nov 2026 (decision 12):** the Customer Support workspace described in the original version of this note was removed with the Customer Support role. Support requests are now sent by email: `docs/SUPPORT_BY_EMAIL.md`.

Issues: FIG-1178 (F6.19), FIG-1166 (F6.07), FIG-1167 (F6.08), FIG-1165 (F6.06) and the organisation half of FIG-1192 (F7.01). Built on demo data on 29 Oct 2026 (course change, see `docs/RESTRUCTURE_LOG.md`). **None of them is Done until it is wired to the real API and tested against it (M13/M14).**

## Where things are

| Screen (design ID) | Where | Demo data |
|---|---|---|
| Organisation switcher (TB4), Alt+O | top bar slot `organisationSwitcher`; `src/ui/screens/orgside/OrgSwitcher.tsx` | `orgside/demo/` |
| Suspended organisation (OS1) | rendered by `src/app/o/[orgSlug]/layout.tsx` in place of the shell; `/o/{org}/suspended` redirects home when not suspended | demo cookie `fb_demo_suspended=1` |
| Settings › Data requests (OS6) | Settings tab `datareq` | `orgside/demo/` |
| Two-step code screen (A5), enrolment with backup codes | **new routes** `/two-step`, `/two-step/setup` (`src/app/two-step/`) | in the component |
| Settings › Two-step sign-in (S7#2): policy, trusted devices, alerts | Settings tab `twofa` | `orgside/demo/` |
| Support access approval card (OS2), banner with End now (OS3), announcement banner (OS5) | `OrgBanners`, rendered above the page through the new `AppShell` `banners` prop | `orgside/demo/` |
| Support access history | Settings tab `supporthistory` | `orgside/demo/` |

## Rules kept

- **Frozen pages:** no file of the sign-in, sign-up, forgot, reset or accept-invite pages changed; the two-step step is a new route and uses the shared `auth-shell` styles from `globals.css` (only the organisation layout loads `ui.css`). `tests/uiGuards.test.ts` is green.
- **Demo data:** every screen says "Demo data" and reads one `demo/` module; `demoScreensEnabled()` (`src/ui/demo/enabled.ts`) makes the pages 404 in production unless `DEMO_SCREENS=true`. The three Settings sections show "arrives with V1.1" in production.
- **Permissions:** the approval card and End now are for Management (`configuration.manage`); other roles see the banner but cannot end it. The organisation always sees the support banner while a session is active.

## To wire later (M13/M14)

Replace each `demo/` module with the API (B6.01 memberships, B6.02 two-step, B6.05 suspension, B6.09 data requests, B6.23 tickets, B7.01 support access, B7.03 announcements) and delete the `demoScreensEnabled()` checks, the `fb_demo_suspended` cookie, `DemoNotice` lines and the `NotYet` fallbacks. The suspended screen then reads the organisation's status instead of the cookie, and the two-step page needs the real pending-sign-in challenge.

## Tests

`tests/components/screens/orgside/` (Vitest, with axe on the main screens), `tests/uiNavigation.test.ts`, and `e2e/m10-orgside.spec.ts` (Playwright: written, to be run with `npm run e2e`).

## Differences from the design to know about

- The switcher sits in the top bar slot as a popover (the design puts the list inside the identity card); same content and Alt+O.
- Switching an organisation here only shows the toast; it does not reload the app until B6.01 exists.
- The Support nav item reuses the Conversations icon (no new sidebar icon was added).

## Update 29 Oct 2026: shell matches the design's single-organisation look

The announcement and support banners and the organisation switcher are now **opt-in demo states**, so the default shell is the design's. Switch them on in the browser console: `document.cookie = "fb_demo_banners=1; path=/"` (banners and the approval card) and `document.cookie = "fb_demo_multiorg=1; path=/"` (switcher). The switcher now lives inside the identity popover (TB4), and the identity block shows a chevron only when it is present. Alt+O opens that popover.
