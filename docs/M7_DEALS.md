# M7 deals and handoffs (F2.04 to F2.06)

Issues: FIG-1086 (F2.04, board and list), FIG-790 (drag and drop, absorbed), FIG-1087 (F2.05, deal detail and proposals, with the FIG-795 reminder), FIG-1088 (F2.06, handoff dialog and Handoffs view; UI half of FIG-792). Design: `design-spec/CrmDeals.dc.html`, `CrmWorkspaces.dc.html` (Delivery handoffs), `CrmOverlays.dc.html` (Move to, Lost, Handoff, New deal, Log, Task). Code: `src/ui/screens/deals/`, stylesheet `deals.css`, routes `deals`, `deals/[dealId]`, `handoffs`.

## What is built

- **Board and list** (`DealsScreen`): stat tiles, open pipeline and closed groups, a column per stage with count and total, cards with stalled / close-date-passed / handoff / lost-reason flags, board and list toggle, Show archived, Export CSV (`deals.export`), New deal drawer. One read feeds board and list (`useAllDeals`: up to 500 deals, a note says when there are more).
- **Moving a deal** (`useDealMover`, used by board, stepper and Mark won): `move-check` first. Lost asks for a reason, Won opens the handoff dialog, a refusal is explained in words. The card moves at once and is put back, with the reason, if the server says no. Moves are undoable for 5 s (the server refuses Undo for Won). Drag and drop is pointer; **Move to…** is on every card you may move and works by keyboard and touch.
- **Deal detail** (`DealDetailScreen`): stage stepper, summary, proposals (add reference, change status), timeline (Activity, Communications, Audit history for `audit.view`), delivery handoff card, primary contact, tasks, Log activity and Add task drawers, archive / restore, owner change (`deals.edit.all`), stalled and archived banners, read-only variants.
- **Proposal follow-up reminder (FIG-795)**: when the latest proposal is Sent and unanswered for the reminder days (default 5, the organisation's setting when Management reads it) a banner offers Log a follow-up and Snooze. Snooze creates a task "Follow up on proposal …" on the deal; the banner shows as snoozed while that task is open.
- **Handoffs** (`HandoffsScreen`): list with status tabs and counts, receiving view (scope, requirements, deliverables you can tick and add, team, onboarding tasks), Take ownership, status select (Delivered, reopen). Offered only when the API's `can` says so.

## Masking and access

Values come only from the API (`valueMasked`, `value: null`). A masked value is never shown or summed; a deal with no value says "No value yet". Won-only roles (Delivery, Finance) see one read-only column and the provisional note. Roles refused by the API get the explained no-access state.

## Decisions taken without asking

1. A deal has no title in the API: the card's second line is the first line of its notes, else the service name. "What are we selling?" saves to notes.
2. The design's **margin** fact and **Source** are not shown: the V1 API has no cost field, and the deal does not return its lead's source.
3. Proposals table: the design's APPROVAL column is shown as RESPONDED (approvals arrive with quotes in V1.1).
4. **Snooze** creates a follow-up task (the only durable reminder the API has; there is no snooze endpoint).
5. Handoff dialog: Delivery owner choices are the members with the Delivery role, plus "Decide later". "Notify Delivery" is shown checked and fixed, because the API always notifies.
6. Handoff statuses are the API's three (Awaiting owner, Onboarding, Delivered); the design's "In delivery" does not exist.
7. Owner names: the member list is Management-only, so a salesperson's own deals name them, and other owners show as "Team member" to roles without the list.
8. Deals CSV import is not offered (there is no deals import endpoint). Build quote is V1.1.
9. Moving to Negotiation needs a proposal reference (a server rule); the explanation shows as a toast.
10. No page-view label for Handoffs (the label list belongs to the usage metric).

## Tests

`tests/components/screens/deals/` (32 tests: board, masking, keyboard and drop moves, lost and handoff dialogs, refusal, detail, reminder, handoffs, axe) run with `vitest.deals-components.config.ts` (no database). `e2e/deals.spec.ts` covers per-role journeys and the Sales-to-Delivery handoff. `e2e/lead-lifecycle.spec.ts` (deal steps) and `e2e/restricted-technical.spec.ts` (no-access wording) were adapted to the new screens; the deal-task completion step now completes the task through the API because a deal's page lists open tasks only.

## Known gaps

Sort and column filters on the list (the design has none); proposal "No reply" flag on board cards (needs per-deal proposals); drag by touch relies on Move to…. Development only: running several `next dev` servers can exhaust the shared Postgres connections (set `connection_limit` in the URLs).
