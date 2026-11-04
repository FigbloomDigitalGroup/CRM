# Communication: Chat backend (B6.24 to B6.27)

Issues: FIG-1382 (data model and API), FIG-1383 (delivery, presence, unread), FIG-1384 (permissions, masking, mentions, search, audit), FIG-1385 (privacy). Scope and the demo screens: `docs/COMMUNICATION_HUB_SCOPE.md`, `docs/M10_COMMUNICATION.md`. Mail and meetings backends are FIG-807, FIG-808 and FIG-1153 (not here).

## Data model (migration `20261106090000_chat_data_model`)

Eight tenant tables, each with `organization_id`, row-level security forced (`tenant_isolation`) and composite `(organization_id, id)` foreign keys, so nothing can point into another organisation. The platform database role has no privilege on them.

| Table | Holds |
|---|---|
| `chat_channels` | PUBLIC, PRIVATE, DIRECT (one per pair, `direct_key`) or RECORD (deal, company or lead; one active per record); `last_seq`, archive state |
| `chat_channel_members` | membership, OWNER or MEMBER |
| `chat_messages` | text (max 4000), per-channel `seq` (1, 2, 3, no gaps, taken under a lock on the channel row), optional card reference (DEAL, COMPANY, LEAD, INVOICE), soft delete, `erased_at`, `updated_at` |
| `chat_message_mentions`, `chat_message_attachments`, `chat_reactions` | what hangs off a message (attachments use the existing file path and virus scan: the file must be READY, purpose ATTACHMENT, owned by the poster) |
| `chat_read_markers` | last read `seq` per channel and person |
| `chat_presence` | last seen (online for 60 seconds), typing channel and expiry (6 seconds) |

## Rules

- Permissions (V1.1, per role in `prisma/seedData.ts`): `chat.view`, `chat.post`, `chat.channels.manage`, `mail.use`, `meetings.schedule`. Management has all five; Sales, Delivery and Customer Support: view, post, mail, meetings; Finance and Restricted Technical: view and post. The Communication group is also an organisation toggle, `communication.group` (V1.1, default on).
- Visibility: a PRIVATE or DIRECT channel is a 404 to everyone who is not a member, Management included. PUBLIC channels are readable by all except limited members (no `companies.view`, i.e. Restricted Technical), who see only channels they were added to; posting needs joining. RECORD channels need the right to open the record to join or read, re-checked on every call and every sync.
- Masking is by the viewer (rule 7): a card shows deal value only with `deals.view.value` or ownership, payment due only with `finance.view.payments`, an invoice card only to Finance and Management; a record the viewer cannot open is `noAccess` with no name. Text in a deal's own channel, or sent with a deal or invoice card, has money replaced by `[value hidden]` for viewers who may not see it. Search matches on what the viewer sees, so a hidden figure cannot be found.
- Mentions are stored for people who can read the channel; the notification (type MENTION, so the person's own preferences and push apply) goes only to a person who can open the record the message names, with money hidden by what they may see. A direct message notifies the other person. Delivery is the `chat.notify` job, queued on post.
- Audit: `chat.channel_created|renamed|archived|restored|deleted`, `chat.member_added|removed|joined|left`, `chat.message_deleted`, `chat.member_erased`. Channel names and counts only, never message text. (Mail send is audited by FIG-807.)
- Global search (`GET .../search`, and a `messages` group in `searchAll`, `type=messages`) returns only messages the caller can read.

## API

New routes only, listed in `NOT_IN_V1_CONTRACT`; the V1 contract is untouched. Under `/api/orgs/{org}/chat/`: `channels` (GET, POST with Idempotency-Key), `channels/{id}` (GET, PATCH rename and archive, DELETE an archived channel), `channels/{id}/join|leave|read|typing`, `channels/{id}/members` (and `{membershipId}` DELETE), `channels/{id}/messages` (GET `before`, `after`, `limit`; POST with Idempotency-Key), `messages/{id}` DELETE, `messages/{id}/reactions` POST and DELETE, `messages/{id}/attachments/{fileId}` (signed link), `unread`, `people`, `presence`, `sync`, `search`.

## Transport decision (taken without being asked; Given may change it)

Polling with a cursor, plus an optional long poll (`waitSeconds` up to 20). It needs no open connection, so it works on Vercel functions and plain Node, and it re-checks membership on every call (a removed member stops receiving at the next call, within one second of a long poll). The client sends `known[channelId]=<highest seq held>` and `since=<previous serverTime>`; the server returns exactly the messages above those numbers (gapless numbers: none missed, none twice), messages changed since (deleted, reacted to; 5 second overlap, harmless to repeat), per-channel unread and mention counts, presence and typing. Offline queue: the client replays posts with the same `Idempotency-Key`. SSE or WebSocket can replace the polling later without changing the data.

## Privacy (B6.27)

See `docs/PRIVACY.md` (chat section): retention setting `chatMessages`, organisation export (`scripts/export-organization.ts` writes `chat_*.csv`), member erasure (`eraseMemberChat`, default anonymise, policy `DELETE` available), contact erasure scrubs chat text that names the person.

## To wire the Chat screen (not done: the M10 demo screens still run on `demo/store.ts`)

Replace `demo/store.ts` with hooks on the routes above, swap the nav stand-in keys for `chat.view`, `mail.use` and `meetings.schedule` (the Video Conference entry follows the task permission today, which Restricted Technical has; the decision gives that role no meetings key, so its menu changes), pass `unread` as `badges.chat`, remove `demo: true` and the `demoScreensEnabled()` checks, and update the table in `docs/RESTRUCTURE_LOG.md`.

## Known gaps

- Deal cards show no margin (the schema has no margin column); the `deals.margin` rule is ready when one exists.
- The `apiWalk` golden files (`src/api/contract/accessMatrix.json`, `docs/PERMISSION_MATRIX_REPORT.md`) need regenerating with `UPDATE_API_SNAPSHOTS=1`; the walk world has no channel ids, so chat routes are walked with unknown ids.
- B6.09 (offboarding workflow with two-person approval) is not built here; it should call `eraseMemberChat`.
- The mail and meetings keys exist but no routes use them yet.
