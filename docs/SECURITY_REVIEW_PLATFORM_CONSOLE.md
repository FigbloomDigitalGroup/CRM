# Security review: platform console, and the break-glass threat model (G2.02, FIG-1157)

Reviewed on branch `makeover/m15-v11-gates` (from `dev-given` at "M14: MVP on Vercel (#32)"), 9 Nov 2026, by Claude Code for Given.
Design reference: PL7 to PL15. Depends on B6.03 to B6.09 (FIG-1135 to FIG-1141, FIG-1134, FIG-1140). Companion documents:
[PLATFORM_IDENTITY.md](PLATFORM_IDENTITY.md), [PLATFORM_ADMINS.md](PLATFORM_ADMINS.md), [PLATFORM_CONSOLE_API.md](PLATFORM_CONSOLE_API.md),
[PLATFORM_BOOTSTRAP.md](PLATFORM_BOOTSTRAP.md), [SECURITY_REVIEW_V1.md](SECURITY_REVIEW_V1.md), [DECISIONS.md](DECISIONS.md) (4.7, 6, 7, 7.1).

**Result: no open High findings.** Seven findings were recorded. Three were fixed in this review (one Medium, one Medium, one Low), each with a test.
Four are accepted with a stated reason and an owner for the follow-up (two Medium, two Low). The break-glass for customer data (support access) does
not exist in the code today, so there is nothing to attack; section 5 lists what it must meet before anyone builds it.

This is a desk review of the code, the migrations and the tests, plus new tests. It is not an independent penetration test (that is still open,
see CLAUDE.md, "Not done and not waived").

## 1. What is being protected

| Asset | Why it matters | Where it lives |
|---|---|---|
| Platform admin identity and its sessions | Can suspend or offboard any organisation, approve its deletion, invite more admins | `platform_identities`, `platform_sessions`, `platform_admin_invites`, two-step tables |
| Platform audit log | The only record of what the platform did; its value is that nobody can edit it | `platform_audit_events` (hash chain), `platform_audit_verifications` |
| Customer data of every organisation | The reason the wall between platform and tenant exists | tenant tables (row-level security), the object store |
| Organisation exports and deletion certificates | An export is the whole organisation in one file | `platform_data_requests`, the object store, `platform_deletion_certificates` |
| Database owner credentials and `PLATFORM_DATABASE_URL` | Root of trust: whoever holds the owner connection can do anything below | the secret manager (production), `.env` (local) |

## 2. Trust boundaries and what crosses them

1. **Internet to console.** Only `/api/platform/*` and `/platform/*`. A signed-out caller and every tenant user (Management included) get the ordinary 404.
2. **Console to tenant data.** The platform database role `figbloom_platform` has privileges on three objects and no tenant table. Some operations
   (provisioning, status change, export, deletion) deliberately run on the owner connection after an application check; the list is in
   [PLATFORM_IDENTITY.md](PLATFORM_IDENTITY.md), "Owner-connection operations", and is reviewed in 4.5.
3. **Tenant to platform.** The tenant role is refused on every platform table; a tenant session or cookie gives no platform context.
4. **Operator to everything.** A person with owner database credentials (and the application secrets) is outside every control below. They are the
   break-glass of last resort (section 3, B1) and the residual risk of the design (section 7).

## 3. Break-glass, as it exists today and as it is designed

"Break-glass" means any way a person reaches more than their role normally allows. There are three, and they are different:

| # | Break-glass | Built? | Who | What it gives |
|---|---|---|---|---|
| B1 | **Operator bootstrap and recovery**: `npm run platform:bootstrap-admin` (with `--force` for a lockout) | Yes (MVP-10) | A person with database credentials and a shell on the host | An invitation or recovery link for a platform admin. No data access. |
| B2 | **Support access**: a time-boxed, read-only view inside one organisation, approved by that organisation (DECISIONS 6, PL7, OS2 to OS5) | **No.** V2, hidden in the MVP (DECISIONS 7.1). Only the permission key `platform.support.request` and the notification type `SUPPORT_ACCESS_REQUEST` exist; there is no route, table or service. | A platform admin with the key | Nothing today. |
| B3 | **Declared-outage access**: Figbloom acts alone, time-boxed and fully logged, the organisation told afterwards (DECISIONS 6) | **No.** Part of B2's design. | A platform admin | Nothing today. |

