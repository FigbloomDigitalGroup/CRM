# Mobile and PWA (M9, Frontend 4)

Issues: F4.10 (FIG-1112), F4.11 (FIG-1113), F4.12 (FIG-1114) and FIG-791. Design: `design-spec/CrmMobile.dc.html` (screens M1 to M3, S3 PWA part). Backend: B4.07 sync and push (`docs/SYNC_AND_PUSH.md`), B4.08 quick capture, B3.08 quick log.

## How the phone layout is served

- **Phone routes** live under `/o/{org}/m` (`src/app/o/[orgSlug]/m/`): Today (`/m`), Leads (`/m/leads`), Customers (`/m/customers`), Tasks (`/m/tasks`), Notifications (`/m/alerts`), the read-only pipeline (`/m/pipeline`) and one record screen for a lead, person, company or deal (`/m/record/{lead|contact|company|deal}/{id}`).
- **The frame.** `AppShell` draws the desktop sidebar and top bar everywhere except under `/m`, where it draws `MobileFrame` instead (`src/ui/screens/mobile/MobileFrame.tsx`): dark header (organisation tile, notification bell with the unread count, your initial), the offline and sync banner, the page, the bottom bar with the raised orange Capture action, and the sheets (quick capture, log, More, identity, waiting list).
- **Who sees which tab** is a pure function of permission keys (`tabs.ts`, tested), never of a role name: Sales and Management get Today, Leads, Capture, Customers, Tasks; Delivery and Support get Today, Customers, Note, Tasks; Finance gets Today, Customers, Alerts; the technical role gets My work, Tasks, Alerts. The server still checks every call.
- **Phones land on the phone version.** On a viewport of 640 px or less, the organisation's entry pages (home, leads, tasks, companies, contacts, notifications) redirect to their phone twins (`PhoneRouter` in `PwaClient.tsx`, table in `tabs.ts`). More has "Use the desktop view", which keeps the desktop pages until the tab is closed. Every other page is the responsive desktop page (see the FIG-791 list below). Tablets and desktops are never redirected.

## F4.10: Today, Leads, quick capture

- **Today**: date and greeting, three count tiles (overdue, due today, new leads or open tasks; Finance sees overdue payments, awaiting payment, to invoice), "Do these today" with a tick that completes the task (works offline), "New since your last visit", and the Add to Home Screen card. The technical role sees "Assigned to me" from `GET /my-work`.
- **Leads**: search, one card per lead (status, service, next follow-up in red when overdue, temperature), opens the record.
- **Quick capture** (`CaptureSheet`): name is the only required field; phone, service, source chips, an optional note and "Remind me to follow up tomorrow". One request to `POST /quick-capture` with an idempotency key. A likely duplicate answers 200 `DUPLICATE_WARNING`, nothing is created, and the sheet offers **Open**, **Add this to them** (merge) or **Save as new anyway**. Offline, the capture is kept on the phone (below).

## F4.11: customer lookup, record, log sheet, tasks, notifications, More, pipeline

- **Customer lookup**: people (or companies for a role without contacts) with a 44 px Call button. **Record**: initials, name, badge, **Call** and **WhatsApp** (`tel:` and `https://wa.me/<digits>`), Add a note, the facts and the latest timeline. A deal's value shows "hidden" for a role that may not see it (the API says so with `valueMasked`). Call and WhatsApp appear only for people allowed to log activity.
- **How did it go?** Tapping Call or WhatsApp stores a pending note; when the person returns to the app (visibility, focus, or after 2.5 s where the tab never loses focus) the log sheet slides up: outcome (Reached, No answer, Left a message: the three values the API has), what was said, next action with Tomorrow, In 3 days, Next week. Saved through the queue as `CALL_LOG` or `WHATSAPP_LOG`; a note is `NOTE_ADD`, and its next action is a `TASK_CREATE`.
- **Note** in the bar (Delivery, Support) asks who it is about first (people and companies search).
- **Tasks**: Overdue, Today, Upcoming, Done. **Notifications**: unread first, tap marks read and opens the record's phone screen; Mark all read. **More**: Pipeline or Won deals, Notifications, Waiting to sync, Alerts on this phone, Preferences, light/dark (disabled with the reason when the organisation locks the look), Install app, Use the desktop view, Sign out.
- **Pipeline is read-only** on the phone: a note says why ("Moving a deal to another stage is done on a laptop, so nothing is overwritten while you are offline") and there is no Move control. This matches the server, which never applies `STAGE_CHANGE` or `OWNER_CHANGE` from the queue.

## F4.12: PWA, offline queue, push

