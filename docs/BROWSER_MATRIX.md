# Cross-browser and device matrix (Q1.04, FIG-1118)

Design reference: M1 to M3, S3. The app has to work on the browsers and phones the team uses.

## Automated: Playwright projects

`e2e/qa/core-journeys.spec.ts` runs the core journeys on every project in `playwright.config.ts`:

| Matrix entry | Playwright project | Engine | Notes |
|---|---|---|---|
| Chrome (desktop) | `chromium` | Chromium | Also runs the whole e2e suite, the role journeys, the accessibility sweep and the visual baselines |
| Firefox (desktop) | `firefox` | Gecko | |
| Safari (desktop) | `webkit` | WebKit | |
| Android Chrome | `mobile-chrome` | Chromium, Pixel 5 profile at 375 px, touch | Also runs the M9 phone journeys (`mobile-*.spec.ts`) |
| iOS Safari | `mobile-safari` | WebKit, iPhone 13 profile | The PWA install prompt and push do not exist in an emulator; see the manual checklist |

The core journeys: sign in; the role's home; the leads list and a lead; the deals board; companies (desktop) or the phone frame with Leads, Customers and Tasks (phone projects); sign out ends the session; the light/dark switch is remembered on the device; a private page sends a signed-out visitor to sign in.

Install the engines once with `npm run e2e:install:matrix`, then `npx playwright test e2e/qa/core-journeys.spec.ts` runs all five.

**Result, 31 Oct 2026 (production build, local):** the last full run of all five projects was 12 passed, 2 skipped (the theme-switch test is skipped on the two phone projects: the phone frame has no top-bar switch) and 1 failed. The failure was desktop Safari's sign-in journey, interrupted by a redirect to `/login?reason=expired` while another suite was loading the machine. Three repeat runs of the Safari project straight afterwards were all green (3 of 3 tests each), so it is an intermittent failure whose cause is not found. It is logged as D-04 in `docs/QA_DEFECTS.md`. Treat Safari as "watch" until it has 20 clean runs in a row.

## Known limits and how they were handled

| Limit | Where | Decision |
|---|---|---|
| Safari refuses a `Secure` cookie from plain `http://localhost`; Chrome and Firefox make an exception | The local test server only. Production is HTTPS and keeps `Secure` | The test helper drops `Secure` from the sign-in response for WebKit only (`e2e/helpers.ts`). The app's cookie code is untouched |
| WebKit shows the sign-in form before it has hydrated; a click before hydration is lost | Test timing only | The helper waits for the network to settle in WebKit before filling the form |
| Safari logs "Content-Security-Policy delivered in report-only mode but does not specify a report-to; the policy will have no effect" | `config/securityHeaders.js` | Informational. The policy is report-only by design while it is tuned; the report endpoint is a production-readiness item for M12 (P1.02) |
| An emulator cannot test install-to-home-screen, push, camera or real mobile data | iOS and Android | Covered by the manual checklist below |

## Manual device checklist

Run on real devices. Tick, date, initial. Failures go to `docs/QA_DEFECTS.md`.

| Device | OS and browser | Sign in | Today and Leads | Quick capture | Offline then sync | Install (PWA) | Push | Theme and Largest text | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Mid-range Android (for example Samsung A-series) | Android 13+, Chrome | | | | | | | | |
| Low-end Android | Android 11, Chrome | | | | | | | | |
| iPhone | iOS 17+, Safari | | | | | | | | |
| iPhone installed to home screen | iOS 17+, standalone | | | | | | | | |
| iPad | iPadOS 17+, Safari | | | | | | | | |
| Windows laptop | Chrome, Edge, Firefox | | | | | | | | |
| Mac | Safari, Chrome | | | | | | | | |

Per device, also check: the phone redirect (a 375 px window opens the phone frame, a desktop window does not), rotating the phone, the on-screen keyboard not covering the quick-capture sheet, pull-to-refresh not losing a half-typed note, and that the offline banner appears and clears.

Status of the manual half: **not run** (needs devices and a person).
