# Later versions: what the MVP left out

Written 11 Nov 2026 (Given's request), after the MVP went live on Vercel for a test with fake data. This is the list of things we chose to leave for later, so none is forgotten. The facts about the current setup are in `docs/MVP_HANDOVER.md`; the step-by-step for changing from test to real settings is its changeover checklist. Linear is still the source of truth for scope; where an issue exists it is named here.

How to read it: **A** must be done before real customer data or real users. **B** is the next version (V2 and V1.2). **C** is quality and tidy-up. Items marked "decision" need Given or Michael.

## A. Before real use (hardening)

### A1. Email and addresses
- **A custom domain** with DNS, instead of `figbloom-crm.vercel.app`. Then set `APP_BASE_URL` to it. (MVP-09, closed for the test scope only.)
- **Support email through a verified domain.** Today Resend sends from `onboarding@resend.dev` and the support inbox is Given's Gmail. Verify a Figbloom domain in Resend (SPF and DKIM), set `SUPPORT_EMAIL_FROM` and `SUPPORT_INBOX_EMAIL` to real addresses (Michael's support mailbox), and rotate `RESEND_API_KEY`. (FIG-1524, FIG-1550.)
- **System email sender.** Invites and password resets go through a personal Gmail with an app password. Move them to a real sender on the Figbloom domain (Resend SMTP relay `smtp.resend.com` needs no code change). Gmail also has a daily sending limit.
- **Google and Microsoft sign-in for mail and calendar** (decision: Michael). Register the apps, add the redirect address `${APP_BASE_URL}/api/integrations/oauth/callback`, check the consent screens, set `GOOGLE_OAUTH_*` and `MICROSOFT_OAUTH_*`. Until then the Connect button shows a "not set up" message (defect D-2, fixed). The "Done when" line of MVP-09 asks for a connection to complete: that has not happened.
- **Quote send through the connected mailbox**, and enforcing `mail.use` and `meetings.schedule` (open in `docs/M13_CLOSEOUT.md`).

### A2. Files and antivirus (MVP-07, in M16)
- **A real file bucket** (S3-compatible) with keys and CORS, `STORAGE_DRIVER=s3`, and the `S3_*` values. Today production uses a temporary folder (`/tmp`), so uploads, avatars, quote PDFs and export downloads can disappear or fail between server instances. Given accepted this for the first test (smoke defect D-1, High).
- **Remove the test-only variables** `STORAGE_LOCAL_DIR` and `STORAGE_SIGNING_SECRET` once the bucket works.
- **The antivirus answer** (decision): a ClamAV host (`CLAMD_HOST`) or the agreed code change. Production runs with `ANTIVIRUS_MODE=builtin-only` and logs a warning.
- Re-test uploads, export downloads, signed links, card capture photos and the cross-organisation file checks. Turn on bucket versioning.
- The `files.purge` and `privacy.retention` jobs fail without a bucket. They should pass once it exists.

### A3. Database, backups and cost
- **Plan for the database** (decision: Michael). Neon free plan now; paid Neon or AWS RDS later (plain PostgreSQL, so moving is a dump and restore). Point-in-time recovery needs a paid plan.
- **Fill in the exact Neon restore window** in `docs/BACKUP_RESTORE.md` (marked FILL IN).
- **Off-site encrypted backups with two key holders** (open since M12). Until they exist, the platform audit anchor (`npm run audit:anchor`, FIG-1566) sits next to the database it protects. Keep the `.audit.head` file where the database owner cannot write. The audit hash is unkeyed; a keyed hash or an external anchor would stop a rewrite by someone holding the database and every copy. The restore check is manual; schedule it.
- **Vercel Hobby plan** is for non-commercial use. Move to Pro before commercial use (decision). Pro also allows native 5-minute crons.
- **The 5-minute scheduler** runs on a free cron-job.org account. Move it to a team-owned account or to Vercel Pro cron. Keep `CRON_SECRET` rotated and delete `CRON-JOB-ORG-HEADER.txt`.

