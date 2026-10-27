# Design system and app shell (M6, Frontend 1)

What is built, where it lives, and how every V1 screen is meant to use it. Issues: F1.01 (FIG-1076) to F1.07 (FIG-1082). Design source: `design-spec/Figbloom Design System.dc.html` and the navigation map in `design-spec/Figbloom CRM.dc.html`.

## The rules the code enforces

| Rule | Enforced by |
|---|---|
| The frozen sign-in pages do not change, and never read the new tokens | `tests/uiGuards.test.ts` (hashes of the page files; no import of `@/ui`; only the organisation layout loads `ui.css`; every `ui.css` rule starts with one of our classes) and `e2e/frozen-auth.spec.ts` (pixel snapshots) |
| No screen calls `fetch` | ESLint `no-restricted-globals` for `src/app` and `src/ui`; the older callers are listed in `.eslintrc.json` (`excludedFiles`) and `tests/uiGuards.test.ts` fails if the list grows or keeps a file that no longer needs it |
| Every colour pair is readable (WCAG AA) | `tests/components/ui/themeEngine.test.ts`: every theme, every page colour, light and dark, plus 200 random member-chosen colours |
| Hiding a link is not the security boundary | The sidebar is built from permissions (`src/ui/shell/navigation.ts`); every page and API route still checks its own permission |
| Dev sign-in chips never reach production | `src/app/_dev/` is behind a build-time branch; `npm run check:build-output` (CI, after the build) greps `.next` for the chips' markers |

## Tokens and themes (F1.01)

- `src/ui/theme/palette.ts` turns a theme (sidebar, accent, highlight) and a page colour into every colour token, for one scheme. The design's values are the starting point; wherever a pairing would read below AA the colour is moved only as far as needed. Text colours follow the page colour itself, so a mid-tone page can never be paired with the wrong text.
- `src/ui/theme/resolve.ts` is the resolver: the look the server resolved (`look` from `GET /api/me/context`, which already says whose it is and whether the organisation **locked** it) plus what is stored only on the device (`figbloom-device-prefs`: text size, bold, higher contrast, reduced motion, status markers, the light/dark switch).
  - The page colour sets the scheme; "Match my device" follows the operating system.
  - The top-bar switch swaps to the member's other page colour (`toggle.light` / `toggle.dark`). It does nothing while the look is locked, and says why.
  - Accessibility modes always apply, locked or not.
- `ThemeProvider` renders both schemes' tokens in one `<style>`, so switching is only an attribute change. `NoFlashScript` runs before first paint and applies the device's choices (no flash). Live changes (`useAppearance().setLook`, `setDevice`, `setDensity`) update the whole app without a reload.
- Root modes (attributes on `.fb-app`): `data-fb-scheme`, `data-fb-density` (compact), `data-fb-text` (SMALL, DEFAULT, LARGE, EXTRA_LARGE = "Largest"; implemented as a zoom of 0.93, 1, 1.14, 1.29 on the 14 px base), `data-fb-bold`, `data-fb-contrast`, `data-fb-motion`, `data-fb-markers` (a shape beside every status, not colour alone).
- Everything is scoped to `.fb-app`, the wrapper the organisation layout renders. The older stylesheet's variables (`--bg-page`, `--accent`, ...) are mapped onto the new tokens inside it, so pages not yet rebuilt follow the member's theme too.

## Components (F1.02)

Import from `@/ui`. Gallery: `/o/{org}/dev/gallery` (development, and the e2e server only; 404 everywhere else) shows each one in light, dark, compact, largest text and at 375 px.

