# M10: engagement tools (Ask Figbloom, command palette, saved views, own colours, connections, mobile capture)

Issues FIG-1171 (X2), FIG-1172 (X3), FIG-1173 (X4), FIG-1175 (S7#2), FIG-1176 (AP4), FIG-1177 (M4). Built on **demo data** except the colour feature (see `docs/RESTRUCTURE_LOG.md`). Nothing here is Done until it is wired to the real API and tested against it (M13 and M14).

## What is where

| Piece | Code | Data |
|---|---|---|
| Ask Figbloom panel (X2) | `src/ui/screens/assistant/AssistantPanel.tsx` | demo answers: `assistant/demo/respond.ts`, sample records: `assistant/demo/data.ts` |
| Top-bar buttons, panels and shortcuts | `assistant/ToolsHost.tsx`, mounted in `src/ui/shell/AppShell.tsx` (`ToolsTriggers` in the top bar, `ToolsOverlays` beside the page) | none |
| Command palette (X3) | `src/ui/screens/palette/CommandPalette.tsx`, rules in `palette/items.ts` | demo records |
| Help panel, Help centre, What's new (X3) | `palette/HelpPanel.tsx`, `palette/HelpCentre.tsx`, copy in `palette/helpContent.ts`; routes `/o/{org}/help` and `/o/{org}/help/whats-new` | static copy |
| Saved views (X4) | `src/ui/screens/views/` (`model.ts` rules, `store.ts` storage, `SavedViewsBar.tsx` on Leads, `SavedViewsNav.tsx` in the sidebar) | this device's storage (`figbloom-saved-views:{org}`) |
| Settings, Email & calendar and AI assistant | `assistant/settings/Connections.tsx`, `AiAssistantSettings.tsx`; tabs `connect` and `ai` in `settings/SettingsScreen.tsx` | device storage |
| Your own colours (AP4) | `src/ui/screens/preferences/OwnColours.tsx` in the Appearance tab; logic `src/ui/theme/ownColours.ts` | **real**: `PATCH /me/preferences` with `ownColours` |
| Mobile photos, business-card scan, sync queue page (M4) | `src/ui/screens/mobile/capture/`; the scan button sits in `CaptureSheet` (`Sheets.tsx`), photos on the phone record screen; route `/o/{org}/m/sync` | photos and card reading are demo; notes, calls and captures use the real offline queue |

Styles: `assistant/assistant.css` and `mobile/capture/capture.css`, both imported by `ui.css`.

## Rules the code keeps

- **Nothing acts without confirmation (X2).** A suggestion is a card, "nothing happens until you confirm". `onConfirmAction` runs only from the Confirm button. A draft is editable text and is never sent from the panel. Tests: `tests/components/assistant/assistant.test.tsx`.
- **Masked data stays masked (X2).** `demoRespond` never writes a deal value for a role without `deals.view.value`, and explains (instead of answering) for lists the role cannot open. It says what the answer was based on. The real assistant must apply the same rules on the server (B6.20).
- **Off, limits, errors (X2).** The organisation switch (Settings, AI assistant) turns the panel into an explanation with no input. The daily limit (15 in the demo) disables the box and says when it resets. A failed answer shows "Try again" and changes nothing.
- **Only permitted actions (X3).** `buildPaletteItems` is a pure function of the permission keys, mirroring `shell/navigation.ts`. `G` then a letter honours the same keys. Single-letter shortcuts are ignored while typing in a field.
- **Keyboard (X3).** Ctrl or Cmd+K toggles the palette; arrows, Home, End, Enter, Escape; the box is a combobox over a listbox with `aria-activedescendant`; focus returns to where it was; Tab stays inside. `?` opens Help.
- **Shared views never widen access (X4).** A shared view is visible to a colleague only if their role may open the list (`canOpenPage`). Only the owner renames, shares, pins or deletes a view.
- **No colour below AA can be saved (AP4).** `evaluateOwnColours` runs the same check as the server (`checkOwnColours`) and the Save button stays off, with the reason, until every colour passes. A property test checks that whatever it lets through keeps every `TOKEN_PAIRS` entry at AA in light and dark. Buttons are darkened where white text would not read. Available only when the organisation allows personal colours and has not locked the look; otherwise the card explains why.
- **Check before saving (M4).** The business-card scan only fills the Quick capture form; the lead is created when the person presses Save lead. Fields the reader was unsure of are named. A photo taken offline says "Waiting to sync" and waits for Retry or the connection.

## Demo switch

The tools (top-bar buttons, shortcuts, panels, saved views) render outside production, or in a production build only when `NEXT_PUBLIC_DEMO_SCREENS=true` (`toolsEnabled()` in `ToolsHost.tsx`). The Help centre pages are guidance only and are always available. When the tools are wired, add the V1.1 release-flag check beside `toolsEnabled()`.

## To wire in M13 and M14

1. Assistant: replace `demoRespond` and the localStorage task with the B6.20 API; the same masking tests run against the real answers.
2. Palette: real search (`searchGlobal`) in place of `DEMO_RECORDS`.
3. Saved views: B6.16 API (personal and shared); delete `views/store.ts`; the sidebar link `?savedView=id` stays.
4. Connections and AI settings: OAuth (FIG-806 to FIG-808, B6.21) and the organisation AI setting (B6.20); `figbloom-ai-settings` event goes.
5. Mobile: B6.22 attachment upload through the offline queue (new queue kind), and real card extraction; remove `cardExtract.ts` and `photos.ts`.

## Known gaps

- Own colours are applied from the server's resolved look, so they appear with the page (no flash); they are not on the frozen sign-in pages, by design.
- The Playwright specs (`e2e/engage-tools.spec.ts`) are written but were not run in this session (the shared test database was in use by other work).
- "From a WhatsApp chat" in Quick capture (design M1) is not part of M4 and is not built.
