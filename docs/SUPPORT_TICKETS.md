# Customer Support: tickets and satisfaction surveys (FIG-1155, B6.23)

Decision-gated. `docs/DECISIONS.md` 2.4 and 16 settled that Customer Support is a sixth role, behind a flag, off by default. This issue is built on that and on Given's explicit approval to start before FIG-1132 (P1.10) closed. If Michael does not approve the role the toggle simply stays off; the issue's own text says to cancel it in that case, which is Given's call.

## Gate

Every operation needs the `customer_support.role` toggle AND the `tickets.manage` permission. The toggle is V1.1-only and off by default; with it off the role carries no permission at all and Management gets `FeatureUnavailable`. `tickets.manage` now has a V1.1 release minimum (it was V2, which made the role useless in V1.1; one line in `prisma/seedData.ts`). It is held by Management and Customer Support only; Sales, Delivery, Finance and Restricted Technical are refused on every operation.

## What it does

- **Tickets** (`/api/orgs/{org}/tickets`, `/{id}`, `/{id}/messages`): linked to a customer (company), optional contact of that company, title, description, status (OPEN, WAITING_ON_CLIENT, RESOLVED), priority, owner (active member), running number per organisation (no gaps under concurrency), a thread of customer messages, replies and internal notes. Creates take an `Idempotency-Key`. Changes are audited.
- **Surveys** (`/api/orgs/{org}/surveys`): send a one-question survey (1 to 5, optional comment) to a resolved ticket's contact, or a customer's first contact with an email; one open survey per ticket; 30 days; the emailed link carries a random token (only its SHA-256 stored). The customer answers through the public `/api/public/surveys/{token}` (no sign-in, rate limited per address, one answer per link, nothing about the customer in the answer). Results with count and average for `tickets.manage` holders.
- **Role-limited customer view** (`/api/orgs/{org}/support/customers/{companyId}`): company basics, contacts, services (name, status, start), tickets and satisfaction answers, built by selecting fields one by one: no deal, value, cost, margin, payment, invoice or commercial notes is read at all (hard rule 7).
- **Isolation**: three new tenant tables with forced RLS and same-organisation composite foreign keys (`20261109110000_support_tickets`); a cross-organisation test covers service calls, raw SQL under another organisation's context and a cross-organisation insert.

## Decisions taken without being asked

Statuses and priorities as the design's demo; no SLA clocks, no customer-facing portal (replies are staff-recorded, email delivery of replies is not built); a ticket may only be surveyed when RESOLVED; Management has full access to tickets and surveys; ticket data is visible to all `tickets.manage` holders (a shared support queue, not own-only). The public survey page itself (`/survey/{token}`) is a frontend route not built here.

## To wire

Wired on 5 Nov 2026 (M14, lane W6): `src/ui/screens/support/api.ts` and the screens read the routes above; the demo folder is gone.

## Tests

`tests/supportTickets.test.ts` (12): the flag and release gate, every other role refused on every operation, create and work a ticket with thread and audit, validation and foreign-record refusals, gap-free numbering under concurrency, tenant isolation, survey sending and answering, expiry and rate limit, the role-limited view carrying no deal data, key holders. Extended: `tests/permissionsV2.test.ts` passes unchanged.
