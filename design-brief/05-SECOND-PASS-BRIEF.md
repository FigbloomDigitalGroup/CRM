# Claude Design brief, second pass: close the gaps, then add the edge

Paste into the **same Claude Design project** as the first prototype. Do not start over. The first pass is accepted as the base.

## 0. Ground rules

**Keep unchanged:** the frozen sign-in, sign-up and related auth pages; the colour tokens (`#203E2A` green, `#FF9400` orange) and the design system; the shell, navigation and role-switching review bar; everything the first-pass checklist marks as covered.

**Add to the existing files.** Extend the Screen Checklist with new rows (IDs continue from the existing ones) and add a **release tag** to every new screen: **V1** (must ship by 22 Nov 2026), **V1.1** (post-launch), **V2** (strategic edge). Add a review-bar switch **Show: V1 / + V1.1 / + V2** so reviewers can see the product at each stage. Features tagged V1.1 and V2 must not appear when "V1 only" is selected.

**Principles still apply** (from the stakeholder): simple for sales, deep for management; few required fields; no surveillance feel; duplicates warn, never block; and **automation and AI suggest, a person decides.** Nothing may move a deal's stage, mark a deal won or lost, or message a customer on its own.

**Out of scope, unchanged:** customer self-service portal, full project management, accounting and invoicing platform, subscriber billing, self-service tenant sign-up, white-labelling, multi-currency and multi-language beyond what is stated in Part B7.

## Part A. Close the first-pass gaps (all tagged V1 unless stated)

### A1. Defects to fix in the existing prototype
1. Deal cards on the board print "UNDEFINED" over the owner name (avatar initials bug).
2. Reports shows **Conversion 0% of 9 leads** while the same data has 3 won deals. Make the sample data consistent: converted leads must match won deals that originated from a lead.
3. The sidebar clips its last item ("Payments") at 900px height. Make the nav scroll cleanly with a fade, and keep Reports and Settings visually distinct from the workspace group.
4. Confirm the **Margin** chart and the deal "Cost · Margin" fields are visible to **Management only**. Sales must never see cost or margin (FIG-297 §24). Show the masked state for every other role.
5. The checklist cites "Findings §N" numbers that don't match the source document. Replace with the real headings: Findings §21 (reporting), §22 (dashboards), §23 (roles), §24 (access control), §26 (automation), §28 (mobile), §29 (user experience), §30 (migration); FIG-437 §8 to §12; MVP scope §4.1 to §4.14.

### A2. Screens and features required by the documents and Linear that the prototype lacks
| ID | Feature | Source | What to design |
|---|---|---|---|
| A-1 | **File attachments** on companies, contacts, leads, deals | Linear FIG-796; FIG-297 §10 ("important customer documents") | An Attachments panel on every detail page: upload, list with type icon, size, uploader and date, preview, delete (permission-based), per-role visibility, upload failure and virus-scan-pending states. Mobile: attach from camera or files. |
| A-2 | **Email templates** for "Send and log email" | FIG-797 | Template picker inside the email composer, with placeholders such as `{first_name}`, `{service}`, `{owner_first_name}`; a Settings › Templates manager (create, edit, share with team or keep private, preview). Includes the acknowledgement template already in Website integration. |
| A-3 | **Tags** and filter by tag | FIG-798 | Tag chips on all four record types, tag manager in Settings, tag filter in list filters, bulk tag from the bulk-action bar, colour rules. |
| A-4 | **Custom fields** per record type | FIG-803; FIG-297 §6 (service-specific qualification) | Settings › Custom fields: add a field to leads, contacts, companies or deals (text, number, date, dropdown, yes/no), required or optional, show only for a chosen service, role visibility. Show how they render in the drawer, detail page and CSV import mapping. The existing Qualification section becomes the first use of this. |
| A-5 | **Import deals from CSV** | FIG-800 | Extend the import wizard to deals: map columns, resolve company and stage, duplicate check, error report. |
| A-6 | **Pagination and list performance** | FIG-789 | Page controls (or "Load more"), page size, total count, keeps filters and search; skeleton rows while paging; count-only KPIs on the dashboard. Design for lists of thousands of rows, not eight. |
| A-7 | **Organisation switcher** | FIG-437 §18 | Replace the placeholder: user menu list of organisations, current one marked, role shown per organisation, empty state for single-organisation users (hidden). Tag it V1.1. |
| A-8 | **Customer Support role** (open decision) | FIG-297 §23 | Show it as a proposed sixth role: customer history and maintenance information, no pipeline, no values. Add a column to the role matrix and the review-bar account list (tagged "proposed"). |
| A-9 | **API and webhooks management** | FIG-804, FIG-805 | Settings › Developers: personal API tokens (create once-visible, revoke, scopes, last used), outbound webhooks (events list, endpoint, secret, delivery log with retries and failures), link to API docs. V1.1. |
| A-10 | **Connect flows** for email and calendar | FIG-806, FIG-807, FIG-808 | The "Not connected" tiles need real flows: provider choice, permission explanation, what is read, mailbox and calendar selection, sync status, disconnect, error and re-authorise. V1.1. |
| A-11 | **Dormant customers and renewals depth** | FIG-793, FIG-795 | Configurable dormancy threshold; reminders rules (30 days before renewal, proposal unanswered N days) editable in Automations with preview of what they would have caught. |
| A-12 | **Mobile for the new screens** | FIG-791 | Every A-row above at 375px. |

