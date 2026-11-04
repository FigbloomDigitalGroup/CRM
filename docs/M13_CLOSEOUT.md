# M13 close-out checks (4 Nov 2026)

Read-only review of branch `makeover/m13-backend-v11` at commit `bbdc883`, done by reading code. The database was down, so nothing was run. Nothing in `src/` was changed. Items marked MISSING or GAP are for Given to decide and for a follow-up change.

## Scheduling check

How scheduled work is registered today:

- Job types are registered in code by `registerJob` (`src/jobs/definitions.ts`, plus `src/jobs/integrationJobs.ts`, imported from `definitions.ts`). The runner loads them on first use, so the worker and the cron route see the same list.
- Something outside the code must call the job runner. The repo has **no `vercel.json`, no scheduled GitHub workflow** (`.github/workflows/ci.yml` has no `schedule:`), and `docs/DEPLOYMENT.md` (lines 150 to 178) documents a cron entry **only for `/api/cron/notifications-sweep`**. `/api/cron/jobs` is described in `docs/JOBS.md:15` and `docs/API_REFERENCE.md:2557` but not in the deployment guide. `npm run jobs:worker` (`scripts/jobs-worker.ts`) is the alternative long-running scheduler.
- The platform's own work belongs to no organisation, so it is a cron route, not a job (`src/app/api/cron/platform-maintenance/route.ts`).

| Job or route | Added in M13 | Registered in code | Where the real scheduler reads it | Status |
|---|---|---|---|---|
| `GET/POST /api/cron/platform-maintenance` (audit chain check, export purge) | yes | route exists, `CRON_SECRET` | nothing calls it: not in `docs/DEPLOYMENT.md`, no vercel.json, no workflow (only mentioned in `docs/PLATFORM_CONSOLE_API.md:16`) | **MISSING** |
| `GET/POST /api/cron/jobs` (runs every scheduled job type below) | no (V1) | route exists | `docs/JOBS.md` only; not in `docs/DEPLOYMENT.md`; no scheduler configuration in the repo. Must run at least every 5 minutes for `mail.sync`; the deployment guide suggests 15 to 30 minutes for the sweep | **MISSING** (entry and interval undocumented) |
| `/api/cron/notifications-sweep` | no (V1) | route exists | documented in `docs/DEPLOYMENT.md:150` | OK (documented only) |
| `oauth.refresh` (every 30 min) | yes | `integrationJobs.ts:14` | via `/api/cron/jobs` or worker | OK in code, depends on the missing `/api/cron/jobs` entry |
| `mail.sync` (every 5 min) | yes | `integrationJobs.ts:28`; also enqueued on demand by `mailService.ts:195` | same | OK in code, same dependency |
| `calendar.sync` (every 10 min) | yes | `integrationJobs.ts:56` | same | OK in code, same dependency |
| `mail.send_scheduled` (queued at the send time) | yes | `integrationJobs.ts:47`, enqueued at `mailService.ts:449` | picked up by `runDueJobs` | OK in code, same dependency (a send is late by up to the cron interval) |
| `sequences.run` (every 15 min) | yes | `definitions.ts:210` | same | OK in code, same dependency |
| `chat.notify` (one job per message) | yes | `definitions.ts:188`, enqueued in `chatService.ts` | picked up by `runDueJobs` | OK in code, same dependency |
| `platform.org_export` (data request export) | yes | `definitions.ts:197`; allowed while offboarding (`offboardingJobs.ts`) | picked up by `runDueJobs` | OK in code, same dependency |
| Chat retention purge | yes | inside the daily `privacy.retention` job (`privacyService.ts:508`, `definitions.ts:171`) | same | OK in code, same dependency |
| Platform audit chain verification | yes | `platform-maintenance` route only | see first row | **MISSING** |
| Expired organisation export purge | yes | `platform-maintenance` route only (`purgeExpiredExports`) | see first row | **MISSING** (exports would stay past 14 days) |
| Organisation deletion | yes | deliberately not scheduled (separate, approved call) | n/a | OK (by design) |
| Quote events, approval expiry, quote link expiry | yes | no job: events are written inline, expiry is derived on read | n/a | OK (no scheduler needed) |
| Member chat erasure | yes | inline in the deletion service | n/a | OK |

Summary of what is missing: (1) a documented and configured call to `/api/cron/jobs` (and the interval of 5 minutes or less); (2) a documented and configured call to `/api/cron/platform-maintenance` (daily is enough for the export purge, hourly or daily for the audit check); (3) `docs/DEPLOYMENT.md` and `docs/JOBS.md` list neither; (4) `vercel.json` or the host's cron settings do not exist in the repo. No code was changed.

## Integration check

