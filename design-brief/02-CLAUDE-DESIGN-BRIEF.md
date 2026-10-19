# Claude Design brief: Figbloom CRM makeover

Paste this into Claude Design as the main prompt. Attach `03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md` and `04-BRAND-TOKENS.md` as reference files, plus the logo and current screenshots (list at the end).

---

## 1. What we are making

A **clickable, role-aware prototype of the complete Figbloom CRM**, from sign-in to settings, for each of five user roles. It is a **makeover of an existing, working product**: the backend, permissions and most screens already exist. The prototype becomes the single source of truth for the front-end build, so every screen, state and role difference should be visible in it.

Keep the **colour identity** (deep green and orange) and make everything else **more modern, calmer and faster to use**.

## 2. The product in one paragraph

Figbloom Digital Group sells web, software, branding, social media, CCTV, Starlink and automation services to organisations and individuals in Kenya. The CRM replaces spreadsheets, phone contacts and WhatsApp memory. Its job: **capture every lead, give it an owner, remember every follow-up, show the pipeline, keep the full customer history in one place, and hand won deals to delivery.** Core flow:

Lead capture, qualify, assign, contact, needs identified, solution presented, proposal, negotiation, **Won / Lost**, onboarding, delivery handoff, customer, retention and renewal.

Lead, Deal and Customer lifecycle are three **separate** concepts. A lead becomes a deal (conversion is a workflow); a won deal moves the company into a customer lifecycle state.

## 3. Who uses it (design for these five, plus a tenth of a mind on future subscribers)

| Role | Who | Their day |
|---|---|---|
| **Management** (for example Michael, Alex Mwangi as Sales Manager sponsor) | Oversight, reporting, approvals, reassigning leads, team and settings admin | Wants the pipeline and team follow-up health at a glance, without chasing people. "Not a surveillance tool" is the tone to keep. |
| **Sales** (primary daily users; two accounts in dev) | Capture and work leads, run deals, log calls, clear tasks | Opens the CRM and wants to know **what to do today**. Often on a phone. Hates long forms. |
| **Delivery** | Post-sale: client profile, won-deal scope, requirements, onboarding | Needs context after a deal is Won, no sales history editing, no pricing. |
| **Finance** | Won-deal values, contract amounts, payment and invoice status | Should not browse the open pipeline or unqualified leads. |
| **Restricted Technical** (developers and designers) | Assigned work only | Narrowest scope: tasks, and the client requirements relevant to that work. No other clients, no pricing. |

Volume is small: roughly 5 to 10 new leads a month and 2 to 5 active customers today, a handful of staff. **Optimise for clarity and speed, not enterprise density.** Future external subscribers are possible but **billing, self-service onboarding, white-labelling and advanced tenant administration are explicitly out of scope.**

## 4. Design principles (from the stakeholder's own words)

1. **"It tells me what to do today without me asking."** Every role's home screen is action-first.
2. **Open a customer, instantly know everything.** One Customer 360 view; no chasing colleagues.
3. **Few required fields.** Logging a call must take seconds, with one clear next action.
4. **Capture is fast, ideally from a phone.**
5. **Simple by default, deep on demand.** Same system, different surfaces per role. Configuration is an admin concern.
6. **Automation assists, never decides.** It may assign, remind, flag stalled deals and acknowledge enquiries. It **never moves a deal's stage on its own.**
7. **Duplicates warn, never block** (except on the public website endpoint).
8. **No surveillance feel.** Activity logging should feel like helping yourself, not reporting to a supervisor.
9. **Role honesty.** Hide what a role cannot use, and when a role reaches something it cannot see, explain why rather than showing a bare error.

## 5. Visual direction

Use `04-BRAND-TOKENS.md` as the starting palette. Intent:

- Deep green is the primary brand and action colour; orange marks attention, next action and highlight. Warm off-white page, white cards.
- More modern than today: clearer type hierarchy, generous spacing, softer elevation, refined iconography, subtle motion, consistent 4/8-point grid, rounded but not bubbly.
- Font today is Instrument Sans; keep it or propose a better pairing and justify it.
- **Light and dark themes**, both first-class.
- Accessible: WCAG AA contrast, visible focus, never colour alone for status.
- Charts: thin marks, recessive grid, direct labels, a table alternative, colour order fixed per category.
- Provide a small **design system**: colour ramps, type scale, spacing, radii, elevation, buttons, inputs, searchable select, drawer, modal, table, card, KPI tile, badge, scope pill, owner chip, toast, empty state, skeleton, timeline item, Kanban card, chart styles. Name components so engineers can map them (existing names are in `04-BRAND-TOKENS.md`).

**Reconcile the logo and CSS greens/oranges** and tell us which pair you chose.

## 6. Global shell

