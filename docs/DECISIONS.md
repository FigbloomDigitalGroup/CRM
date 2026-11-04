# Decision log (FIG-1013 / B0.05)

Decisions that Stage 1 and the design depend on. All entries dated
**22 Oct 2026**. **Owner: Given Jim**, deciding on Michael's behalf as project
lead (Given has full control of the project and signs off each item
personally).

Status values: **Decided** (Given answered it, or asked Claude to recommend
the answer and adopted it for the open questions in section 4) and
**Deferred** (explicitly pushed to a later release). Given may change any
row; change the row and date it.

## 1. Permission matrix and the five departures

| # | Decision | Status |
|---|---|---|
| 1.1 | The permission matrix in `design-brief/03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md` §1 is confirmed for the five fixed roles, with departures 1.2 to 1.6 applied. This closes the "unsigned" status in FIG-444 and FIG-437 §18. | Decided |
| 1.2 | **Delivery and Finance see won deals only.** They no longer see open pipeline. Needs a backend change: replace `deals.view.all` for these two roles with a won-only scope (proposed key `deals.view.won`). | Decided |
| 1.3 | **Sales shared pool.** Sales sees its own records plus a shared/unassigned pool: view, and claim (take ownership), not edit others' records. Proposed keys `leads.view.shared` and `leads.claim`. | Decided |
| 1.4 | **Technical "My work".** Restricted Technical gets a minimal assigned-work surface: their tasks plus the client requirements relevant to that work. No project model in V1. | Decided |
| 1.5 | **Finance follow-up note instead of tasks.** Finance gets no task permissions. It can add a follow-up note on a payment or customer. Proposed key `finance.followup.note`. | Decided |
| 1.6 | **Delivery-handoff permission.** New key (proposed `deals.handoff`): Management and Sales may start a handoff, Delivery receives it. Holding it does not allow moving a stage on someone else's deal. | Decided |

Key names above are proposals; B1.01 fixes the final names. The matrix
changes are written into `design-brief/03-SCREEN-INVENTORY-AND-ROLE-MATRIX.md`
(section "Signed matrix") for B1.01 to start from.

## 2. Scope and roles

| # | Decision | Status |
|---|---|---|
| 2.1 | **Sprint 5 in-flight issues FIG-789 to FIG-794:** finish the backend half now; re-scope the UI half into the new design (F2.04, F4.10 and so on). FIG-789 (pagination) goes first because it feeds B0.06 and B3.10. | Decided |
| 2.2 | **V1 scope line.** If time is tight, move to V1.1 in this order: E1 Conversations hub, E2 Renewals, F1 Payments tracker, S5 Automations, S7 Data migration wizard. V1 itself is never cut. Nothing is cut without Given's say-so. | Decided |
| 2.3 | **Organisation switcher is V1.1.** V1 shows no switcher to single-organisation users. (Also answers open questions 3 and 22.) | Decided |
| 2.4 | **Customer Support is a sixth role**, behind a feature flag and off by default. (Also answers open questions 16 and 20.) | Decided |
| 2.5 | **Deposit request on signed quotes is V2 and decision-gated.** The MVP "no payment processing" exclusion stands for V1 and V1.1. Signed quotes stay status-only. (Also answers open question 13.) | Decided |

## 3. Dates and reviews

| # | Decision | Status |
|---|---|---|
| 3.1 | The project target date is **fixed at 22 Nov 2026**. Everything is scheduled to finish by 18 Nov, with 19 to 22 Nov held as buffer. | Decided |
| 3.2 | Review slots, each signed by Given on Michael's behalf: **23 Oct** this pack; **31 Oct** G1.08 backend V1 gate; **7 Nov** V1 go-live; **13 Nov** V1.1 gate. | Decided |

## 4. The open questions from the design's Screen Checklist

The checklist lists 23 questions (the brief called it 22; four are
duplicates of decisions above). Numbering follows the checklist.