### A3. States for every A-row
Loading, empty first-run, no results, error with retry, no access (names the role and who to ask), archived and read-only, undo toast, permission-limited variants for each of the five roles plus the proposed Customer Support role.

## Part B. The edge: features that put Figbloom ahead of Odoo, Zoho and the modern CRMs

Each feature below must show: where it lives, who sees it, what the AI or automation does and **what a human still decides**, empty and error states, and a mobile treatment where relevant.

### B1. Assistant and lead scoring (V1.1 then V2)
- **Lead score and reasons.** A transparent score (Hot, Warm, Cold plus 0 to 100) on every lead and deal, with "why" chips (source quality, service interest, response speed, similar past wins). The user can override and the override is logged. Never hide the reason.
- **Ask Figbloom** (assistant). Opens from the top bar and from any record. Answers questions in plain language ("which proposals have no reply after a week?", "show Hot leads with no task"), summarises a customer's history in three lines, drafts a follow-up email or WhatsApp message for the user to edit, and proposes the next action. It can create a task or log a note **only after the user confirms** in a visible preview.
- **Call and meeting recap.** After logging a call or uploading notes, offer a short summary and suggested next task. User edits and accepts.
- **Guardrails.** Respects the user's role: it can only see what that role can see, and masked values stay masked in answers. Every AI suggestion shows a "Suggested" label, a dismiss action and a feedback control. A Settings › AI page: on or off per organisation, per role, and what data is used. No automatic customer messaging.

### B2. Quotes, e-signature and payment link (V1.1 for quote builder, V2 for e-sign and payment)
- **Service and price catalogue** in Settings (service, unit, default price, tax), feeding quotes. Cost price visible to Management only.
- **Quote builder** inside a deal: line items from the catalogue, quantity, discount (with a Management approval rule above a threshold), tax, validity date, terms, live total. Replaces today's proposal reference but keeps it as the record of what was sent.
- **Quote document**: branded PDF preview, send by email or WhatsApp link, version history, status (Draft, Pending approval, Sent, Viewed, Accepted, Declined, Expired).
- **E-signature**: customer opens a link, reviews, types or draws a signature, accepts. Signed copy attaches to the deal and Customer 360. Accepting does **not** move the deal; it prompts the owner to move it.
- **Payment request** (V2): a link for the customer to pay a deposit or invoice through a local provider (M-Pesa and card). The CRM records the status the provider reports; it **does not hold funds, store card or bank details, or process payments** (FIG-300 exclusion). Mark this as an open decision for Michael because it brushes against the "payment processing" exclusion.
- **Approvals**: a Management inbox for quotes and discounts waiting on approval.

### B3. Outreach: templates, cadences, calling (V1.1 for cadences, V2 for calling)
- **Cadences**: a short sequence per lead type (for example Day 0 WhatsApp, Day 2 call task, Day 5 email, Day 10 check-in). Each step creates a **task or a prepared message for the owner to send**, not an automatic send. Pause when the customer replies or a stage changes.
- **Email tracking** (opens and link clicks) shown on the timeline, with a privacy note.
- **Click-to-call and call log** with duration, outcome and optional recording and transcript if a provider is connected. Missed-call to lead capture.
- **WhatsApp**: click-to-chat remains the default. Show a V2 "WhatsApp Business connected" variant with approved templates and a shared team inbox, clearly separate from the V1 behaviour.
- **Web forms**: a simple form builder and embed snippet for the website, mapped to lead source and service, with spam protection settings.

### B4. Forecast, targets and team health (V1.1)
- **Forecast view** under Reports: committed, best case and open buckets by month and by owner, with the weighted figure the prototype already shows, a drill-down to deals, and "deals that moved since last week".
- **Targets**: Management sets a monthly target per salesperson and per service. Sales sees **their own** target as a progress ring on their Today page, framed as help ("KES 180k to go, 3 deals could close it"), **not a ranking**.
- **Team view** for Management: workload (open leads and tasks per person), response time to new leads, overdue by person, shown as capacity and support, with the "not surveillance" wording kept. Leaderboards are **off by default** and opt-in per organisation.
- **Multiple pipelines**: allow more than one pipeline (for example Digital services vs Installations), with a pipeline switcher on the board. Stages stay organisation-configurable.
- **Stage gates**: optional rules per stage ("Proposal Sent requires an attached quote"), shown as a checklist when moving a deal, with a clear reason if blocked.