- Sidebar with sections (Overview, Sales Workspace, Customers, Reports, Settings), collapsible, with in-nav search; **bottom tab bar or drawer on mobile**.
- Top bar: global search (records across leads, contacts, companies, deals), notification bell, theme toggle, user menu (profile, notification preferences, sign out).
- A **scope pill** on every list and detail page: Own, Organisation, Read-only.
- Quick-create ("+") that works from anywhere: lead, task, note/call log, contact.
- Breadcrumbs or back-links on detail pages. Consistent page header with title, scope, primary action.

## 7. Screens to design (full list and status in `03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md`)

### 7.1 Auth: FROZEN, do not redesign
The sign-in and sign-up pages (and the forgot-password, reset-password and accept-invite pages that share their look) are **approved as they are** and must not change. Do not redesign, restyle or reinterpret them. Use the attached screenshots as-is, as non-interactive reference frames in the prototype, so the flow runs sign in, then the workspace. Treat their colours, logo placement and type as a **fixed anchor** that the rest of the product should feel consistent with. Only the states that are missing from them (for example session expired) may be proposed, as separate additions.

### 7.2 Home dashboard (**biggest gap: design one per role**)
- **Sales:** follow-ups due today; overdue (count in red); new leads since last visit; deals moving and **stalled** (untouched N days); pipeline value by stage as a compact funnel bar; quick actions.
- **Management:** the Sales items for the team, then this month vs last: new leads, conversion, won/lost; revenue by service line; salesperson performance and responsiveness; dormant clients and upcoming renewals; adoption health (page-usage metric exists).
- **Delivery:** newly handed-off won deals needing an owner; onboarding tasks due; my tasks.
- **Finance:** won deals awaiting payment or invoice status; payment follow-ups (payments surface is new, see 7.9).
- **Restricted Technical:** my assigned tasks and the requirements attached to them; nothing else.
- All with a proper first-run empty state ("Nothing here yet, start with...") instead of placeholder text.

### 7.3 Leads (Management, Sales)
List with filters (status, temperature, source, owner, service), search, own-vs-all scope, bulk and row actions; **lead detail** with status and temperature, source, service interest, qualification, next follow-up, owner, activity and communication timelines, tasks, audit history; **create and edit drawer** (few required fields); **qualification section** that adapts per service (for example property and internet: units managed, occupied units, current provider); **reassign** (Management only; Sales sees it disabled with a reason); **convert to deal** (finds or creates company and contact, carries history, prevents duplicate conversion); mark lost with a structured reason; archive and restore; duplicate warning; CSV import and export; website-lead badge and acknowledgement status.

### 7.4 Deals (Management, Sales; Delivery and Finance read-only)
**Kanban board** with drag-and-drop between stages (needs a touch fallback "Move to..."; moving to a lost stage asks for a lost reason; moving to won triggers the handoff prompt), list view, column counts and totals (value hidden as "Values hidden" for roles without value access), stalled and expected-close flags; **deal detail**: company, primary contact, service, owner, stage, value, expected close, source, proposals (number, status, amount, sent, approval, document reference), timelines, tasks, audit; create and edit; reassign; archive and restore.

### 7.5 Won-deal handoff (new)
A handoff dialog on Won: choose a Delivery owner, confirm onboarding task template, move the company to the Customer lifecycle state, notify Delivery. Shows on deal and company timelines. Include the **Delivery receiving view**: scope, requirements, assigned team, start date, status, deliverables, notes. Do **not** turn this into a project-management tool.

### 7.6 Customers (Companies and Contacts)
Lists with lifecycle filter, owner chip, contact counts; **Customer 360** (company is the anchor): summary, lifecycle state, services and projects (multiple services per customer), contacts, open deals, tasks, next follow-up, requirements, quotes and proposals, outstanding issues, communication and activity timeline, payments (Finance and Management), audit; merge duplicates; archive and restore; archived records are clearly read-only; owner reassignment limited to Management; **contact detail** with click-to-call and open-WhatsApp; inline create company when converting.

### 7.7 Tasks and calendar
Task list grouped by due state (overdue, today, upcoming, done), assignee and linked record, priority, create and edit drawer, assign rules (own only for most roles, anyone for Management); **calendar** with month, week, day and list modes, team filter (permission based), overdue flags, click-to-create; reminders and notifications.

### 7.8 Reports
Management: organisation-wide, filters by owner, source, stage, service and date range; lead volume and source, conversion and drop-off, pipeline, won/lost, lost reasons, sales by service and salesperson, follow-up performance, **customer reports** (active, repeat, dormant, renewals); charts with table view and CSV export. Other roles: **personal "my metrics"** view with the same visual language.

### 7.9 Finance (new, thin)
Won-deal values, contract amounts, payment and invoice status, payment follow-up. Keep it a view and light tracker. Payment processing and invoicing platforms are out of scope. Payment and bank details ideally live outside the CRM.