| # | Question | Answer | Status |
|---|---|---|---|
| 1 | Should density be device-only too? | **Yes.** Density is device-only. Theme, page colours, own colours, start page and picture follow the account; text size, accessibility and density stay on the device. | Decided |
| 2 | May Management lock personalisation? | **Yes, for brand-level settings** (theme and page colours): Management sets the default and may lock them. Text size and accessibility are never lockable. | Decided |
| 3 | Is the organisation switcher needed for V1? | **No.** V1.1. See 2.3. | Decided |
| 4 | Org logo on quotes and client-facing pages? | **Yes**, with a toggle in the organisation profile. It always shows in the top bar. | Decided |
| 5 | Two-person rule for deletions? | **Only whole-organisation deletion** needs a second platform admin. Record-level deletions need one admin and are always audited. With only two platform admins, Given may authorise a documented single-admin exception during absence. | Decided |
| 6 | Support access: must the organisation approve? | **Approval required by default.** In a declared outage Figbloom may act alone, time-boxed and fully logged, with the organisation notified afterwards. | Decided |
| 7 | Read-only view of customer records without break-glass? | **No.** Without break-glass, platform admins see only metadata (counts, flags, health), never customer records. | Decided |
| 8 | Self-service sign-up, billing, white-labelling and a customer portal deferred; seat limits are counts only? | **Confirmed.** Stays deferred (FIG-436). Seat limits in Flags are counts, not prices. | Decided |
| 9 | Sales Lead role (team-scoped visibility)? | **Not in V1.** Revisit when the team passes two or three people; keep team scope possible in the data model. | Deferred |
| 10 | Read-only Viewer or Auditor role? | **Not in V1.** Audit log stays Management-only. Revisit in V1.1. | Deferred |
| 11 | Website forms, API tokens and automations as named service actors in audit logs? | **Yes.** Shown as named actors, for example "Website form", "API token: <name>", "Automation: <rule>", never as a person. | Decided |
| 12 | Will Marketing or Business Development need their own role? | **No new role** until they are distinct people. | Deferred |
| 13 | M-Pesa deposit request on signed quotes? | **V2, decision-gated; status-only until then.** See 2.5. | Decided |
| 14 | Swahili for the client-facing quote, signing page and web form? | **Not in V1.** English only; keep strings externalised so it can be added in V1.1. | Deferred |
| 15 | Automation boundary: any exceptions? | **No exceptions.** Automations, sequences and the assistant may assign, remind and draft; they never move a stage, set a discount or approve. A test enforces it (CLAUDE.md rule 9). | Decided |
| 16 | Customer Support: sixth role or Delivery with ticket access? | **Sixth role**, flagged off. See 2.4. | Decided |
| 17 | When is a deal "stalled"? | **10 days without activity by default**, configurable per organisation. Per-stage thresholds are V1.1. | Decided |
| 18 | Should Sales see deal values on deals they don't own, in a shared company? | **No.** Values stay masked; Sales sees a value only on deals they own (CLAUDE.md rule 7). | Decided |
| 19 | Who may mark a handoff Delivered? | **Delivery and Management**, not Sales. Delivered moves the company to Active Customer. | Decided |
| 20 | Customer Support (duplicate of 16) | See 2.4. | Decided |
| 21 | Should Finance raise payment follow-ups as tasks? | **No.** A follow-up note instead (1.5). Finance gets no task permissions. | Decided |
| 22 | Organisation switcher (duplicate of 3) | See 2.3. | Decided |
| 23 | Re-export the logo at #203E2A / #FF9400? | **Yes.** Action for Given or the designer: re-export so the logo matches the screen palette. | Decided |

## Follow-ups

- Comment the matrix changes (section 1) on the Linear issues for B1.01 and
  B1.03 before they start.
