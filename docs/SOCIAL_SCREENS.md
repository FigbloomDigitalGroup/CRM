# Social screens (UC-S4 to UC-S6, demo data)

Design source: `CrmSocial.dc.html` (frames MK1, SO1 and the inbox, publishing, campaigns and analytics frames). Linear: FIG-1813 (S4), FIG-1814 (S5), FIG-1815 (S6), FIG-1802 and FIG-1803 (widget catalogue, per-account dashboards).

## What is built

One route, `/o/{org}/social`, with seven tabs (`src/ui/screens/social/SocialWorkspace.tsx`):

| Tab | What it shows |
|---|---|
| Overview | KPI strip, "Do these today", "Going out next", "Campaigns running", "Leads you brought in". A "Dashboard for" picker turns it into the per-account dashboard (all accounts, or one connected account). No connected account gives the "Connect your first social account" state. |
| Accounts | One card per network: handle, followers, sync time, Reconnect (expired token banner), Connect for networks not linked. |
| Monitor | Mentions with sentiment filter, reach, and Convert to lead. |
| Inbox | Unified inbox (open, unread, done), conversation, reply, Convert to lead, mark done. |
| Publishing | Week calendar and list, new post composer (accounts, text, day, campaign, boost), approval of boosted posts (Management only), draft. |
| Campaigns | List with status, spend, reach, leads, cost per lead; campaign detail (reach to won deals, posts); new campaign as draft. |
| Analytics | KPIs, engagements per day, by channel, top posts, period picker. |

Access and nav: sidebar item "Social" in the Sales workspace section, shown for holders of the existing key `reporting.view.all` (no role gains or loses anything; no new permission key). The screen shows the explained no-access without it. Campaign spend, budget, cost per lead and pipeline value show the masked-value marker unless the member has `deals.view.value` (hard rule 7).

Gate: the screens exist only where `DEMO_SCREENS=true` (`npm run preview` sets it; helper `src/ui/screens/social/enabled.ts`). Otherwise the page returns 404 and the sidebar draws no link (nav `demo: true`, layout passes `demoScreens`). Remove the gate when wired.

Files: `src/ui/screens/social/` (`SocialWorkspace.tsx`, `social.css`, `enabled.ts`, `index.ts`, `demo/data.ts`), `src/app/o/[orgSlug]/social/page.tsx`, one `@import` in `src/ui/ui.css`, nav entries in `src/ui/shell/navModel.ts`, `navigation.ts`, `Sidebar.tsx` and `demoScreens` in the org layout. Test: `tests/components/screens/social/social.test.tsx`.

## What is demo

All data in `demo/data.ts`. Nothing calls a social network, nothing is scraped. State (replies, posts, campaigns, leads, connect or disconnect) lives in the browser only and resets on reload. Convert to lead is record-only: it shows the lead in the overview list and a toast, and creates nothing in Leads.

## Wiring that remains

1. Connector foundation (S2): accounts, tokens, sync status and the connect and reconnect flow replace the Accounts tab data and the Connect buttons.
2. Pilot connector (S3): mentions, inbox threads, replies, publishing and scheduled posts, and analytics come from the connector's stored events instead of `demo/data.ts`.
3. Convert to lead calls the leads API with source, channel and campaign attribution (unassigned, in the pool) and an idempotency key.
4. Post approval and boost go through the real approval path; campaign spend and cost per lead come from finance data with the same masking.
5. Per-account dashboard widgets move to the widget catalogue and saved dashboards (FIG-1802, FIG-1803) once those exist; today the picker filters fixed widgets.
6. Replace `socialScreensEnabled()` with the release flag and add a permission key (for example `social.view`) with the seed pattern of `docs/QUOTE_INVOICE_PERMISSIONS.md` when Given decides who may use Social.
7. Add a cross-organisation test and an API-backed e2e when the API exists.