Because B2 and B3 are not built, the review verifies the negative: no code path lets a platform identity read a customer record (4.4), and
section 5 sets the requirements for building B2 and B3 so that they can be reviewed against a list instead of invented under time pressure.

### Threat model for B1 (operator bootstrap and recovery)

| Threat | Control | Residual |
|---|---|---|
| Someone runs it to become an admin on a live system | Refuses while any non-dev platform admin exists; `--force` is for lockout only; in production refuses if a dev account exists or `APP_BASE_URL` is unset (`tests/platformBootstrap.test.ts`) | An operator with credentials can still insert rows directly. Accepted: same trust as the database owner. |
| The printed link is read by a bystander or kept in shell history or CI logs | Single use, hashed at rest, 7 days for an invitation and, since this review, 24 hours for a recovery link (F-05); the app never logs the link; the guide says to clear the terminal | The window until the link is used. Run it only on a trusted host and open the link at once. |
| The action leaves no trace | Audited as `platform.admin_invited` or `platform.admin_recovery_issued` with actor "operator" | An operator can also edit the log (F-03). |
| Recovery is abused to take over an existing admin | Recovery ends the admin's sessions and removes their second step, so a takeover shows up as a forced re-enrolment and a `platform.admin_recovered` audit entry | A mailbox compromise plus the link. See F-05 and section 7. |

## 4. Review by area

### 4.1 Identity and sign-in