| Piece | Where | What it does |
|---|---|---|
| Manifest | `GET /api/orgs/{org}/pwa/manifest` linked from the organisation layout (`crossorigin=use-credentials`) | The organisation's own name and colours. Icons are real 192 and 512 PNGs plus a maskable one in `public/icons/` (generated from the design's logo mark); `pwaService` lists them. |
| Service worker | `public/sw.js`, served with `Service-Worker-Allowed: /o/` and registered with scope `/o/` | Keeps `/_next/static` and the icons, shows `public/offline.html` when a page cannot be fetched, receives push, opens only a path inside `/o/` on tap. It **never stores an API answer or an HTML page** (tenant data, masked per role). It is registered only from the organisation shell, so the sign-in pages are untouched. |
| Cache version | `getPwaVersion` compared in `PwaClient` | A different version clears the worker's caches. |
| Install | `pwa.ts` `installState` | Captures `beforeinstallprompt`; the Today card and More offer Install; iPhone gets the "Share, then Add to Home Screen" instruction (Safari has no install prompt). Hidden once installed or dismissed. |
| Offline banner | `MobileFrame` (phone) and `ConnectionBanners` (desktop), fed by the connectivity service | "Offline · N changes waiting to sync" with Details; a red banner when changes need attention; a slow-connection line. |
| Queue | `queue.ts`, one per person and organisation, kept in `localStorage` | Each action is saved first with a client id (`m-<uuid>`), then sent to `POST /sync/batch` in the order made. |
| Push | `PushToggle.tsx` in More | Subscribes this device with the public key from `GET /push/config` and registers it (`POST /push/subscriptions`); removing it revokes it. Says why when it cannot (no browser support, server not configured, blocked, iPhone not yet installed). Which events are pushed is chosen in the notification preferences. |

**Why no duplicates.** The write path is "queue first, then send": online and offline are the same path. A client id is claimed by the server before the action runs, so a dropped connection after the server applied it leaves the entry waiting, the retry sends the same client id, and the server answers `DUPLICATE` (the entry is then removed). Only `APPLIED` and `DUPLICATE` remove an entry. Tested in `tests/components/mobile/queue.test.ts` and, against the real API, in `e2e/mobile-offline.spec.ts` (and the server side in `tests/sync.test.ts`).

**Conflicts are explained, never silent.** `CONFLICT` and `REJECTED` keep the entry with the server's reason in plain words and are never resent by themselves. Waiting to sync lists each entry; a duplicate capture offers Open existing, Add to them, Save as new; anything else offers Send again or Discard. The server wins on stage and ownership, always.

## FIG-791 acceptance, one by one

| Criterion | Where it is met |
|---|---|
| Every page usable at 375 px: collapsible drawer, tables scroll or stack, single-column forms | The desktop pages keep the M6 drawer menu (button below 640 px); `mobile.css` ends with the phone rules (tables scroll inside their own container, 16 px inputs, 44 px buttons). `e2e/mobile-pages-375.spec.ts` walks 16 pages and fails on any sideways scroll. |
| `tel:` and `wa.me` on contact, company and lead records, and using one prompts a log | Contact and company pages (M8, `ReachButtons` and the log prompt) and the phone record screen for lead, contact, company. Tested in `e2e/mobile-core.spec.ts`. |
| Notification bell works on mobile | The phone header bell with the unread count opens `/m/alerts`; the desktop bell is in the top bar at 375 px. |
| PWA manifest and icons so it can be added to the home screen | Organisation manifest linked in the layout, PNG icons, apple-touch-icon, service worker, install card. |
| Playwright runs the core flows in a mobile viewport project | `mobile-chrome` project in `playwright.config.ts` (`e2e/mobile-*.spec.ts`). |

## Decisions taken without being asked

1. **Separate phone routes (`/m`) instead of making every screen two-faced.** The design's phone screens are different screens (bottom bar, sheets, one-handed lists), so they are their own routes; the desktop pages stay responsive. Redirecting entry pages on phones, with a "desktop view" escape, keeps old links working.
2. **The log sheet's outcomes are the API's three** (Reached, No answer, Left a message), not the prototype's five demo chips, because the API accepts only those.
3. **Left out of V1, by the design's own release tags:** "Scan business card", "From a WhatsApp chat" and "Attach photo" are V1.1 (M4 in the checklist, F6.18); temperature on quick capture is not in the capture API.
4. **Writes go through the queue even online** (one path, one dedupe rule); only quick capture calls its own endpoint first, because it must show the duplicate warning at once.
5. **No API or page is cached by the service worker.** Reading offline is limited to what is already on screen; the offline page shows how many changes are waiting.
6. **Preferences link** points at `/o/{org}/preferences` (built by F4.01); the top-bar "Profile and preferences" link was already moved there.

## Where to test (by hand)

1. Sign in as Sales on a phone, or in a desktop browser narrowed to 375 px (DevTools device mode). You land on Today. Tap the orange button, type a name and Save lead: you land on the new lead. Capture the same name and phone again: the warning appears first.
2. On a lead with a phone number tap Call. Come back to the tab: "How did the call with X go?" appears. Pick Reached, Save to timeline.
3. Turn the network off (DevTools, Offline). The orange banner says Offline. Capture a lead: "Saved on this phone". Tap Details to see it waiting. Turn the network on: the banner clears and the lead is in Leads once.
4. More, then Pipeline: read-only note, no Move control. More, then Alerts on this phone: turn on (needs a push-capable browser and `VAPID_*` configured).
5. Chrome on Android: the Install card on Today, or the menu's Install app.