### 7.10 Notifications and search
Bell dropdown plus a **notification centre** page (types: lead assigned, task due and overdue, handoff, and so on) and **preferences**. Global search results page with grouped results and role-aware visibility.

### 7.11 Settings (Management; others see only notification preferences)
Organisation profile; **members** (invite, roles, deactivate and reactivate, resend invite); **website integration** (API key, abuse protection, acknowledgement, assignment rules, recent submissions and errors); **inbound email** key; **reference data** (lead sources, lead statuses, pipeline stages, lost reasons, services, **customer lifecycle states**); onboarding task template; **organisation audit log**.

### 7.12 Mobile (first-class)
Design at **375px** for: today view, lead quick-capture, customer lookup, record with tap-to-call and open-WhatsApp (then prompt to log a communication), add note after a call, complete tasks, notifications. Pipeline and settings may be desktop-first, but must not break. PWA install affordance.

## 8. States to design on every relevant screen

Loading skeletons, empty (first-run and no-results), error with retry, **no access** (explain role and who to ask), archived and read-only banner with restore, masked values, offline and slow connection, duplicate warning, overdue and stalled indicators, import and export progress and failure, success and undo toasts, session expired.

## 9. Role behaviour you must show

Create one prototype switchable between the five roles (a role switcher for review purposes only), so reviewers can see the same screen change. Key rules:

- **Sales** sees only records they own, can edit most fields including temperature, **cannot reassign leads** (control present but disabled with an explanation), cannot export in bulk, sees deal values only on deals they own.
- **Management** sees everything, reassigns, configures, exports, sees the audit log and all values.
- **Delivery** and **Finance** are read-mostly; neither should see leads; Finance sees values.
- **Restricted Technical** has the smallest app: tasks and assigned context.
- Full matrix and five documented mismatches are in `03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md`. Where the matrix is still **provisional**, design the stakeholder's intent (for example Delivery sees client scope after Won, Finance does not browse open pipeline) and flag it.

## 10. Content and sample data

Use realistic Kenyan business context: services such as website development, branding, CCTV installation, Starlink and internet, HR automation, property-management systems, fleet GPS; currency **KES**; phone numbers in +254 format; companies such as a property manager, a retailer and a school; WhatsApp as a normal channel; lead sources Website, WhatsApp, Phone, Email, Facebook, Instagram, LinkedIn, TikTok, Referral, Existing Customer, Direct Outreach, Physical Meeting, Networking, Advertising, Other. **Deal pipeline stages (as seeded today): Solution Presented, Proposal Sent, Negotiation, Closed Won, Closed Lost.** The earlier steps of the sales workflow (Qualified, Contacted, Needs Identified) are **lead statuses**, not deal stages, and a lead only becomes a deal on conversion. Show that clearly in the UI (a lead progress strip, then the deal board). Services (seeded): Accounting, HR, CRM, Inventory, Property Management, Fleet / GPS, CCTV, Starlink / Internet, ISP Billing, Web Development, Branding, Social Media Management, Automation Systems, Consulting / Other. Lead statuses: New, Qualified, Contacted, Needs Identified, Unqualified, Converted, Lost, Inactive. Lost reasons: Not Interested, Not Qualified, No Budget, Competitor, No Need, Wrong Contact, No Response, Timing, Location, Duplicate, Other. Customer lifecycle: Prospect, Customer, Onboarding, Active Customer, Dormant Customer, Renewal. Lead temperature: Hot, Warm, Cold.

## 11. Out of scope (do not design)

Customer self-service portal, full project-management, accounting and invoicing platform, payment processing and M-Pesa, full WhatsApp API sync, marketing automation, AI assistant, multi-currency and multi-language, subscriber billing, self-service tenant sign-up, white-labelling.

## 12. Deliverables from Claude Design

1. The interactive prototype covering sections 6 to 12 for all five roles, desktop and mobile, light and dark.
2. The design system page (tokens and components).
3. A screen and state checklist so we can map each screen to a Linear issue.
4. A short list of **open questions and assumptions** you made, including any place the prototype departs from the permission matrix.

## 13. Reference material to attach

- `03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md` and `04-BRAND-TOKENS.md` (this pack).
- Logo image (green and orange ring, "Figbloom DIGITAL GROUP").
- Screenshots of the **current sign-in and sign-up pages (frozen, use as-is)**.
- Current-screen screenshots (login, dashboard, leads list and drawer, deals board, tasks, companies, contacts, reports, settings) and the earlier mockups in the repo's `Claude outputs/` folder (login design, logo concepts, redesign mockups v1 to v3, dropdown revamp, deals revamp, leads role matrix images).
- Optionally the planning documents (`documents/` folder): MVP scope (FIG-300) for the feature list and stakeholder findings (FIG-297) for the user voice.
