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