### B5. Collaboration and speed (V1.1)
- **Command palette** (Ctrl or Cmd + K): jump to any record, run actions (new lead, log call, new task, go to Reports), switch role view for reviewers, recent items, keyboard shortcut list.
- **Comments and @mentions** on any record, notifying the mentioned person, with an "internal only" label. Appear on the timeline.
- **Follow a record**: get notified of changes to a deal or customer you do not own.
- **Notes**: pinned notes and a quick note that attaches to the last record opened (mobile friendly).
- **Slack or Teams notifications** (V2): choose events to post to a channel.
- **Saved views**: save any list filter as a named view, personal or shared, pin to the sidebar.
- **Report builder (light)**: choose a measure, group by, filter and chart type; save to a dashboard; schedule an email of the report. Keep it simple: one screen, no formula language.

### B6. Customer intelligence (V2)
- **Relationship timeline from email and calendar**: when connected, show last contact date, who at Figbloom knows this customer, and unanswered emails.
- **Company enrichment**: optional suggestions for industry, size and website on company creation, accepted or dismissed by the user.
- **Customer health**: a simple health indicator on Customer 360 (activity, open issues, renewal proximity, payment status), explained, never a black box.
- **Surveys and NPS**: send a short satisfaction survey after handoff or delivery; results on Customer 360 and in Reports.
- **Support tickets (light)**: a minimal issue log on a customer (title, status, owner) feeding "Outstanding issues". It stays small and does not become a helpdesk.

### B7. Local advantage (V1.1 to V2)
- **Swahili and English** interface switch (labels, dates, number formats), proposed as V2. Keep KES as the default currency and allow a per-deal currency only if the stakeholder confirms the need.
- **M-Pesa and eTIMS awareness**: record M-Pesa receipt references on payments (reference only), and show eTIMS invoice status for won deals when an accounting connection exists (status only).
- **Offline-first capture**: queue leads, notes and task completions offline on mobile, with a visible "Waiting to sync (3)" indicator and conflict resolution that never loses data.
- **Business-card and WhatsApp capture**: photograph a card or share a WhatsApp contact into a new lead with the name, phone and company prefilled.
- **Installable app**: PWA install prompt and push notifications, with a "native app later" note.

### B8. Trust and governance (V1.1)
- **Two-factor sign-in** and trusted devices, added to Settings › Security. Do **not** change the frozen sign-in page; design the second step as a separate screen shown after it and flag it for approval.
- **Custom roles and field-level access** (V2): clone a role, tick permissions by area, mark fields as hidden or read-only per role, with a "preview as this role" button.
- **Approval rules** in one place: discount over X, export of Y rows, deletion, with an inbox for approvers.
- **Audit and export controls** already exist; add **anomaly alerts** to Management ("large export by a new user").
- **Sandbox badge** for a test organisation so imports and automations can be tried safely (V2).

### B9. First-run and help (V1)
- **Guided first run** per role: a short checklist on Today ("Import your leads, invite a teammate, connect your website form"), progress saved, dismissible.
- **In-app help**: contextual "?" on each screen with two or three tips, a "What's new" panel, and keyboard shortcut sheet. Shown only to roles that need them.

## Part C. Permissions the new features need (provisional, for Michael's sign-off)

Propose new permission keys and show them in the role matrix with who gets what: `attachments.manage`, `templates.manage`, `tags.manage`, `customfields.manage`, `views.share`, `quotes.create`, `quotes.approve`, `catalogue.manage`, `forecast.view.all`, `targets.manage`, `cadences.manage`, `ai.use`, `ai.configure`, `api_tokens.manage`, `webhooks.manage`, `security.manage`. Flag each as new and unconfirmed. Keep the five existing roles and the proposed Customer Support role.

## Part D. Deliverables

1. Updated prototype, new screens tagged V1, V1.1 or V2, with the release switch in the review bar, desktop and mobile, light and dark.
2. Updated Screen Checklist with the new rows, role cells (Edit, Own, Read-only, No access), states designed, release tag and a **Linear column** (existing issue numbers where they exist, otherwise "new").
3. Updated design system page with any new components (command palette, assistant panel, score chip, quote builder, signature pad, approval inbox, saved-view tabs, attachments panel, tag chip, comment thread).
4. An **updated role matrix** including the new permission keys and the sixth role.
5. A **priority list** of Part B by value versus effort, and the open questions and assumptions, especially anything that touches a documented exclusion (payment processing, multi-language) or the "no automatic decisions" rule.

## Part E. Reference to attach

`01-AUDIT-REPORT.md`, `02-CLAUDE-DESIGN-BRIEF.md` (first pass, still valid), `03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md`, and this file. Keep the first-pass materials already in the project.
