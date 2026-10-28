# M8 contacts (F3.02, FIG-1096; UI of FIG-791)

Design: `design-spec/CrmCustomers.dc.html` (contacts list and Contact detail), `CrmOverlays.dc.html` (New contact drawer, Import, "How did it go?" log prompt). Design reference C3. Code: `src/ui/screens/contacts/`, stylesheet `contacts.css`, routes `contacts` and `contacts/[contactId]` (thin server pages that record the page view). Tests: `tests/components/screens/contacts/` (27 tests, scratch config `vitest.contacts-components.config.ts`, no database), `e2e/contacts.spec.ts`; `e2e/contacts-companies.spec.ts` (contact chain) and `e2e/csv-import.spec.ts` were adapted to the new screens with their assertions intact.

## What is built

- **List** (`ContactsScreen`): four tiles (Contacts, Mine, No company, Missing email), tabs **All / My contacts / No company / Missing email / Archived** with counts, search over name, email, phone and company (server side, paged 25/50/100), a row per contact (name and job title, company link or "No company", email and phone, owner, reach), **New contact** drawer, **Import CSV** (`contacts.import`), **Export CSV** (`contacts.export`). Tiles and tab counts come from `listContactDirectory`'s `counts` plus a one-row read for "mine", so they do not move with the search. Empty, no-results, error-with-retry, loading and the explained no-access (403) states are all there. `?new=1` opens the drawer (quick create), `?q=` and `?view=` preselect search and tab.
- **Contact page** (`ContactDetailScreen`): avatar and name, "title at Company", Edit / Merge / Archive, the wide **Call {first}** and **Open WhatsApp** buttons plus **Email**, the facts grid (phone, email, department, social profile, owner, company), a Company card (or "Standalone contact" with **+ Link a company**), **Recent conversations** (calls, WhatsApp, email and meetings from the activity timeline, plus messages that are not already an activity, so a logged call shows once), open **Tasks** with **+ Add**, and the shared `RecordExtras` panel (`kind="contact"`). Archived: a read-only banner, no actions, Restore for `contacts.archive`. Owner is a select for people who may reassign (`contacts.edit` and `membership.manage`).
- **Drawer** (`ContactDrawer`): first name is the only required field; company is picked by typing (server search) or "+ New company…" (needs `companies.create`) or left empty for a standalone contact; owner is Management's choice. It also edits. Reusable with `companyId` to start a contact from a company page.
- **Call and WhatsApp, then the log prompt** (`QuickLogPrompt.tsx`): `ReachButtons` render `tel:` and `wa.me` links (numbers without a country code are taken as Kenyan, the same rule as the API). Clicking one calls `begin(target, channel)`; when the person returns to the tab (`visibilitychange` after hidden, or `focus` after `blur`) `QuickLogPrompt` opens: pick **Reached / No answer / Left a message**, optionally one line and a next action, **Log it** (two taps). One `quickLog` request saves the timeline entry, the conversation and an optional follow-up task due tomorrow, with one idempotency key per prompt so a double tap logs once. If the tab never loses focus (a desktop with no phone app) the prompt still opens after 2.5 s; if a phone browser discards the page while the call app is in front, the pending log is kept in `sessionStorage` (30 minutes) and offered on reload. Skip logs nothing.
- **Reusable for M9 and Customer 360:** `useCallLogPrompt()` returns `{ begin, element, isOpen }` (render `element` once); `ReachButtons` takes `variant` `row | card | wide`; `QuickLogPrompt` can also be mounted directly with a target (`contactId`, `leadId`, `companyId` or `dealId` plus the name to show).

## Masking and access

Contacts carry no deal value or payment, so nothing here is masked. What each role sees is the API's `contacts.*` and `communications.create` keys, read through `useMember()`: Sales and Management edit, archive and merge; Delivery and Customer Support may view and reach; Finance may view only (no Call, no WhatsApp); Restricted Technical has no `contacts.view` and gets the explained no-access page from the 403. Every action is checked again by the API.

## Decisions taken without asking

1. **Reach is gated by `communications.create`**, the key the quick-log endpoint needs, not the design's `activities.create`. Finance (no key) sees a read-only list with no Call or WhatsApp; Delivery does.
2. **The prompt logs against the contact** (`contactId`); the API resolves the company, lead and deal links, where the prototype passed the company or lead itself.
3. **"Social profile" is shown but not editable**: the create and update endpoints have no field for it. The drawer omits it.
4. The design's list has no row actions beyond reach; **Edit, Merge and Archive are on the contact page**. An archived row shows Restore.
5. "Mine" tile and tab use `ownerMembershipId` = the person's own membership; the tab is offered only to people who can edit (as in the design).
6. Import uploads the whole file in one request (the contacts endpoint streams it; the 25 MB limit applies) rather than in 500-row chunks, with a column-mapping step and "skip" or "create anyway" for duplicates. Export downloads the filtered list; above 500 rows the API asks for the bulk-export right and the dialog shows its explanation.
7. Tasks link to the Tasks page (the page has no per-task deep link); a new task is assigned to the person adding it.
8. The old forms (`CreateContactForm`, `EditContactForm`, `ContactRefs`, `ContactRowActions` under `src/app/o/[orgSlug]/contacts/`) are no longer used by any page. They were **not deleted** (file deletion needs Given's say-so) and stay in the `.eslintrc.json` fetch list, which the guard keeps honest.

## Known gaps

- No per-contact "Open in Customer 360" beyond the company link, and no tag editor of its own: tags, custom fields, attachments and comments arrive with the shared `RecordExtras` (F3.08), which is a stub until that issue lands.
- The Conversations hub (F3.04) is the place for unlinked messages; the contact page lists only what is linked to the contact.
- The component tests use the API's response shapes written out by hand (the contract types the contact rows loosely); Playwright specs are written but were not run in this build (no database available), so they need one run against a seeded database.