- Question 23 (logo re-export at #203E2A / #FF9400) is an action for Given
  or the designer.

## 5. M13 decisions taken by Claude on Given's behalf (4 Nov 2026), each reversible

These were taken while building the V1.1 backend so work could continue. Each can be reversed by Given; the code points are named in `docs/M13_CLOSEOUT.md` and the Stage 13 sections of `IMPLEMENTATION_NOTES.md`.

| # | Decision | Status |
|---|---|---|
| 1 | Mail and meetings routes sit behind the Communication group toggle (`communication.group`) and the `mail.use` / `meetings.schedule` keys. (Today the routes are behind the toggle; the keys are seeded but not yet read by the services, see the close-out check d.) | Decided, reversible |
| 2 | A person's own mail and calendar connection routes are an exception to "integrations is Management-only"; only the shared organisation mailbox and revoking other people's connections need `configuration.manage`. | Decided, reversible |
| 3 | The generated authorization walk stays on a V1 organisation; V1.1 routes are walked per role on a V1.1 organisation by G2.01 (FIG-1156). | Decided, reversible |
| 4 | The additive contract change is released as 1.1.0; `oldestDaysOverdue` stays nullable. | Decided, reversible |
| 5 | The AI assistant default model is Sonnet, configurable by `ASSISTANT_MODEL`. (Code and `.env.example` still say `claude-opus-5-5`; to change.) | Decided, reversible |
| 6 | The shared organisation mailbox is kept, Management only. | Decided, reversible |
| 7 | Approvals notify by email and the inbox count only; notification types are added in contract 1.1.0 if needed. | Decided, reversible |
| 8 | A sole Management user's own approval request needs a logged override, never silent self-approval. | Decided, reversible |
| 9 | A dedicated `ORGANIZATION_SUSPENDED` error code is added in contract 1.1.0 (today the suspended error keeps `FORBIDDEN` with an `organization` block). | Decided, reversible |
| 10 | The privacy organisation-request download route stays ungated because that workflow is platform-level. | Decided, reversible |

### 5.1 Decisions the build lanes recorded in `IMPLEMENTATION_NOTES.md` ("taken without being asked")

All have the status "Taken by Claude, reversible". Full wording is in the Stage 13 section of the source issue.

| Source issue | Decision (short) |
|---|---|
| FIG-1135 (B6.03) | Every platform identity holds every `platform.*` key; platform sessions 4 h idle and 12 h absolute; platform role created NOLOGIN, login set by `db:bootstrap-role` from `PLATFORM_DB_PASSWORD`; platform routes answer 404 to non-platform identities and 403 naming the key to those lacking it. |
| FIG-1146 (B6.14) | Forecast gated by release V1.1; "mine" needs `deals.view.own`/`deals.edit.own`; default stage probabilities 25/50/75; no per-deal override; monthly targets. |
| FIG-1148 (B6.16) | Saved view pins are per person; value-like filters stripped for viewers without the key; 50 views per person; gated by V1.1. |
| FIG-1149 (B6.17) | Ask Figbloom listed only with `ai.use` and `assistant.enabled`; help and release notes are code, not rows; all four routes gated by V1.1. |
| FIG-1151 (B6.19) | Each web form has its own public key in the address; permission `configuration.manage`; duplicate warning goes to staff only; link-spam rule (more than 2 links); CORS open on public routes. |
| FIG-1136 (B6.04) | Provisioning through the schema-owner client after the permission check; invite link emailed, never returned; slugs 3 to 40 characters, reserved list, never reused. |
| FIG-1137 (B6.05) | Error keeps code `FORBIDDEN` plus an `organization` block (see 5.9); offboarding blocks the app except data-request routes; an approved deletion blocks reactivation until cancelled. |
| FIG-1139 (B6.07) | Health thresholds 15 min (degraded) and 60 min (down); any dead-letter job degrades; "requests" on the home are open data requests. |
| FIG-1138 (B6.06) | Scheduled audit check is a cron route, not a job; metadata keys that look like values, payments or secrets are refused. |
| FIG-1141 (B6.09) | EXPORT needs 1 approver, DELETE 2; anyone may reject with a reason; approving DELETE starts offboarding; platform staff never download the export; waiting period only through `PLATFORM_DELETION_WAIT_DAYS` (7 or more). |
| FIG-1142 to FIG-1145, FIG-1147 (B6.10 to B6.13, B6.15) | Catalogue cost/margin masked without `deals.margin`; one quote per deal; discount 0 to 30 percent on catalogue lines; HTML document instead of PDF; email first, then lock and link; link max 90 days; nobody approves their own request; deletion rule cannot be switched off; no new notification type; cross-pipeline moves need an explicit flag. |
| FIG-1382 to FIG-1385 (B6.24 to B6.27) | Polling with cursor plus long poll; mentions reuse `MENTION`; record channels re-checked per call; Restricted Technical gets chat but no mail or meetings key; member erasure anonymises by default; retention default is "kept"; conflicts use `VALIDATION_FAILED` (409). |
| FIG-1150 (B6.18) | A step sends automatically only when Management chose SEND for an active template; default is DRAFT; sequences are off when created; any member with `tasks.create` may enrol. |
| FIG-1134 (B6.02) | No trusted devices for platform admins; two-step mandatory for platform admins; administrator reset refused across organisations; the login API route changed (not the frozen page). |
| FIG-1140 (B6.08) | Self-actions refused; hard delete on removal; invite link also returned to the inviting admin; 12-character minimum password. |
| FIG-1133 (B6.01) | A non-member slug answers 404; two-step policy applies across all organisations; not release-gated. |
| FIG-1155 (B6.23) | `tickets.manage` minimum lowered from V2 to V1.1; shared support queue; survey only for resolved tickets. The role stays off unless Michael approves it. |
| FIG-1153 (B6.21) | EMAIL and CALENDAR connections are separate rows; reuse of `communications.create`, `activities.create` and `configuration.manage`; gated by `integrations.enabled`; one fixed callback address. |
| FIG-807, FIG-808 | Unmatched personal mail is ignored, shared-mailbox mail goes to Needs linking; sending needs a connected mailbox (no SMTP fallback on the mail routes); tasks reach the calendar only with `syncTasks`. |
| FIG-1152 (B6.20) | One action kind (create a task); limits 15 per person and 500 per organisation per UTC day; default model via `ASSISTANT_MODEL`; the SDK is not in `package.json`; margins, costs and payments never enter the context. |
| FIG-1154 (B6.22) | Card reading is a suggestion; a lead exists only after `confirmed: true`; HEIC refused; no reader means typing. |
