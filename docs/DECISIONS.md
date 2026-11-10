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
| 2.4 | ~~**Customer Support is a sixth role**, behind a feature flag and off by default.~~ **Superseded on 5 Nov 2026 by decision 12 (section 5.0): there is no Customer Support role.** | Superseded |
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
| 16 | Customer Support: sixth role or Delivery with ticket access? | ~~Sixth role, flagged off.~~ **Neither: no Customer Support role.** Tickets go to Figbloom by email (decision 12). | Superseded |
| 17 | When is a deal "stalled"? | **10 days without activity by default**, configurable per organisation. Per-stage thresholds are V1.1. | Decided |
| 18 | Should Sales see deal values on deals they don't own, in a shared company? | **No.** Values stay masked; Sales sees a value only on deals they own (CLAUDE.md rule 7). | Decided |
| 19 | Who may mark a handoff Delivered? | **Delivery and Management**, not Sales. Delivered moves the company to Active Customer. | Decided |
| 20 | Customer Support (duplicate of 16) | See 2.4. | Decided |
| 21 | Should Finance raise payment follow-ups as tasks? | **No.** A follow-up note instead (1.5). Finance gets no task permissions. | Decided |
| 22 | Organisation switcher (duplicate of 3) | See 2.3. | Decided |
| 23 | Re-export the logo at #203E2A / #FF9400? | **Yes.** Action for Given or the designer: re-export so the logo matches the screen palette. | Decided |

## 5. Database hosting (4 Nov 2026)