### A4. Security and compliance
- **An independent penetration test** (open since M12).
- **Kenya Data Protection Act registration**, lawyer review and processor agreements (Resend, Neon, Vercel, Google).
- **Sentry:** set the DSN and check the alert route. Name who watches errors and the support inbox (hypercare, MVP-19).
- **Branch protection:** `dev-given` has no required status checks. Make the CI checks required before more people merge.
- **Michael's own sign-offs.** Given signed on his behalf on 10 and 11 Nov 2026 (`docs/DECISIONS.md` section 7). Michael has not signed. Ask for his lines.
- **Open decisions from M5:** the deal-rules migration lock, the Vitest 2 upgrade, `CLAMD_HOST`.

### A5. Tidy before real data
- **Delete the smoke-test records** in "Figbloom Digital Group" (companies "Smoke Test Co Ltd" and "Shape Probe Co", contacts, leads, deals, an invoice and payment, a task, the chat channel `smoke-test`) and the organisation "Smoke Test Org B".
- **Remove the four test users** (`givenjim04+sales`, `+delivery`, `+finance`, `+tech`) or give them to real people. Delete `TEST-USERS.txt`, `MANAGEMENT-INVITE-LINK.txt` and `PLATFORM-ADMIN-LINK.txt` from the scratchpad.
- **Neon variables** the integration created (`POSTGRES_*`, `PG*`, `NEON_*`, `VITE_NEON_AUTH_URL`) are not read by the app and can be removed.

## B. Next version: product work

### B1. V2 screens and features (hidden in the MVP, MVP-13)
Break-glass support access, platform flags and limits, announcements and the other V2 screens named in `docs/RESTRUCTURE_LOG.md` and issue FIG-1192. They exist as built or partly built; the MVP hides every link to them. Backend V2 (M17) and V2 QA (M18) are still to do. Finish, wire to the real API, test, then show them.

### B2. V1.1 gates and quality (M15 and M16)
- Gates: G2.01, G2.02 and G2.04 are passed or signed (`docs/V1_1_BACKEND_GATE.md`). **G2.03 (performance) is waived** by Given on 11 Nov 2026 (`docs/RESTRUCTURE_LOG.md` W7): measure the forecast, assistant-context and chat fixes from `docs/PERF_V1_1.md` on the staging stack. (MVP-15)
- UAT with real people, the manual accessibility and device passes, and design approval of the baselines (waived to hypercare, decision 6.12).
- Three Major masking and rule 9 findings (D-V11-03 to D-V11-05), the Ocean contrast defect, the daily-cron finding and the intermittent matrix cell (D-V11-11), listed in `docs/V11_TEST_REPORT.md`.
- Screens still on demo data, if any remain (MVP-12). Search for `demo/`.

### B3. Features not tested live in the MVP
- Push notifications, the AI assistant (needs `ANTHROPIC_API_KEY` and `ASSISTANT_MODEL`), Sentry, card capture, web forms from a real website, and two-step sign-in for tenant users end to end.
- **Platform suspend and reactivate through the console.** The smoke test did it by changing the database on the test organisation. Do it through the console and look at the "workspace suspended" screen (OS1) rendered live (D-5: the screen exists with tests, never seen live).
- **The full hosted route walk** (the 8th `tenantAttack` test) from a faster connection. It timed out from Kenya; its hard-coded 120 s hook limit may need raising.

## C. Quality and tidy-up
- **Sign-in rate limit numbers** (D-3, PR #51): review the limits after real use. A shared office address must not lock out a team, and brute-force protection must stay strict per account.
- **Health check** now follows the 15-minute job (D-4, PR #49). Check `lastCompletedAt` moves after the next deploy.
- **Prisma shows an update notice** (`prisma@latest`). Plan the upgrade with the Vitest decision.
- **`directUrl`** is deliberately not in the Prisma datasource; `scripts/migrate-deploy-direct.ts` maps `DIRECT_URL` for that one command. Keep it that way, or revisit if the tooling changes.
- **Migrations are forward-only.** Keep to the expand-and-contract rule (`docs/RUNBOOKS.md`). Always run `npm run migrate:deploy:direct` then `npm run db:grant-role` after a merge that adds a migration: on 10 Nov, 8 migrations had not been applied and jobs failed.
- **Longer-term:** Given's cut order if a date is at risk is in `CLAUDE.md`. Nothing here changes it.

## Keeping this file honest
When an item is done, delete it here and note it in the issue or `docs/MVP_HANDOVER.md`. When a new item is agreed, add it here with its owner and, if one exists, the Linear issue.
