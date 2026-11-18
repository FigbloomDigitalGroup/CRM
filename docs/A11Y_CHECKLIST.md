# Accessibility checklist (Q1.02, FIG-1116)

Target: WCAG 2.2 level AA in every theme and mode. Design reference: AP2 (Appearance), AP8 (Reset), and the accessibility notes in `design-spec/Figbloom Design System.dc.html`.

Two halves: the **automated sweep** (runs in CI, results below) and the **manual script** (a person runs it; the sign-off block at the end stays empty until they do).

## 1. Automated sweep

`e2e/qa/a11y-sweep.spec.ts` runs axe-core (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) in a real browser against the production build:

| Run | What it covers |
|---|---|
| Default look, Management | Every V1 desktop screen: home, leads, deals, handoffs, tasks, calendar, companies, contacts, merge, conversations, renewals, payments, reports, notifications, search, preferences, settings, plus the first lead, deal, company and contact page |
| Light, dark, Ocean, Midnight, Charcoal and amber, compact, Largest text, high contrast, 375 px | The core screens (home, leads, deals, companies, payments, preferences, lead page, company page) as Sales, in each look. Theme and density are set through the real Appearance controls and reset afterwards |
| Keyboard basics | The first Tab stop is "Skip to main content"; focus is visible; reduced motion is honoured |

Acceptance bar: **zero serious or critical violations**. Moderate and minor findings are attached to the Playwright report (annotation `axe-minor`) and triaged below. Other automated guards that stay in place: `tests/components/ui/palette.test.ts` (contrast of every token pair for every theme and page colour), `e2e/ui-gallery.spec.ts` (every component, every mode, 375 px overflow), and axe inside each screen's component tests.

Run it: `npm run build && npx playwright test e2e/qa/a11y-sweep.spec.ts --project=chromium`.

### Defects the first sweep found, and the fix

| ID | Finding (axe rule) | Where | Fix |
|---|---|---|---|
| A11Y-1 | No way to skip the sidebar and top bar (WCAG 2.4.1, bypass blocks) | Every organisation page | A "Skip to main content" link as the first tab stop; `<main id="main" tabindex="-1">` takes focus (`AppShell.tsx`, `ui.css`) |
| A11Y-2 | Accessible name did not contain the visible text (`label-content-name-mismatch`, WCAG 2.5.3) | The organisation block and the user chip in the top bar, on every page | `Popover` takes `triggerLabel={null}` so the button is named by its text, with a hidden suffix (", organisation and session" / ", account menu") |
| A11Y-3 | Same rule | Calendar month chips | The label now starts with the visible text: "3:17 PM Follow up with Naivas, task, overdue" |
| A11Y-4 | `color-contrast`: near-black title on the dark green header (1.44 to 1, WCAG 1.4.3) | Every phone screen (`/m/...`) | `.fb-m-head__title` inherits the header's text colour instead of the page title colour |
| A11Y-5 | `color-contrast` on the Won column total | Deals board | Total uses the main text colour |
| A11Y-6 | `target-size` under 24 px (WCAG 2.5.8, new in 2.2) | Calendar "+n more", the task check circle, task title buttons, deal link chips | Minimum 24 by 24 px |

Tests updated because the accessible names changed (not loosened): `tests/components/ui/shell.test.tsx`, `tests/components/screens/tasks/calendarScreen.test.tsx`, `e2e/ui-shell.spec.ts`.

### Known and accepted

None at serious or critical. Moderate and minor findings from the latest run are listed in the Playwright report; none is a blocker. Open items are tracked in `docs/QA_DEFECTS.md`.

## 2. Manual script

Run on the staging build with the Management and Sales dev accounts. Tick each line; write anything that fails into `docs/QA_DEFECTS.md` with severity.

### Keyboard only (no mouse), Chrome and Firefox
- [ ] Sign in with Tab, Enter. The first Tab stop on every page is "Skip to main content"; Enter moves focus into the page.
- [ ] Every sidebar link, the search box, the bell, Quick create, the theme switch and the account menu are reachable and have a visible focus ring in light, dark and high contrast.
- [ ] Menus and popovers open with Enter or Space, move with the arrow keys, close with Escape, and return focus to the button that opened them.
- [ ] Dialogs trap focus, close with Escape, and return focus. The session "Still there?" dialog can be answered by keyboard.
- [ ] Deals board: move a card with the keyboard ("Move to...") without dragging. Calendar: arrow keys move between days, Enter adds a task.
- [ ] Tables: sort, select a row, and open a record with the keyboard.
- [ ] No keyboard trap anywhere; no focus lost to the top of the page after an action.

### Screen reader: NVDA with Firefox on Windows, VoiceOver with Safari on macOS and iOS
Journeys: sign in; Management home; create a lead; move a deal to a new stage; complete a task; open Customer 360; read the Payments tracker as Finance; change theme and density in Preferences.
- [ ] Landmarks are announced: Sidebar, Main, banner. Each page has one level-1 heading that names the screen.
- [ ] Buttons and links are named by what they do. The org block reads "Figbloom, Management, signed in ..., organisation and session".
- [ ] Status is not colour alone: badges read their text; the status markers (shape plus text) read correctly with markers on.
- [ ] Toasts and live regions are announced once ("Lead created", "Appearance reset to default.").
- [ ] Masked values read as "hidden for your role", with the reason, never as a blank.
- [ ] Charts have a table view and it reads in order.
- [ ] Forms: every field has a label; errors are announced and linked to the field.

### Largest text, high contrast, reduced motion, colour-blind-safe markers
- [ ] Preferences > Appearance > text size "Largest": nothing is cut off or overlapped at 1280 px and at 375 px; pages scroll vertically only.
- [ ] High contrast and Bold text on: borders and text are clearly stronger; focus ring still visible.
- [ ] Reduce motion on (and the operating system's setting on): no sliding or fading; the board drop and the toast still work.
- [ ] Status markers on: every status chip carries a shape (check, triangle, diamond, square, star, circle) as well as colour.
- [ ] Browser zoom 200 percent and 400 percent (reflow): no horizontal scroll at 400 percent on the phone screens.

### Sign-off

| Role | Name | Date | Result |
|---|---|---|---|
| Accessibility reviewer | | | |
| Management | | | |

Not signed. The automated half passed on the date shown in `docs/V1_QUALITY_GATE.md`; the manual half is waiting for a person.