| # | Decision | Status |
|---|---|---|
| 5.1 | **PostgreSQL, running locally for now; migrate to AWS later** (Michael's decision, recorded by Given on 4 Nov 2026). Staging and the first production run use plain PostgreSQL set up the way development is (`docker-compose.yml`, `npm run db:setup`). | Decided |
| 5.2 | **No vendor-specific database or storage services.** Standard SQL, Prisma migrations, `pg_trgm`, row-level security keyed on the organisation, and the S3 driver for files, so the move to AWS is a dump and restore plus new connection strings. A hosted Postgres-plus-platform product was evaluated on 4 Nov 2026 and dropped; its plan and spike notes were removed from the repository. | Decided |
| 5.3 | **Still open:** the AWS services and region, and the Kenya Data Protection Act assessment for where production data is stored (FIG-1258, FIG-1128). Decide them when the AWS move is planned. | Open |

## 6. M12 go-live decisions (4 Nov 2026, taken by Claude on Given's instruction)

Given asked Claude to decide these five items on 4 Nov 2026. Each is the recommended choice, taken so M12 can proceed. **Given may change any row (change it and date it); Michael should be told of 6.1, 6.4 and 6.5, which touch the schedule and the sign-offs.**

| # | Decision | Status |
|---|---|---|
| 6.1 | **Hypercare ends no later than 21 Nov 2026**, so the fixed 22 Nov project date holds. V1 goes live about 10 Nov and gets about 11 days of daily triage; the end-of-hypercare criteria in `docs/GO_LIVE.md` (no Sev-1 open) are the gate, not the calendar. After 21 Nov the work is ordinary support. The post-launch review (FIG-1132) is held on 22 Nov. FIG-1131 still says "two weeks"; read it as "to 21 Nov". | Decided (delegated) |
| 6.2 | **Plan for a fresh organisation with no data to migrate (cutover Path A)** unless Given says real data exists. Nothing in the repository or Linear mentions production data to move. If it does exist, Path B in `docs/CUTOVER_PLAN.md` applies and the rehearsal on a copy must pass before go-live. | Decided, assumption to confirm |
| 6.3 | **Recovery targets confirmed as proposed in `docs/BACKUP_RESTORE.md`:** database RPO 24 hours, RTO 1 hour; files RPO 24 hours, RTO 4 hours; retention 14 daily, 8 weekly, 12 monthly, plus a dump before every change. **WAL archiving is not needed at launch.** Revisit it, and add it, if the user count or business impact grows, an external customer joins, or Given wants an RPO under 24 hours. Nightly dumps stay even then. | Decided (delegated) |
| 6.4 | **The V1 quality gate (Q1.08, FIG-1122) counts as NOT passed.** The repository (`docs/V1_QUALITY_GATE.md`) is the record: UAT not held, manual accessibility and device passes not run, visual baselines not approved by design, FIG-444 metrics not baselined, no sign-off. Linear shows FIG-1122 (and FIG-1120 UAT, FIG-1116 accessibility) as Done; that does not change the facts. The go/no-go on 10 Nov requires those lines done or waived **in writing by Michael and Given**. Claude does not waive them. Linear statuses are for Given to correct. | Decided (delegated) |
| 6.5 | **Production refuses to boot without `CLAMD_HOST`** (`src/storage/antivirusGuard.ts`), when `NODE_ENV=production` and `FIGBLOOM_ENVIRONMENT=production`. Staging, development and local production-mode runs are not affected. The first-run checklist now opens Members, Data migration and Website integration (`src/ui/screens/home/roles.tsx`). | Done |
| 6.6 | **Waiver, given by Given Jim on 5 Nov 2026: staging is this computer for now.** The local Docker stack (`docs/STAGING.md`, compose project `figbloom_crm_staging`) is the accepted staging environment for FIG-1123 and FIG-1256 until a host exists. The acceptance criterion "staging deploys from `dev-given` via the pipeline" is waived for now, not met: the workflow `.github/workflows/deploy-staging.yml` stays off (`STAGING_DEPLOY_ENABLED` unset) until a reachable host and the GitHub `staging` environment exist. Consequences to keep in view: staging is reachable only from this computer (UAT with other people needs a shared screen or a host), it is up only while the computer and Docker Desktop are, and the pipeline's approval step and post-deploy smoke run are not exercised. The pipeline stays a requirement for production (FIG-1131). | Waived in writing by Given (5 Nov 2026); Michael to be told |
| 6.7 | **Alerting and dashboards (FIG-1124), taken by Claude on Given's instruction, 5 Nov 2026:** the standard open-source stack: Prometheus (scrape and rules), Alertmanager (delivery), a blackbox probe (health and login page) and Grafana (dashboards), all in `docker-compose.observability.yml` with config in `ops/observability/`. Sentry stays the error tracker. Alerts go by email (staging: the Mailpit sandbox; production: the real mail relay or a paging service, which is a change of receiver only). No vendor service, so it moves to AWS unchanged. An outside uptime service (free tier) and the real on-call addresses are Given's to supply. | Decided (delegated) |
| 6.8 | **Internal pilot (FIG-1130):** 6 to 8 people for 5 working days: Given, Michael, two Sales, one Delivery, one Finance, one Restricted Technical. It starts after UAT and ends before hypercare. | Decided (delegated) |
| 6.9 | **Training (FIG-1129):** two 45-minute sessions, Management with Sales together and the other roles together, on the staging copy, with an attendance table kept in `docs/guides/training-plan.md`. | Decided (delegated) |
| 6.10 | **Incident rule (FIG-1126):** after 15 minutes without reaching Given on a Sev-1, on-call may roll back an application image. On-call never restores the database. | Decided (delegated) |
| 6.11 | **AWS region (FIG-1258), provisional:** Cape Town (`af-south-1`), the nearest AWS region to Kenya, pending the lawyer's view under the Kenya DPA. A recommendation for the assessment, not legal advice. | Decided (delegated), provisional |
| 6.12 | **Pre-launch testing is solo; tests that need other people are deferred to hypercare (Given, 5 Nov 2026).** Given has no people to test with before go-live and asked that the issues needing other people's tests be closed, testing as Given and Claude only. Deferred, **not met**, until real users exist (the first production week, hypercare in `docs/GO_LIVE.md`): the team table-top exercise (FIG-1126; for now a desk walkthrough by one person, `docs/RUNBOOKS.md` section 10), the training sessions and attendance record (FIG-1129; the onboarding dry run was done alone, `docs/guides/training-plan.md`), and the pilot (FIG-1130; the first production week with real users acts as the pilot and its exit criteria are checked at the end of hypercare). Risks Given accepts: nobody has practised the incident roles, nobody is trained before using it, and what real users find appears in production. **Not covered by this waiver:** FIG-1130 and the V1 gate items in 6.4 also need Michael's written agreement; the legal and registration duties under the Kenya DPA are not tests and are not waived by this (`docs/DATA_PROTECTION_CHECKLIST.md` section 7); FIG-1131 and FIG-1132 are events that cannot be closed before they happen. | Decided by Given 5 Nov 2026; Michael to be told |
| 6.13 | **Pilot waiver for FIG-1130 (5 Nov 2026).** Given reports that Michael approved replacing the separate pilot with the first production week (exit criteria checked at the end of hypercare, no later than 21 Nov). Recorded as relayed by Given; Michael's own written confirmation is not in the repository, and a one-line message from Michael in the issue would complete the record. | Approved by Michael according to Given |
| 6.14 | **Sign-off of FIG-1128 and FIG-1258 by Given (5 Nov 2026).** Given signed off the security sign-off (`docs/SECURITY_SIGNOFF_V1.md` section 6, approve with accepted items S-01 to S-08), the cutover plan (`docs/CUTOVER_PLAN.md` section 10) and the data-location assessment (`docs/DATA_LOCATION_ASSESSMENT.md` section 8, accepted L-01 to L-04). **Michael's lines are open.** Still required before real customer data is loaded and not waived: lawyer review, registration decision, processor agreements, a named contact, retention periods (`docs/DATA_PROTECTION_CHECKLIST.md` section 7), and a production ClamAV host. | Signed by Given; Michael open |

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

### 5.0 Decision taken by Given on Michael's behalf (5 Nov 2026)

| # | Decision | Status |
|---|---|---|
| 11 | ~~The **Customer Support role** (B6.23, FIG-1155; tickets and satisfaction surveys) is **approved**, given by Given on Michael's behalf.~~ **Superseded the same day by decision 12.** | Superseded, 5 Nov 2026 |
| 12 | **No Customer Support role in the CRM.** Michael has a platform console for all Figbloom systems, and every customer support ticket goes there. Tenants raise tickets **by email**, sent through **Resend**; the ticket then lives in the platform console. Michael will send the Resend API key once Resend is set up. The role, `tickets.manage`, the `customer_support.role` flag, the dev support account, the ticket and survey tables and the Support screens are removed. FIG-1155 (B6.23) and FIG-1178 (F6.19) are replaced by the email-support issues. See `docs/SUPPORT_BY_EMAIL.md`. | Decided by Michael, relayed by Given, 5 Nov 2026 |

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

## 7. MVP on Vercel (9 Nov 2026, decided by Given)

Given decided the scope and the hosting for the MVP on 9 Nov 2026. The database and file-storage choices (7.3 and 7.4) are **chosen by Given, Michael to confirm**. They sit beside, and do not replace, the 4 Nov decision in section 5 (plain PostgreSQL, no vendor-specific services, AWS later); both choices below are plain PostgreSQL and an S3-compatible store, so the move to AWS stays a dump and restore plus new connection strings.

| # | Decision | Status |
|---|---|---|
| 7.1 | **MVP scope is V1 plus the wired V1.1 screens.** V2 is out and hidden: support access, feature flags and limits, announcements, e-signature, deposit, the roles and field-access editor, developers (API tokens, webhooks), Swahili, churn hints. | Decided by Given |
| 7.2 | **Vercel production branch is `dev-given`.** Every other branch gets a preview deployment. Previews must never use the production database or production secrets (own Neon project, own bucket). | Decided by Given |
| 7.3 | **Database: Neon plain PostgreSQL through the Vercel Marketplace.** The app uses the pooled URL (`APP_DATABASE_URL`, `PLATFORM_DATABASE_URL`), migrations use the direct non-pooled URL (`npm run migrate:deploy:direct`). Moving to AWS later is a dump and restore. | Chosen by Given. **Confirmed by Given on Michael's behalf, 10 Nov 2026** (stated in the Claude Code session: "I sign off everything on his behalf"). Michael can countersign here. As built: Neon **free plan**, Frankfurt, PostgreSQL 18, one production and one separate preview database, created through the Vercel Marketplace under Given's Vercel team; cost: none on the free plan. Not yet checked: the restore window of the free plan |
| 7.4 | **Files: an S3-compatible bucket (`STORAGE_DRIVER=s3`) with the built-in file-type checks only. No ClamAV host for the MVP.** Production would normally refuse to boot without `CLAMD_HOST` (decision 6.5); the explicit opt-out `ANTIVIRUS_MODE=builtin-only` lets it boot and logs a warning at every start. Without that variable the default is unchanged. Needs the written risk acceptance below. | Chosen by Given; confirmed by Given on Michael's behalf and risk acceptance 7.6 signed by Given, both on 10 Nov 2026. **Deferred by Given on 9 Nov: no bucket exists yet** (files are not needed for the first sales-team test), so uploads show an error until one is created; the opt-out is already set in Vercel |
| 7.5 | **Scheduler: Vercel Cron** (`vercel.json`): jobs every 5 minutes, notifications sweep every 30 minutes, platform maintenance daily. Needs a Vercel Pro plan (Hobby allows daily crons only). | Decided by Given; **changed 9 Nov 2026: free Vercel Hobby plan**, so Vercel Cron runs the three jobs once a day, and the 5-minute jobs need a free outside caller (cron-job.org, to be set up) or a Pro plan. Hobby terms are for non-commercial use: Given to decide before real customers |

### 7.6 Risk acceptance: uploads without a malware scanner

For Given and Michael to sign before real customer files are uploaded.

> The Figbloom CRM MVP runs in production without a ClamAV (or other malware-scanning) host. Uploaded files are checked only by the built-in controls: a per-purpose allow-list of file types, content sniffing against the declared type, size limits, and a detector for the standard EICAR test file. **Real malware in an uploaded file would not be detected by the CRM.** Files are stored in a private bucket and are served only through short-lived signed links to members of the owning organisation, which limits exposure but does not remove it. Members may download a file that carries malware, and a malicious file could be sent on to a customer by a member.
>
> We accept this risk for the MVP only, for as long as `ANTIVIRUS_MODE=builtin-only` is set. We will provide a scanning host (`CLAMD_HOST`) and remove the opt-out before (a) the first external customer organisation is onboarded, or (b) files are shared outside the organisation by the CRM, or (c) a date agreed here: ______________, whichever is first. Until then members are told not to upload files from sources they do not trust.
>
> This replaces, for the MVP, the production ClamAV requirement in section 6.5 and finding S-01 of `docs/SECURITY_SIGNOFF_V1.md`; it does not waive any other item.

| | Name | Date | Signature or written confirmation |
|---|---|---|---|
| Given Jim | Given Jim | 10 Nov 2026 | Written confirmation in the Claude Code session, 10 Nov 2026, recorded here by Claude Code at his instruction. No date was set for condition (c): conditions (a) and (b) apply |
| Michael | Given Jim, on Michael's behalf | 10 Nov 2026 | Given Jim stated in the same session that he signs off on Michael's behalf. **Michael himself has not signed**; he can countersign in this row |

## 8. Sky is the default theme, and the sign-in pages follow it (10 Nov 2026, decided by Given)

Given asked for the Sky theme (sidebar `#1C4E6E`, accent `#2A7BB0`, highlight `#E3F0FA`) to be the system default on every dashboard, and for the sign-in pages to move from green to sky blue.

- **Default theme.** `BRAND_THEME` is `SKY` (was `FOREST`). It is what a member sees until they pick a theme, what "Reset to default" restores, and what a new organisation starts with (`organizations.default_theme` column default). Migration `20261125090000_sky_default_theme` also moves organisations still on `FOREST` to `SKY`. A member's own theme choice is untouched. Forest remains one of the ten themes.
- **Frozen sign-in pages (hard rule 1), approved exception.** Given approved changing their colours only. No frozen file changed (their hashes in `tests/uiGuards.test.ts` and the `pre-makeover` comparison still hold): the greens live in `src/app/globals.css`, where the hero gradient, the "Sign in" button, the badge, and the focus rings now use sky blues. Layout, markup and behaviour are as before. The five pages x two widths baselines in `e2e/frozen-auth.spec.ts-snapshots/` must be re-recorded in the same pull request (`npx playwright test e2e/frozen-auth.spec.ts --update-snapshots`, once on Windows and once for the Linux baselines CI uses).
- Status greens (success, "won", the orange brand accent) are unchanged; the logo mark is unchanged.
- Left as is on purpose: the contract example files and the OpenAPI summary "Back to Forest on White" (the contract is signed off; the summary text is corrected at the next contract regeneration).