What holds: separate identity table, separate cookie (`figbloom_platform_session`, `httpOnly`, `sameSite=strict`, `secure` in production, expiring with the
session's absolute limit), password then a second step always (no organisation policy can switch it off), no session until both are done, generic
failure for every cause, per-address and per-email rate limits on sign-in and on each second-step call, a lock after repeated wrong attempts, an
email alert on lock and on use of a backup code, one used backup code never reusable, challenge tokens single-use and burned on use. The dev Super
Admin has no password sign-in and, in a production build, does not exist (`check:build-output`, the boot guard, the seed refusal; CLAUDE.md rule 10).
CSRF: `/api/platform/` is in the protected prefix list of `src/lib/csrf.ts`; a state-changing request must carry a matching `Origin` or `Referer`.

Findings: **F-02** (timing could reveal which emails are platform admins; fixed) and **F-06** (a lock can be used to keep an admin out; accepted).

### 4.2 Session policy

4 h idle and 12 h absolute by default, tunable within a range (idle 1 to 8 h, longest 4 to 24 h, idle never longer than longest); the idle expiry slides but
never past the absolute limit; a suspended identity's sessions end at once and a stale session of a suspended identity grants no key; sign-out revokes
the row. Tokens are 256-bit random values, only the SHA-256 is stored. A session is not bound to an address or browser (a design choice: admins work
from changing networks). **F-04** (failed step-up codes do not end the session) is accepted at Low.

### 4.3 Verify it's you (step-up)

Every state-changing platform action that matters (roster changes, security settings, data-request decisions, cancel, retry, delete, incident markers)
calls `requireRecentVerification`: the session must have proved a code within the window (default 15 minutes; 5 to 60). Reading needs none. Checked:
the call is present on every data-request mutation route and every roster mutation; a session starts verified only because it is created after the
second step; the renewal is rate limited per identity and per address and every failure and success is audited. One thing to remember when new
routes are added: the check is per route, not in the door, so a new mutating platform route that forgets it is open to a hijacked session. The V1.1
walk (G2.01) does not cover platform routes (they are not organisation routes); see 6, "Follow-ups", for a generated guard.

### 4.4 No customer data without break-glass (DECISIONS 4.7)

Four independent walls, each with tests (`tests/platformIdentityFoundation.test.ts`):

1. The platform role is not a superuser and not `BYPASSRLS`, holds privileges on exactly three objects, and `db:grant-role` re-revokes everything else on every run.
2. Row-level security is forced on every tenant table and the platform role is named in no tenant policy; it stays refused when it sets a tenant context itself.
3. The only tenant facts it can read are counts and a short list of operational columns (the four views). The counts view is checked by a test that allows only count columns plus the organisation's own name and status; the other three list their columns one by one in their migration.
4. No `platform.*` key reads a customer record, a deal value, a payment or a cost (asserted by a test over the key catalogue).

The audit log refuses metadata keys that look like values, amounts, costs, margins, payments, passwords, secrets, tokens or phone numbers.
The `reason` field is free text typed by an admin (5 to 500 characters); admins are told not to paste customer data into it (guide wording to add, F-07).

### 4.5 The owner-connection operations

These are the places where the platform's power does not come from the database role, so the application check is the only wall. For each: the key
that guards it, the extra guard, and the verdict.

| Operation | Guard | Verdict |
|---|---|---|
| Organisation export | `platform.data_requests.manage`; table allow-list kept complete by a test; secrets and hashes redacted by column name; only the organisation's Management downloads, inside 14 days; purged by the maintenance cron | Sound. The export is the whole organisation: it is encrypted in transit and at rest only to the extent the object store is (production host still open). |
| Deletion | Two different approvers, the waiting period (30 days, never under 7), the organisation already `OFFBOARDING`, the export packaged, the slug typed back, row locks, files removed first then one transaction, a tombstone and a counts-only certificate, resumable, not cancellable once started | Sound after **F-01** (an approval from a suspended or removed admin no longer counts; fixed). |
| Decide, cancel, retry export | `platform.data_requests.manage` plus step-up; one decision per person (database rule); a deletion approval from an identity reset in the last 24 hours is refused | Sound. |
| Suspend, reactivate, offboard | `platform.organizations.suspend`, step-up, reason of 5 to 500 characters, lifecycle events append-only; enforcement in `resolveActiveMembership` and `claimJob` | Sound. A suspended organisation's members see the OS1 screen, which is also how an unwanted offboarding is noticed. |
| Provisioning | `platform.organizations.provision`; idempotency key; slug rules and reserved list; the invite link is emailed, not returned | Sound. |
| Profile reads | `platform.organizations.view`; columns limited to the profile view plus the owner contact | Sound. Reads are not audited (accepted, F-07). |

### 4.6 Audit integrity

Append-only for the platform role (SELECT and INSERT only) and by trigger for every role (UPDATE, DELETE, TRUNCATE refused); each row gets a gap-free
`seq` and a SHA-256 hash that includes the previous hash, computed by a database trigger; `verifyAuditChain` recomputes the chain and remembers the head
it saw, so a deleted tail is noticed; the maintenance cron runs it and logs an error (which alerting hears) when it breaks; the log can be exported
(10,000 rows) and carries no values. Tests: `tests/platformAuditLog.test.ts`. Finding **F-03**: the hash is not keyed and lives in the same database
as the rows, so someone who owns the database can switch the triggers off and rewrite the whole chain consistently. Mitigated by an export and head hash in the backups and a restore check (FIG-1566, section 6), which still needs its off-site, encrypted copy to be worth the name.

### 4.7 Recovery

Lost device: another admin resets the second step (sessions end, the person is emailed, enrols again). Lost password: another admin issues a
single-use recovery link. Nobody can recover themselves; there is no recovery by email alone. At least two active admins must exist (database-level
advisory lock, so two admins cannot remove each other at once); nobody can suspend or remove themselves. If everyone is locked out the way back is B1.
Findings: **F-05** (the recovery link lived seven days; now 24 hours; fixed) and **F-06**.

## 5. Requirements for support access (B2) and declared-outage access (B3), before they are built

These are acceptance criteria for B6.12 (support access) and the other V2 items, taken from DECISIONS 4.7, 6 and 7, and PL7, OS2 to OS5.
Each is a test to write, not a wish.

| # | Requirement |
|---|---|
| R1 | A support session is a separate grant (own table), never a flag on the platform identity or the tenant role. It names one organisation, one admin, a reason, a ticket reference, a scope, and an end time. |
| R2 | The organisation's Management approves it (OS2) and can end it at any moment. Default is "approval required". Nothing is readable while the request is pending, denied or expired. |
| R3 | Duration is 30, 60 or 120 minutes, enforced on the server at every read, not by the screen. No extension without a new approval. Expiry needs no job to fire: the check compares the clock on each request. |
| R4 | Read-only. The grant carries no write privilege; a test calls every tenant mutating route with a support grant and expects refusal. |
| R5 | Reads go through the tenant's masking rules as a role that sees no deal values, margins, costs or payments, whatever the scope says ("mask customer values by default" is the floor; unmasking is a separate, rarer approval). |
| R6 | The session never uses `adminDb`. It uses a new narrow database role or a `SECURITY DEFINER` function per allowed read, so a coding mistake cannot widen it. Row-level security still applies. |
| R7 | Every page or record read is a row in the organisation's own audit log (visible in OS4) and in the platform audit log; both name the admin, the reason and the ticket. |
| R8 | Step-up is required to open the session, not only to request it. A session without a fresh second-step proof cannot open a grant. |
| R9 | The organisation sees a persistent banner while a session is active (OS3) and is notified when one starts and ends, to every Management member, by email as well as in the app. |
| R10 | B3 (act alone in a declared outage) needs two platform admins, a declared incident marker (B6.07), a shorter maximum, and an after-the-fact notice to the organisation within one hour. It is off unless the incident marker exists. |
| R11 | No grant can be issued to the admin who raised it for themselves in B3; the second admin is a different person who passed step-up. |
| R12 | A tenant-isolation test proves a grant for organisation A reads nothing of organisation B; a platform-to-tenant test proves a platform identity without a live grant still reads nothing. |

## 6. Findings, fixes and follow-ups

Severity: High means a platform admin or an attacker could reach customer data or destroy an organisation without the controls in this document noticing or stopping it.

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-01 | Medium | The deletion gate counted approvals by identity id only. An approval from an admin who had since been suspended or removed (the usual response to a suspected compromise) still counted toward the two needed. | **Fixed.** The gate counts only approvers who are still active and names the problem when one is not. Test: `tests/platformDataRequests.test.ts`, "an approval stops counting when its approver is suspended". |
| F-02 | Low | An unknown, suspended or password-less email was refused in a few milliseconds, a correct-looking one after a bcrypt comparison, so response time said which emails belong to platform admins. | **Fixed.** Every refusal pays one comparison against a decoy hash. Test: `tests/platformAdmins.test.ts`, "takes about as long to refuse...". |
| F-03 | Medium | The audit hash chain is unkeyed and stored beside the rows. Someone who owns the database can disable the triggers and rewrite history consistently; verification would pass. | **Built in FIG-1566 (11 Nov 2026); the off-site, encrypted copy is still open.** Every nightly backup now carries the platform audit export and the chain head (`ops/backup/audit-export.sql`, `backup-nightly.sh`), and `npm run audit:anchor -- check <file> --database` recomputes the chain from the copy and compares it with the restored database, failing on any changed, removed, inserted or cut-off row. Tests: `tests/platformAuditAnchor.test.ts` (clean chain, tampered row, a consistent rewrite that only the copy exposes, truncated tail, empty log, and agreement with the real trigger). Limits: the copy sits beside the database until a person provides the off-site location and keys (the open M12 item, `docs/BACKUP_RESTORE.md` section 11); the hash is still unkeyed; a restore check is a command, not yet a schedule. Until the copy leaves the host, keep the small `.audit.head` file somewhere the database owner cannot write. Owner: Given. |
| F-04 | Low | A wrong step-up code is rate limited (10 per 15 minutes per admin) and audited, but does not end the session. A stolen live session could keep guessing. | **Accepted.** The attacker needs a live `httpOnly`, `sameSite=strict` session cookie, gets about 40 guesses an hour against roughly three valid codes in a million, and every miss is in the audit log. Follow-up (V1.1.x): end the session after 5 consecutive misses. |
| F-05 | Medium | A recovery link, which resets the password and the second step, was valid for seven days. | **Fixed.** Recovery links live 24 hours; invitations stay at seven days. Test: `tests/platformAdmins.test.ts`, "a recovery link lives 24 hours". The residual risk (the mailbox of the person being recovered) is in section 7. |
| F-06 | Low | The lock after repeated wrong passwords keys on the identity, so anyone who knows an admin's email can keep that admin out by failing five times every lock period. With only two admins both could be kept out. | **Accepted.** The rate limit by address and the lock email alert make it noisy; the way back is B1, and the lock length is a setting (5 to 240 minutes). Follow-up: lock per address and email pair once there are more than two admins. |
| F-07 | Low | Platform reads (organisation list, profile, audit view) are not audited; the free-text `reason` could hold customer data typed by an admin. | **Accepted.** Reads show counts and operational columns only (4.4). Follow-up: audit profile reads when support access is built (R7); add one sentence to the console guide telling admins not to paste customer data into a reason. |

Also reviewed and found sound, with no change: single-use and hashed invitation tokens, the constant-time cron secret check, the one-decision-per-person database rule, the
minimum-two rule under an advisory lock, the 24-hour wait after a credential reset before an approval counts, the resumable deletion, the file removal ahead of the transaction,
the counts-only deletion certificate, and the fact that the dev Super Admin cannot exist in a production build.

**Follow-ups, none of them blocking** (record them in Linear as V1.1.x, Given's choice):

1. A generated guard for the platform routes, as G1.02 is for organisation routes: every `/api/platform/*` route, as a tenant Management user and as a platform admin
   without each key, with the rule that every non-GET route either calls `requireRecentVerification` or is on a reviewed list (4.3). Not built in this issue.
2. F-03's off-site, encrypted copy of the audit export and head hash. The export, the head and the restore check are built (FIG-1566); only the second location and keys, which a person must provide, remain.
3. F-04's session end after repeated misses, and F-06's per-address lock.
4. A production check that `PLATFORM_DATABASE_URL` is a different role from `DATABASE_URL` (the boot guard checks dev accounts only).

## 7. Residual risk, stated plainly

- **The database owner and the application secrets are the root of trust.** Anyone holding them can read every tenant, rewrite the audit log and create an admin.
  The platform design limits what a platform admin can do; it does not limit what the operator of the database can do. Keep the number of people with owner credentials to the
  smallest possible and never in a shared account.
- **Two admins are a small quorum.** Two colluding or coerced admins can approve a deletion (the 30-day wait, the offboarding state visible to every member of the organisation,
  and the right to cancel are what give the organisation time to notice). The organisation's other Management users are not emailed when a deletion is requested or approved;
  that notification is cheap and worth adding in V1.1.x.
- **A mailbox is a credential for recovery links.** The 24-hour life and single use reduce it; a hardware-key requirement for platform admins would remove it (not planned).
- **Not independently tested.** This is a desk review. The independent penetration test remains open and should include the platform console.

## 8. Evidence

New or extended tests in this review: `tests/platformDataRequests.test.ts` (F-01), `tests/platformAdmins.test.ts` (F-02, F-05). Existing suites this review relied on:
`tests/platformIdentityFoundation.test.ts`, `platformAdmins.test.ts`, `platformAuditLog.test.ts`, `platformDataRequests.test.ts`, `platformOrganizations.test.ts`, `organizationLifecycle.test.ts`,
`platformBootstrap.test.ts`, `platformHealth.test.ts`. Platform-to-tenant and tenant-to-platform denial across every route, on a V1.1 organisation: `tests/tenantAttackV11.test.ts` (G2.01).
Run results are in [TEST_REPORT_V1_1.md](TEST_REPORT_V1_1.md).

## 9. Sign-off

Reviewed by: Claude Code (desk review), 9 Nov 2026. Recorded by Given: ______ . Michael's approval (G2.04): ______ .
