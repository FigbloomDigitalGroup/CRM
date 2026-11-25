# Social screens (UC-S4 to UC-S6, demo data)

Design source: `CrmSocial.dc.html` (frames MK1, SO1 and the inbox, publishing, campaigns and analytics frames). Linear: FIG-1813 (S4), FIG-1814 (S5), FIG-1815 (S6), FIG-1802 and FIG-1803 (widget catalogue, per-account dashboards).

## What is built

A sidebar group "Social media" (between Sales workspace and Customers) with five real routes, all on `src/ui/screens/social/SocialWorkspace.tsx` (exports `SocialOverview`, `SocialInbox`, `SocialPublishing`, `SocialCampaigns`, `SocialAnalytics` from `index.ts`):

| Route | Sidebar item | What it shows |
|---|---|---|
| `/o/{org}/social` | Social overview | Header, Marketing team chip, Connect account; one card per account (followers, synced, Reconnect when the token expired); Mentions with All/Positive/Neutral/Negative filter, Reply in inbox and Create lead; Sentiment this week bar; Needs attention list. `SocialOverview` is also the Marketing role home. |
| `/social/inbox` | Unified inbox (unread badge) | Thread list (open, unread, done), conversation, reply, Convert to lead, mark done. |
| `/social/publishing` | Publishing | Week calendar and list, composer, boost approval (Management). Needs `social.publish` as well. |
| `/social/campaigns` | Campaigns | List, new campaign as a draft, detail dialog (reach to won deals, posts). |
| `/social/analytics` | Social analytics | KPIs, engagements per day, by channel, top posts, period picker. |

Access and nav: every page needs `social.view` (the explained no-access otherwise); Publishing also `social.publish`. The keys and the Management and Marketing grants are added in `src/auth/permissions.ts` and the seed by the permissions work; the nav only calls `has()`. The unread badge on Unified inbox is counted from the demo threads (`unreadSocialThreads()`). Campaign spend, budget, cost per lead and pipeline value show the masked-value marker unless the member has `deals.view.value` (hard rule 7). The per-account dashboard picker of the first version was dropped to match the design.

Quotes and Invoices: the nav items already exist (`quotes.view`, `invoices.view`); Sales shows them as soon as the permission seed grants those keys. `tests/uiNavigation.test.ts` still lists Sales without Invoices until then.

Gate: unchanged. The pages exist only where `DEMO_SCREENS=true`; otherwise 404 and no sidebar group.

Files: `src/ui/screens/social/`, `src/app/o/[orgSlug]/social/{page,inbox,publishing,campaigns,analytics}`, `src/ui/shell/navigation.ts`. Tests: `tests/components/screens/social/social.test.tsx`, `tests/uiNavigation.test.ts`.

## What is demo

All data in `demo/data.ts`. Nothing calls a social network, nothing is scraped. State (replies, posts, campaigns, leads, connect or disconnect) lives in the browser only and resets on reload. Convert to lead is record-only: it shows the lead in the overview list and a toast, and creates nothing in Leads.

## Wiring that remains

1. Connector foundation (S2): accounts, tokens, sync status and the connect and reconnect flow replace the Accounts tab data and the Connect buttons.
2. Pilot connector (S3): mentions, inbox threads, replies, publishing and scheduled posts, and analytics come from the connector's stored events instead of `demo/data.ts`.
3. Convert to lead calls the leads API with source, channel and campaign attribution (unassigned, in the pool) and an idempotency key.
4. Post approval and boost go through the real approval path; campaign spend and cost per lead come from finance data with the same masking.
5. Per-account dashboard widgets move to the widget catalogue and saved dashboards (FIG-1802, FIG-1803) once those exist; today the picker filters fixed widgets.
6. Replace `socialScreensEnabled()` with the release flag.
7. Add a cross-organisation test and an API-backed e2e when the API exists.