| # | Check | Result | Evidence |
|---|---|---|---|
| a | Quote send and approval resume use the connected mailbox | **GAP** | `sendQuote` calls `sendAndLogEmail` (`src/services/quoteDocumentService.ts:183`), which sends through the organisation SMTP `sendComposedEmail` (`src/services/communicationService.ts:131`). `mailService.performSend` (connected Gmail or Outlook mailbox, `mailService.ts:~360 to 410`) is not used. The approval resume calls `sendQuote` as the requester (`approvalService.ts:512`), so it has the same path. Notes say "sending requires a connected mailbox (no silent SMTP fallback)" for the mail routes only. A quote therefore leaves from the system address, not the seller's mailbox, and shows on the timeline as a logged email, not a threaded mail message. |
| b | Assistant context includes chat and mail only under viewer masking | OK (not included) | `src/assistant/context.ts` reads only deals, leads and tasks (imports lines 4 to 6) and masks by `canSeeDealValue` and `deals.view.value` (lines 103, 134, 188). Chat and mail are not in the context at all, so nothing can leak. If the product wants them, they must be added through the chat and mail services with viewer masking. |
| c | Chat mention notifications use the chat and mail keys | OK | `deliverChatNotifications` requires `chat.view` for each recipient (`chatService.ts:935`), checks channel membership and that every named record is openable (lines 936 to 947), and redacts the body with `textForViewer` (line ~960). It reuses the existing `MENTION` type. No mail notification exists. |
| d | Mail and meeting routes use `communications.*` or the new keys | **GAP** | The keys `mail.use` and `meetings.schedule` exist in `prisma/seedData.ts:325, 330` (V1.1) and are held by MANAGEMENT (623/624), SALES (667/668), DELIVERY (688/689) and CUSTOMER_SUPPORT (734/735). FINANCE and RESTRICTED_TECHNICAL do not hold them. **No code reads them** (only `tests/chat.test.ts` mentions them). Mail services check `communications.create` or `communications.view` (`mailService.ts:255, 292, 364, 427, 442, 493`); meetings check `activities.create` (`meetingService.ts:107, 198, 216`). Routes are now behind the `communication.group` toggle (uncommitted edits to the route files). Effect today: the keys have no effect, and a role with `communications.create` but no `mail.use` can still send mail. |
| e | Platform data-request deletion calls `eraseMemberChat` | OK | `platformDataRequestService.ts:499` (policy DELETE) with the import at line 15. |
| f | Approval resume paths call the real services | OK | Export: `decideExportApproval` (`approvalService.ts:461`); deletion: `confirmErasure` (550); quote send: `sendQuote` (512, but see a); stage move: `moveDeal` (526). |
| g | Platform audit receives lifecycle, provisioning, admins, data requests, two-step platform actions | OK | Lifecycle `organizationLifecycleService.ts:104`; provisioning `platformOrganizationService.ts:312` (note: the entry commits after the organisation, a failed write leaves it unaudited, already a known gap); admins `platformAdminService.ts:52, 327, 384`; data requests `platformDataRequestService.ts:157 to 548` (request, approve, reject, cancel, export packaged, failed, purged, deletion); platform sign-in and two-step actions `platformSignInService.ts:39` (signed in, failed, locked, backup code used, two-step enrolled and required). |
| h | New env variables in `.env.example` and `docs/DEPLOYMENT.md` | **GAP** | In `.env.example`: `PLATFORM_DB_PASSWORD` and `PLATFORM_DATABASE_URL` (lines 35, 36), `TWO_STEP_ENCRYPTION_KEY` (190), Google and Microsoft OAuth ids and secrets (198 to 202), `ANTHROPIC_API_KEY` and `ASSISTANT_MODEL` (206, 207), SMTP (58 to 63): OK. In `docs/DEPLOYMENT.md`: only `SMTP_HOST` appears; `TWO_STEP_ENCRYPTION_KEY`, `PLATFORM_DB_PASSWORD`, `PLATFORM_DATABASE_URL`, `ASSISTANT_MODEL`, the OAuth client ids and secrets, `INTEGRATION_ENCRYPTION_KEY` and `PLATFORM_DELETION_WAIT_DAYS` are **not** listed. |
| i | Assistant default model matches the decision (Sonnet) | **GAP** | `src/assistant/provider.ts:54` and `.env.example:207` default to `claude-opus-5-5`; DECISIONS 5.5 below says Sonnet. One constant and one comment to change (not done, outside the allowed files). |

Other things noticed: `@anthropic-ai/sdk` is not in `package.json` (documented: install where the assistant or card reader is enabled); `docs/DEPLOYMENT.md` recommends a 15 to 30 minute interval, which would delay mail sync and scheduled sends.