Buttons (`Button` with `disabledReason`, `IconButton`), `Chip`, `Tag`, `Badge`, `ScopePill`, `OwnerChip`, `Avatar`, `ScoreChip`, `HealthChip`, `ReleaseTag`; fields (`Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `DateField`, `TimeField`, `SearchableSelect`); the form layer (`FormErrorSummary`, `fieldErrorMap`, `useDirtyGuard`); `Tabs`, `Dialog`, `ConfirmDialog`, `Drawer`, `Popover`, `Menu`, `Tooltip`; `ToastProvider` / `useToast` (undo toasts, held while hovered or focused); `DataTable` (sort, filter, bulk select with reasons, sticky header, column visibility, density-aware); `Card`, `KpiTile`, `KanbanCard`, `Timeline`; appearance pieces `ThemeCard`, `ColourField` (live contrast check), `DensitySample`, `SessionTimerBar`.

Behaviour is built in: focus traps that return focus, Escape, arrow keys in menus, tabs and comboboxes, labels, `aria-invalid`, `aria-describedby`. A control that cannot be used says why (`disabledReason`), as a tooltip for buttons and as help text for fields. Never silently hidden.

**Not built in M6 (belong to later milestones):** from the design system's section 07B/07C, `CommentThread`, `AttachmentList`, `CommandPalette`, `AssistantPanel`, `SavedViewTabs`, `QuoteLineTable`, `SignaturePad`, `ApprovalCard`, `TargetBar` (V1.1/V2 features and the record extras of M8) and the platform console set (`PlatformShell`, `BreakGlassBar`, ...), which M14 and M17 build with their screens.

## States (F1.05)

`LoadingState`, `EmptyState`, `ErrorState`, `NoAccess`, `MaskedValue`, `ArchivedBanner`, `OfflineBanner`. All wording is in `src/ui/copy.ts` (one place, translation-ready). `describeError` maps an API error to those states, and passes through only the messages the API writes for people (validation and conflict); a server error's message, a stack trace or an internal code is never shown, only the reference (the request id). The organisation segment has its own `error.tsx` and `not-found.tsx` using the kit, so the shell stays usable; the root ones (and so the sign-in pages) are untouched.

## Data (F1.06)

- `src/ui/data/client.ts` is the only place that touches the network for screens. It builds the typed client from `src/api-client`, times every request for the connectivity service, announces a 401 to the shell, and picks the data source.
- `useApiQuery`, `useApiMutation` (creates carry an `Idempotency-Key`, reused on retry), `useOptimisticUpdate` (instant, rolled back with a plain-language explanation), `useUndoable` (Undo toast for 5 seconds). Request and response types come from the frozen contract, so a screen that drifts from the API does not compile.
- **Data source:** the real API by default. `NEXT_PUBLIC_API_SOURCE=mock` (or `?api=mock&role=SALES` on one tab) points at `npm run mock:api` (port 4010). In a production build it is always the real API, whatever is set.
- The mock server's explained 403 now names roles the way the real API does ("Finance", not `FINANCE`).

## The shell (F1.03, F1.04)

`src/app/o/[orgSlug]/layout.tsx` makes one call (`getMemberContext`, the same data as `GET /api/me/context`) and renders `AppShell`:

- **Sidebar** (`src/ui/shell/Sidebar.tsx`, `navigation.ts`): sections and links from the person's permissions, the design's labels ("Won deals" and "Pipeline" for won-only viewers, "My metrics" without organisation reports, "My work" for the technical role), the member's hidden pages, a filter box, collapse (saved to the account and mirrored on the device). Links for screens not yet built (Calendar, Conversations, Handoffs, Renewals, Payments, Preferences) are defined but switched off (`built: false`); M7 to M9 switch each on with its screen. Settings stays visible to every member until Preferences exists (FIG-785).
- **Top bar:** date, search, the notification bell, Quick create (only what the role may create; disabled with the reason inside an archived or read-only record), the light/dark switch, and the **identity block** (avatar, name, role and organisation; the popover has the sign-in time, time zone, device, a support notice, Profile and preferences, Sign out other devices, Sign out). At 375 px the text collapses to the avatar and the popover is a bottom sheet. The organisation switcher has a slot (`organisationSwitcher`), empty until V1.1.
- **Session prompt** (`SessionGuard`): five minutes before the end (the server's `warnAt`) a dialog counts down with Stay signed in. If nobody answers, forms are told to save their drafts (`useDraft`) and the person goes to `/login?reason=expired`. A 401 from any request does the same.
- **Banners:** the offline banner (with queued changes) and the slow-connection bar, from the connectivity service shared with the offline queue (F4.12).
- **Layout containers:** `.fb-page-list`, `.fb-page-detail` (with a side-panel variant that stacks on tablet and phone), inside the older `.page`.
- **Breakpoints:** above 1024 px the full sidebar; 641 to 1024 px icons only (opens as an overlay); 640 px and below a menu button opens it.

## Dev sign-in chips (F1.07)

`src/app/_dev/`, mounted from the root layout, outside the frozen pages: a small floating panel that lists every seeded account (Management, Sales, Sales Two, Delivery, Finance, Restricted Technical, Customer Support with its flag, the Dev Super Admin) and signs in with one tap through `POST /api/dev-session`. It renders only in development with `ALLOW_DEV_ACCOUNTS=true` and with the seeded organisation present; in a production build the code is not in the bundle.

## Decisions taken without asking (change any of them by telling me)

1. **No Tailwind.** The issue says "CSS variables and the Tailwind/theme config". The app has none, and a second styling system beside a 4,000-line stylesheet would cost more than it gives, so the tokens are CSS variables scoped to `.fb-app`.
2. **Text size is a zoom.** The existing pages are sized in pixels, so scaling the root font would not move them. A zoom moves every page, old and new.
3. **The design's text-3 and focus-ring colours were darkened.** `--text-3` (#878A83 on the cream page) is about 3.4:1 and the orange focus ring about 2.2:1; the issue requires AA for every pair, so they are moved until they pass (4.5:1 and 3:1).
4. **Status tints are derived from the card colour** rather than fixed, so a status badge reads on any page colour a member can choose.
5. **Frozen-page pictures are per platform** (`-linux`, `-win32`).
6. **The light/dark switch is disabled, with the reason, while the organisation locks the look**, and accessibility modes are never blocked.

## Screens (M7 onwards)

Screens live in `src/ui/screens/<area>/` and import from `@/ui`. A route's `page.tsx` stays a thin server component; the screen is a client component. `useMember()` gives it the organisation, the membership and the permission keys the organisation layout already resolved. Each area has its own stylesheet, imported by `ui.css`; every selector's first compound must carry a `.fb-` class (`tests/uiGuards.test.ts`). The older global stylesheet still styles bare `button`, `th`, `td`, `label`; a screen stylesheet re-asserts the look of anything those rules would touch.
