# M10 commercial screens (demo data)

Issues: FIG-1168 (Q1 quote builder), FIG-1169 (Q3 approvals inbox), FIG-1170 (Q4 forecast and targets), FIG-1174 (S6#2 commercial settings), FIG-1193 (Q2 e-signature and deposit), FIG-1194 (S8#2 roles and developers). Design source: `design-spec/CrmGrowth.dc.html` and `CrmSettingsPlus.dc.html`.

**These screens run on demo data.** They are not Done until wired to the real API (M13/M14) and tested against it (`docs/RESTRUCTURE_LOG.md`, hard rule in CLAUDE.md). Every screen says "Demo data" on the page.

## How to see them

1. `.env`: `ACTIVE_RELEASE="v2"`. The quote, approval, forecast, catalogue and token permissions are stripped until the organisation's release reaches V1.1 or V2 (`PERMISSION_MIN_RELEASE` in `prisma/seedData.ts`), so on V1 every role correctly gets the explained no-access.
2. Anywhere except a production build the pages and Settings tabs render. A production build shows them only with `DEMO_SCREENS=true` (server pages) and `NEXT_PUBLIC_DEMO_SCREENS=true` (Settings tabs, built in), otherwise the pages answer 404 and the tabs say "Not available yet". See `src/ui/demo/enabled.ts`.
3. Sign in as a dev account and open:

| Screen | Where | Sign in as |
|---|---|---|
| Quotes list | `/o/figbloom/quotes` | Dev Sales, Dev Management |
| Quote builder | `/o/figbloom/quotes/d3` (waiting for approval), `/d1` (sent), `/d6` (no quote yet: builds a draft) | Dev Sales (no margin), Dev Management (margin) |
| Approvals inbox | `/o/figbloom/approvals` | Dev Management decides; Dev Sales sees only their own requests |
| Forecast and targets | `/o/figbloom/forecast` | Dev Management (team, editable targets); Dev Sales (own deals only) |
| Settings tabs | `/o/figbloom/settings?tab=catalogue`, `pipelines`, `sequences`, `webforms`, `approvalrules`, `roles`, `developers` | Dev Management |
| Client signing page | `/sign/demo-unsigned`, `/sign/demo-signed`, `/sign/demo-deposit` (no sign-in; try 375 px and the SW button) | nobody |

Changes live in memory only: a reload resets the demo (`resetDemoStore`).

## What each screen enforces

- **Quote builder.** Totals are pure code (`quoteMath.ts`, tested): subtotal less discount, prices include VAT. Discount 0 to 30; above the approval limit (5 by default, set in Approval rules) the send becomes "Request approval" and a request lands in the inbox. **Margin** (column, summary row) is not rendered at all without `deals.margin`; the client document preview never carries cost or margin for anyone. **Versions are immutable:** a sent, signed or waiting version is read-only; "New version" makes the next draft and the history keeps every step. Prices are frozen onto the lines when a version is sent, so a catalogue change never alters a quote the client has.
- **Approvals.** Nothing is decided automatically (hard rule 9). Approvers (`quotes.approve`) approve or decline; a **decline needs a reason** and the reason is what the requester sees. Requesters see only their own requests, read-only. A decision updates the quote immediately.
- **Forecast.** Probability comes from the stage; an override is shown as "(override)". "Team" needs `forecast.view.all`; targets are edited only with `targets.manage`. A deal's value is shown to its owner or with `deals.view.value`, and totals are built only from deals whose value the viewer may see, so a total cannot reveal a masked one. The chart has a text description and a Table switch. States: no target, on track, short, close date passed.
- **Commercial settings.** Each editor (`settingsplus/kit.tsx` `EditorFrame`) keeps a draft, blocks the save with the reasons, lists the impact in plain words, repeats it in a confirmation and writes an audit entry (shown under the editor; in the real build it goes to the audit log). Catalogue cost and margin columns need `deals.margin`. Stage rules refuse a move and say why; "Closed Lost needs a reason" is always on; none of them moves a deal.
- **Roles and field access.** Cells cycle Edit, Own, View, Hidden; an effect preview shows a sample record as the chosen role (and as owner or not). Management can never be set to Hidden or Own on a field. Platform Super Admins cannot be given these permissions.
- **Developers.** A token's or webhook's secret is shown once, in a dialog that cannot be dismissed by accident; afterwards only a masked tail is kept. Revoke is confirmed and immediate. "Send test" adds a delivery to the visible log; failed deliveries show tries and the next retry, with Retry now. The API docs link opens `/api/openapi.json`.
- **E-signature page.** Standalone (no organisation, no shell, its own stylesheet `src/app/sign/sign.css`), mobile first, English and Swahili, name plus one tick plus one button. Signed view with the audit note. The deposit request appears only for a quote that carries one (open decision B7.05); an unknown link says only "This link is not valid".

## Wiring to the real API (M13/M14)

Replace, per screen, the module that feeds it and delete the badge:

| Demo module | Replaced by |
|---|---|
| `src/ui/screens/commercial/demo/store.ts` and `data.ts` | B6.11/B6.12 quotes and versions, B6.13 approvals, B6.14 forecast and targets (`useApiQuery`/`useApiMutation`) |
| `src/ui/screens/settingsplus/demo/data.ts` and the local state in each editor | B6.10, B6.15, B6.18, B6.19 (editors), B7.06 (tokens, webhooks, field access) |
| `src/app/sign/[token]/demoSigning.ts` | B7.04 signing links (server-side lookup and signature record with IP and time) |

Remove `demoScreensEnabled()` from the pages, `Demo` from `settingsplus/index.tsx`, and the `DemoNotice` lines. Also reconcile with the real rules: the API, not the screen, must refuse a send above the approval limit, an edit to a sent version, and an unauthorised margin read.

## Known gaps and choices made

- Quote totals do not add VAT on top (the design's quote says prices include 16% VAT).
- Nav entries reuse existing icons (Quotes: deals, Approvals: handoffs, Forecast: reports); the design's own icons need `NavIcon` additions in `navModel.ts` and `Sidebar.tsx`.
- The deposit request button is always present in the builder (the design shows it with an "Open decision" tag); the client page shows it only when the quote carries one.
- Playwright: `e2e/commercial.spec.ts` is written but skipped unless the server is built with the demo variables (see its header). It has not been run in this session.
