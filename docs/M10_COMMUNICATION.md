# M10: Communication group (demo data)

Issues: FIG-1378 (F6.20), FIG-1379 (F6.21), FIG-1380 (F6.22), FIG-1381 (F6.23). Scope and decisions: `docs/COMMUNICATION_HUB_SCOPE.md`. Backend that wires these screens in M13: FIG-1382 to FIG-1385 (chat), FIG-806, FIG-807, FIG-1153 (mail), FIG-808, FIG-1153 (meetings). QA: FIG-1386.

**Mail, Chat and Video Conference run on demo data** (course change of 29 Oct 2026, `docs/RESTRUCTURE_LOG.md`). The issues are **not Done** until they are wired to the real API and tested against it (M13 and M14). Conversations is the real, built screen (F3.04); only its place in the sidebar changed.

## What changed in the sidebar

A collapsible **Communication** group sits between Customers and After the sale. **Conversations moved into it** (same page, same route `/conversations`, same Needs-linking queue) and no longer appears under Customers. Mail, Chat and Video Conference sit beside it.

| Link | Route | Shown to | Why |
|---|---|---|---|
| Conversations | `/conversations` | `communications.view` | unchanged rule |
| Mail | `/mail` | `communications.create` | needs the right to send, so read-only roles are not offered a screen they cannot use |
| Chat | `/chat` | every member of the organisation | a platform identity has no keys and sees nothing |
| Video Conference | `/video` | `tasks.view.own` or `tasks.view.all` | follows the calendar's permission |

These stand-ins use existing permission keys. B6.26 (FIG-1384) replaces them with their own keys. Mail, Chat and Video Conference are drawn only where demo screens are on (`demo: true` in `src/ui/shell/navigation.ts`), so production links to no 404; with demo screens off the group holds Conversations only.

The group opens by itself on a page it holds, remembers the person's own open or closed choice on this device (`figbloom-sidebar-groups`), opens while the filter box is in use, and in the icon-only sidebar the links stand on their own. The header shows the sum of its links' counts when closed. **The Chat unread count in the header comes with the real API** (nothing server-side supplies it yet), so today the header shows a count only where a link is given a badge.

## Where it lives

| What | Where |
|---|---|
| Group, icons, collapsible sections | `src/ui/shell/navModel.ts`, `navigation.ts`, `Sidebar.tsx`; styles at the top of `communication.css` |
| Screens | `src/ui/screens/communication/` (`ChatWorkspace.tsx`, `MailWorkspace.tsx`, `VideoConference.tsx`) |
| Demo data and store | `src/ui/screens/communication/demo/data.ts` (records and the pure rules), `store.ts` (the only place that changes them, in memory) |
| Pages | `src/app/o/[orgSlug]/chat`, `mail`, `video` (404 unless `demoScreensEnabled()`) |
| Tests | `tests/uiNavigation.test.ts`, `tests/communicationDemo.test.ts`, `tests/components/communication/`, `e2e/m10-communication.spec.ts`, `e2e/ui-shell.spec.ts` |

## Rules the screens follow

- **Masking (hard rule 7).** A record card in chat is drawn from `viewCard(card, can)`: deal values need `deals.view.value`, margins `deals.margin`, payments `finance.view.payments` (Finance and Management). A masked figure is `null`, never a number, so it cannot leak by formatting. A member with no customer access sees "Record not available" instead of the card. This is by the viewer's role, not the poster's.
- **Chat visibility.** A channel shows only to a person with its permission (sales-team and the deal channel need customer access, finance-desk needs payments, leadership needs configuration). Restricted Technical sees only the channels it was added to.
- **Mail.** Anything sent is tied to a record or waits in Needs linking, and the message says it is logged on the timeline and in Conversations. Mail linked to a colleague's lead is hidden from a person without `leads.view.all`, and the screen says how many are hidden. An automation's draft is marked and only a person can send it (hard rule 9). Sending is blocked, with the reason, until the mailbox is connected.
- **Video Conference.** A meeting is a link through the connected calendar provider (Google Meet or Teams), not a video engine. Scheduling validates title, attendees and date; a contact with no email is flagged before invites go out; cancelling asks first.
- **Connection state** is the one Settings > Email and calendar keeps (`figbloom-demo-connections:{org}`, FIG-1175), so connecting in either place shows in both. The Connect buttons on these screens simulate the provider sign-in, as Settings does.

## What is simulated

Messages, mail, meetings, presence, "was notified" toasts and attachments (only the file name is kept) live in memory and reset when the page reloads. Nothing is sent, stored or uploaded. Real delivery, realtime, unread counts, attachments, retention and erasure arrive with B6.24 to B6.27, and sending and meeting links with FIG-807, FIG-808 and FIG-1153.

## To wire in M13

Replace `demo/store.ts` with API hooks of the same shape (`useChat`, `useMail`, `useMeetings`, `useConnection`), remove the `demoScreensEnabled()` check from the three pages and `demo: true` from the three nav entries, swap the stand-in permission keys for B6.26's, supply the Chat unread count as `badges.chat`, then delete the screens from the demo table in `docs/RESTRUCTURE_LOG.md`.
