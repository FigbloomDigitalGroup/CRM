# Communication group (Mail, Chat, Video Conference): scope proposal

Status: **proposal, not approved.** Scope, permissions and release train are Given's and Michael's to decide (CLAUDE.md rule 3a). Drafted 29 Oct 2026. Nothing here is in Linear yet.

## What the screenshot shows

A collapsible sidebar group "Communication" with three children: **Mail**, **Chat**, **Video Conference**. Chat is a Teams-style workspace: channel list (public/private), direct messages, a message pane with day dividers, author, location, time, a composer with attach, emoji and @mention, unread counts, presence and a header with notifications, search and members.

## The one decision that shapes everything

The CRM already has **Conversations** (Customers section, `communications.view`): the customer-facing record of every email, call, WhatsApp, meeting and note, with the needs-linking queue and quick-log (`docs/CUSTOMER_360_AND_CONVERSATIONS.md`). The new group must not duplicate it.

| | Conversations (exists) | Communication group (new) |
|---|---|---|
| Who talks | Customer and us | Us and us (Chat); us and customer (Mail, Meetings) |
| Purpose | History and audit on records | Doing the talking |
| Rule | Logged on the timeline | Anything sent to or about a customer is **also logged** to Conversations/timeline; internal chat is not |

**Decision (Given, 29 Oct 2026): Conversations is not duplicated. Its sidebar entry moves into the Communication group** as the first child (Conversations, Mail, Chat, Video Conference). The hub itself, its route `/conversations` and the Needs-linking queue are unchanged. The group is where people **write, chat and meet**; Conversations is where it is **recorded**.

Consequence for V1: the sidebar changes, so V1 role journeys and pixel baselines (FIG-1115, FIG-1117) must be updated after F6.20 lands. With the V1.1 flag off the group shows Conversations only.

## In scope

**Navigation shell (all three)**
- Collapsible "Communication" group in `src/ui/shell/navigation.ts` with Mail, Chat, Video Conference, active-child highlight, mobile drawer, role-aware visibility, explained "no access" instead of silent hide.
- Per-role visibility and feature flags (V1.1 / V2, per organisation).

**Chat (internal team chat)**
- Public and private channels, direct messages, member list, unread counts, presence (online/away), search.
- Composer: text, attachments (virus-scanned file path already in use), emoji, @mention of people.
- **CRM-native extras (the reason to build it here):** a channel or thread attached to a deal, company or lead; paste a record card; @mention notifies through the existing notifications.
- Org-scoped, RLS on every table, cross-organisation test, audit of channel create/delete/member change.
- Masking: a record card shared in chat shows deal value, margin, cost and payments by the **viewer's** role, not the poster's (rule 7). A user who cannot open a record sees "no access", not the data.

**Mail**
- Inbox view of the organisation's logged email (builds on the inbound-email webhook and needs-linking queue) and the user's connected mailbox (builds on Settings > Email and calendar, FIG-1175).
- Compose, reply, forward from a record; templates; link to lead/deal/company/contact; send is logged to the timeline; idempotency key on send.
- Drafts and scheduled send run on the job framework (FIG-1066), not an ad hoc scheduler.
- Automations may draft mail, never send on their own decisions that move a deal (rule 9).

**Video Conference (meetings, not a video engine)**
- Start or schedule a meeting from a record: generates a link through the connected calendar provider (Meet or Teams per S7#2), creates the calendar event, attendees from contacts, logs a "Meeting" on the timeline, optional follow-up task.
- Upcoming meetings list and "join" button.

## Out of scope (proposed)

- A full mail client: folders, labels, filters, IMAP rules, multiple accounts per user, mail-merge campaigns.
- Our own WebRTC video, recording, transcription, screen-share. (Candidate for V2 with a vendor SDK, decision needed.)
- Customer-facing live chat widget, WhatsApp inbox (stays in Conversations).
- Chat threads-in-threads, voice notes, message edit history, bots, external guests in channels, federation with Teams/Slack.
- Anything for the Platform Super Admin console.
- Changing Conversations, the frozen auth pages, or the V1 API contract (`openapi.v1.json`): new routes only.

## Open decisions for Given / Michael

1. **Release train.** Proposal: shell, Chat and Mail view in **V1.1** (built on demo data now, wired in M13); Video meeting-links in V1.1; vendor video SDK, if wanted at all, **V2**.
2. **Date risk.** The 22 Nov date does not move and V1 is never cut. This is new scope with a backend (realtime, storage, new tables). Proposal: put it **first in the cut order** (before E1) unless Given says otherwise.
3. **Roles.** Who gets Chat/Mail/Meetings? Proposed: Management, Sales, Delivery, Finance, Customer Support full Chat; Restricted Technical Chat limited to channels they are added to; Mail for Management, Sales, Customer Support, Delivery read-only (as in Conversations); Finance no Mail by default.
4. **Realtime transport.** Polling/SSE now, WebSocket later, or WebSocket from the start. Affects hosting and cost.
5. **Mail source.** Org shared mailbox only, or each user's own mailbox (OAuth)?
6. **Retention and erasure** of chat messages (link to `docs/PRIVACY.md`).

## Issues in Linear (created 29 Oct 2026, all in Backlog, no status changed)

| Issue | Milestone | Title |
|---|---|---|
| FIG-1378 | M10 | F6.20 Communication group in the sidebar (Conversations moves in) |
| FIG-1379 | M10 | F6.21 Chat workspace |
| FIG-1380 | M10 | F6.22 Mail workspace |
| FIG-1381 | M10 | F6.23 Video Conference (meetings) |
| FIG-1382 | M13 | B6.24 Chat data model and API (RLS) |
| FIG-1383 | M13 | B6.25 Chat realtime, presence, unread |
| FIG-1384 | M13 | B6.26 Communication permissions, masking, mentions, search, audit |
| FIG-1385 | M13 | B6.27 Chat privacy: retention, export, erasure, docs |
| FIG-1386 | M15 | Q2.05 Communication group: E2E, permissions, isolation, accessibility |

Mail and meeting backends reuse existing issues instead of new ones: FIG-807 (mail sync, now also send and drafts), FIG-808 (calendar sync, now also meeting links), FIG-1153 (OAuth scopes).

## Existing issues modified

Description appended ("Added scope"): FIG-807, FIG-808, FIG-1153, FIG-1156 (G2.01), FIG-1179 (Q2.01), FIG-1180 (Q2.02).
Comment only: FIG-1159 (G2.04 gate), FIG-1115 and FIG-1117 (V1 QA, sidebar change), FIG-1098 (Conversations, moved not rebuilt), FIG-1175 (settings).

Still to do when the screens are built: add F6.20 to F6.23 to the demo-data table in `docs/RESTRUCTURE_LOG.md`.
