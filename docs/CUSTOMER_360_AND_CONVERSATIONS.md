# Customer 360, the Conversations hub, quick-log and the lists (Stage 3)

FIG-1047 (B3.01), FIG-1053 (B3.07), FIG-1054 (B3.08), FIG-1056 (B3.10).

## Customer 360 (`GET /companies/{id}/360`)

One call, independently loadable sections (`?sections=payments,deals`; all when omitted):
`profile`, `services`, `deals`, `tasks`, `timeline`, `handoffs`, `payments`, `tickets`, `nextFollowUp`, `attachments`,
`comments`. Each section answers with a status:

- `ok`: the data and its `scope` (`organisation`, `own`, `read-only`);
- `no_access`: what is required, which roles own the area, and why, instead of the section going missing (screen S4);
- `not_available`: not in this release (tickets and the survey arrive with Customer Support, V1.1).

| Role | Sees |
|---|---|
| Management | everything, including the audit entries on the timeline |
| Sales | deals it owns (value shown), its own tasks, no payments; messages and notes linked to a colleague's lead or deal are left out |
| Delivery | won deals with the value masked, handoffs, its own tasks, no payments |
| Finance | won deals with values, payments and the follow-up notes; tasks and history are `no_access` |
| Technical | nothing: companies are not theirs (explained 403) |

The **timeline** merges activities, communications, lifecycle changes and (Management) audit entries, newest first,
paged by an opaque cursor (`limit` 25, at most 100). The order is time then id, so rows with the same timestamp are
never repeated or skipped. A quick-logged call is one entry, not two.

An **archived** company comes back read-only with `archived: true`. The page is built from a **fixed number of
database calls** however many deals, tasks or messages the customer has (`tests/customer360.test.ts` counts them with
`dbCallStats`).

## Conversations hub (`/conversations`)

Every email, call, WhatsApp message, meeting and note, with tabs **All, Email, WhatsApp, Calls, Meetings, Notes** and a
count for each (the count is what the tab would list under the same filters). It reads the communications and the
activities that have no communication of their own. Filters: direction, owner (author, or owner of the linked record),
search, dates.

**Visibility.** A row is listed only when the caller may open **every** record it is linked to
(`linkedRecordsVisibleWhere`, `src/auth/visibilityWhere.ts`). A message linked to a colleague's lead, or to an open deal
a won-only viewer cannot open, never appears, and asking for it by id is a 404.

### Needs-linking queue (`/conversations/needs-linking`)

A message that matched no record is **kept, not dropped**: the inbound-email webhook now stores a message from an
unknown sender (`needs_linking`, with the sender's address and name), and a person can log a call to an unknown number
(`POST /conversations`). The webhook stores each message id once, so a provider retry creates nothing new.

| Action | Rule |
|---|---|
| Link to a record | Idempotent: the same record again succeeds, a different one is `ALREADY_LINKED`. A lead brings its contact and company, a deal its company. The message is then on that record's timeline and out of the queue. |
| Create a lead | Warns first when the sender looks like an existing contact (`duplicateWarning`, send `confirmDuplicate` to go ahead); creates the contact and the lead, owned by the caller, source taken from the channel. |
| Dismiss | Needs a reason; idempotent. |

Management and Sales act (`communications.create` and `leads.create`). Delivery reads the queue read-only; the response
says so (`access.readOnly`, `access.notice`) and an attempt to act is refused with the explained no-access **and written
to the audit log** (`conversation.action_denied`).

## Quick-log (`POST /quick-log`)

Tapping call or WhatsApp on a record opens a prompt afterwards (`GET /quick-log/prompt` returns the number and its
`tel:` and `wa.me` links, or `NO_PHONE_ON_FILE`). One request saves the timeline activity and the conversation, updates
"last contacted" (only when someone was **reached**) and the lead score, and can leave a follow-up task. It names exactly
one of contact, lead, company or deal. With no phone on file it answers `NO_PHONE_ON_FILE` unless `phoneUsed` says which
number was used. Send an `Idempotency-Key`: a double tap on mobile logs once. Numbers without a country code are taken
to be Kenyan (`254`).

## Company and contact lists (`/companies/directory`, `/contacts/directory`)

- **Companies:** tabs `ALL` (archived hidden), `DORMANT` (a subset of All) and `ARCHIVED`; filters lifecycle (key or id),
  service (a running company service, a recurring service or a won deal), owner, tag and custom fields. Each tab's count
  is what that tab would list under the same filters.
- **Contacts:** `standalone` (no company), `missingEmail`, `missingPhone`, tag, owner, company, and the archived tab, with
  a count for each filter under the others.
- **Export** (`.../export`) takes the same filters, needs the export permission and follows the bulk-export rule
  (above 500 rows needs `export.bulk`). Neither list carries a deal value or a payment.
