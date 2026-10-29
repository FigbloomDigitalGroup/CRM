# Preferences (M9: F4.01 to F4.03)

Issues: FIG-1103 (shell and Appearance), FIG-1104 (profile picture, shared-look variant), FIG-1105 (Notifications per role, Security). Design: `design-spec/CrmPrefs.dc.html`, checklist rows AP1 to AP3 and AP5 to AP8, and the notification half of S3 (the PWA install half is F4.12).

## Where it lives

- Route: `/o/{org}/preferences?tab=profile|notifications|appearance|security` (`src/app/o/[orgSlug]/preferences/page.tsx`, a thin server page that only checks the person belongs to the organisation). The sidebar's Preferences link is on (`navigation.ts`, `built: true`) and the top-bar "Profile and preferences" link points here.
- Screens: `src/ui/screens/preferences/` (`PreferencesScreen`, `AppearanceTab`, `ProfileTab`, `NotificationsTab`, `SecurityTab`, `hooks.ts`, `model.ts`, `preferences.css`).
- Every read and write goes through the typed client (`/me/*` and `/orgs/{org}/me/*`); no screen calls `fetch`. The one non-API call is `putSignedUpload` for the picture, as for attachments.
- Every tab is about the signed-in person only. There is no role check beyond membership: every role has its own preferences.

## Appearance (F4.01, AP2, AP8)

- Every control changes the app at once: a theme or page colour is applied through `useAppearance().setLook` from the catalogue (`lookColours`) before the request is sent; density through `setDensity`; text size and the accessibility switches through `setDevice`. If the server refuses, the change is put back and a toast says why (`explainRollback`). After a success the look is re-applied from the server's `effective` answer.
- Saved to the **account** (`PATCH /me/preferences`): theme, page colour (and the light or dark side of the top-bar switch), density, start page, sidebar (collapsed, hidden pages), clock, week start, date format. Each change offers Undo for the toast window.
- Saved on the **device** only (`figbloom-device-prefs`, never sent): text size, bolder text, higher contrast, reduce motion, status shapes. Each card says which it is ("Follows your account" / "This device only").
- Start page, sidebar and the date and time card are in V1 because the issue and the backend (B1.08) have them; the design drew them as V1.1. "Your own colours" (AP4) is V1.1 and is not built here (F6.17).
- Reset to default (AP8) asks first, calls `POST /me/preferences/reset`, also clears the device settings, and offers Undo with the server's one-time token (ten minutes on the server, the toast is shown for the usual undo window). While the organisation locks the look, reset leaves the shared look alone and says so.
- The page colour list and theme list come from `src/preferences/catalogue.ts`, so the screen follows the catalogue whatever its colours are.

## Shared look (F4.02, AP5)

When `personalisation.locked` is true the theme and page colour cards stay visible but read-only: each choice is `aria-disabled` with the reason as its tooltip and as text under the cards ("Ask a Management member to change it in Settings, under Organisation appearance"), the note at the top names the theme Management chose, and says text size, density and accessibility are still the person's. Clicking a locked choice sends nothing.

## Profile and picture (F4.02, AP1, AP3)

- Upload flow: choose a file, checks in the browser (JPG or PNG, 2 MB, at least 128 px on the short side: the API's own limits, which are tighter than the design's "5 MB"), crop (zoom plus move left/right and up/down sliders, so it works from the keyboard), then `POST /files` (purpose AVATAR), the signed upload, `POST /files/{id}/complete`, `POST /me/avatar` with the crop in the picture's own pixels. The API re-checks everything, crops, resizes to 256 px and deletes the original.
- Messages are the design's: too large, wrong type, upload failed, uploading, saved. A refused file never reaches the API.
- Remove goes back to initials. Name, phone and time zone save with `PATCH /me/profile` (field errors shown on the field). Email is read-only with the reason. Language is disabled ("Kiswahili arrives in V2").

## Notifications (F4.03, AP6)

Events come from `GET /me/notification-preferences`, so each role sees only its own events. Presets (Everything, Important only, Off; "Custom" appears once a single box is changed), In-app, Email and Push columns, quiet hours, daily email limit. Overdue alerts are locked on in-app and email with the reason beside them; Push is disabled with the API's note until the app is installed (F4.12 and B4.07 turn it on). Changes save at once and offer Undo.

## Security (F4.03, AP7, S3)

- My sessions (`GET /me/sessions`): device, place, signed-in or last-active time in the person's own time zone and clock, "This device" marked. Sign out one device, or sign out other devices (asks first; the other devices are signed out at once on their next request).
- Sign-in history (`GET /me/sign-in-events`): success, wrong password, blocked, new device.
- Password: the frozen flow is not touched. "Change password by email" links to `/forgot-password`. The design's in-page password form is not built, because the frozen-page rule says password changes use the existing flow and there is no change-password API.
- Two-step sign-in: shown as V1.1 text only (F6.08).

## Tests

- `tests/components/screens/preferences/` (24 tests): live apply, rollback on refusal, device-only never sent, density, reset and undo, locked look, start page and sidebar, picture rules and crop maths, Remove, profile save, overdue locked, presets and custom, quiet hours and cap, sessions, sign out others, history, time formatting, and an axe check per tab. Run alone with `npx vitest run --config vitest.prefs-components.config.ts` (no database needed).
- `e2e/preferences.spec.ts`: appearance persists to a second device while text size does not; reset; the sidebar link; picture refusals; notifications; sessions and sign out others. Needs the production build and a seeded database like the other specs.

## Decisions taken without being asked

1. Picture limit is 2 MB (the API's), not the design's 5 MB.
2. The accessibility list is Bolder text, Higher contrast, Reduce motion and Status shapes (the app's device modes); the design's "Focus ring always visible" has no counterpart in the theme engine and is not built.
3. "Pages in my sidebar" checkboxes replace the design's "Show group labels" (no API for it); they use `sidebar.hidden`.
4. The tab is kept in the address with `history.replaceState`, so a link opens the right tab.
