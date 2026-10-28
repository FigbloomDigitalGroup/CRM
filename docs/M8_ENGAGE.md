# M8 conversations and renewals (F3.04, F3.05)

Issues: FIG-1098 (F3.04, Conversations hub and Needs-linking queue, design E1), FIG-1099 (F3.05, Renewals and retention, design E2, with the FIG-795 reminder surfaces). Design: `design-spec/CrmEngage.dc.html`. Code: `src/ui/screens/engage/`, stylesheet `engage.css`, routes `conversations` and `renewals` under `src/app/o/[orgSlug]/`.

## What is built

- **Conversations hub** (`ConversationsScreen`): header with the scope pill, the "read-only, access is logged" note, four stat tiles (this week, inbound, WhatsApp share, needs linking), channel tabs with counts (All, Needs linking, Email, WhatsApp, Calls, Meetings, Notes), search, the Needs-linking queue and the feed grouped by day (TODAY, YESTERDAY, 28 OCT), call and WhatsApp buttons per row, paging at 50. The chosen tab is remembered per organisation on the device (`figbloom-conversations-tab:{org}`).
- **Needs-linking queue**: each message offers **Link to existing…** (step 1: search companies, contacts and leads and pick one; step 2: confirm), **Create lead** (step 1: check the name; step 2 only when the API warns of a duplicate: "Create anyway") and **Dismiss** (needs a reason). **Log a conversation** records a call or chat with someone not in the CRM; it waits in the queue.
- **Post-call log**: the call and WhatsApp buttons on a feed row open the outcome prompt (`quickLog`, one request, idempotency key from the hook). Offered only when the message is linked to a record and has a number.
- **Renewals and retention** (`RenewalsScreen`): scope pill, four tiles, the recurring-services table (customer, service, cycle, value, renews with state, owner) with All / Due soon / Lapsed chips, and the Going quiet, Proposals waiting and Cross-sell sections. Actions: Add follow-up (task for the service's owner), Start renewal deal, Plan a check-in (task for the customer's owner), Log contact, Chase (logs a call or WhatsApp on the deal), open record. The dormancy threshold select is live for `organization.manage_settings` and disabled with "Management sets this." otherwise.

## Access

The API decides. A role refused by it gets the explained no-access state. Delivery reads the queue read-only with the API's own notice (`access.notice`); Sales and Management act. Service values come masked from the API (`valueMasked`) and show as the masked chip, never as a number. Navigation: Conversations needs `communications.view`; Renewals now needs `company_services.manage` (what the retention API requires), so Delivery, Finance and Customer Support no longer see a link that would only explain a refusal.

## Decisions taken without asking

1. **Tabs follow the API** (Email, WhatsApp, Calls, Meetings, Notes), not the prototype's "Social". A "Needs linking" tab is shown to everyone who may read, because the API lists the queue read-only for Delivery.
2. **Link to existing** is a search dialog rather than the prototype's inline select: a select of every company and lead cannot scale. It still takes two steps (choose, confirm) and links to a customer, contact or lead.
3. **Stats** use three one-row reads (last 7 days, inbound, WhatsApp) so the tiles do not depend on the page of the feed on screen.
4. **Renewals tile "Renewals in 60 days"** is "Renewals due" (the API's list is 30 days plus the grace period) and says how many have lapsed. The fourth tile is "Repeat customers" for organisation-wide roles (customer report) and "Cross-sell ideas" for everyone else, who may not read that report.
5. **Going quiet threshold**: the API flags customers from half the dormancy time. The select therefore sets *dormant after* (60, 90, 120, 180 days; the current value is always listed) and the text states where going quiet starts.
6. **Cross-sell** rows show the API's reason and the suggested services as chips; the prototype's "Uses …" line is not in the API.
7. **Start renewal deal** creates an open deal in the first open pipeline stage, owned by the person, closing on the renewal date, with the notes "Renewal of {service}." (the deals screen does not read `?new=`).
8. **Chase** logs a call or WhatsApp on the deal (the design opens a note drawer); **Plan a check-in** and **Add follow-up** go to the owner the API reports, falling back to the person clicking when there is none. A task is added once per row per visit (the button then says so).
9. No page-view label for either page (the label list belongs to the usage metric).
10. Lists show the first 50 rows of each section and say "Showing 50 of N" beyond that.

## Tests

`tests/components/screens/engage/` (22 tests: both screens, real response shapes, two-step link, create lead with the duplicate warning, dismiss, remembered tab, post-call log, read-only role, masked value, per-section actions with the owner asserted, threshold by role, refusal and empty states, axe) run with `vitest.engage-components.config.ts` (no database). `tests/uiNavigation.test.ts` was updated for the new links. `e2e/conversations.spec.ts` and `e2e/renewals.spec.ts` cover the per-role journeys; written, not yet run (they need the database and a built app).

## Known gaps

The queue loads its first 25 messages; no per-row paging. A message dismissed or linked by a colleague at the same moment shows the API's explanation, but the list is refreshed only on the next read. The seeded organisation may have no recurring services, in which case the renewals e2e table step skips.
