# Platform admins, minimum-two rule, security settings and recovery (FIG-1140, B6.08)

Design reference: PL10 (admins), PL11 (verify it's you), PL14 (platform security). Builds on `docs/PLATFORM_IDENTITY.md` (B6.03) and `docs/TWO_STEP_SIGN_IN.md` (B6.02). Everything runs as the platform database role: none of it can read a tenant table.

## Sign-in

`POST /api/platform/auth/sign-in` (password) answers `{ twoStepRequired: true, purpose }` and sets a strict, ten-minute pending cookie `figbloom_platform_two_step_pending`; no session yet. Then `/api/platform/auth/two-step/verify` (code or backup code) or, for an admin with no second step yet, `/api/platform/auth/two-step/enrol/start` and `/confirm` (shows backup codes once). Only then `createPlatformSession` runs (strict same-site cookie `figbloom_platform_session`, expires with the session). Every failure is the same generic 401; rate limited per address and per email; wrong passwords or codes lock the identity (settings below). The dev Super Admin has no password sign-in. Sign-out: `POST /api/platform/auth/sign-out`.

## The roster

`GET /api/platform/admins` (list, open invitations, `activeCount`, `minimumActive`), `POST /api/platform/admins` (invite), `DELETE /api/platform/admins/{id}`, `POST .../suspend`, `.../reinstate`, `.../two-step-reset`, `.../recovery-link`, `DELETE /api/platform/invites/{id}`. All need `platform.admins.manage`.

- **Minimum two.** Suspending or removing an active admin is refused when fewer than two active admins would remain (`MIN_ACTIVE_PLATFORM_ADMINS`, a rule not a setting). The count and the change run in one transaction under an advisory lock, so two admins removing each other at once cannot both succeed. Suspending ends the admin's sessions at once. Nobody can suspend, remove, reset or recover themselves. The dev fixture is not part of the roster or the count.
- **Invite.** Single-use link (SHA-256 stored), seven days for an invitation and 24 hours for a recovery link (G2.02, F-05), emailed. `POST /api/platform/auth/accept-invite` (public, rate limited) creates the admin with a password of at least 12 characters; no session is issued, and the first sign-in enrols two-step.
- **First admin and break-glass.** Platform admins are never created by a migration or a seed. An operator with database credentials runs `npm run platform:bootstrap-admin -- <email> <name>`: it issues an invitation (or a recovery link for an existing admin), audited as done by "operator". This is also the way back in when no admin can sign in.

## Verify it's you

Every change here (invite, suspend, reinstate, remove, reset two-step, recovery link, revoke invite, security settings) needs a verification no older than the "verification window" setting (default 15 minutes). Otherwise 403 with a message starting "Verify it's you" (`ReverificationRequiredError`). `POST /api/platform/security/verify { code }` (authenticator or backup code, rate limited, audited) renews it on the session (`platform_sessions.verified_at`; a new session starts verified). Reading needs no fresh verification.

## Recovery

Lost device: another admin calls `.../two-step-reset` (two-step removed, sessions ended, the admin is emailed and enrols again at next sign-in). Lost password: `.../recovery-link` issues a single-use link that sets a new password, resets two-step and ends sessions. A used backup code is alerted by email. No self-service recovery by email alone (an attacker with the mailbox would otherwise bypass the second step).

## Platform security settings

`GET`/`PATCH /api/platform/security/settings` (`platform.security.manage`; PATCH needs a recent verification): idle sign-out 1 to 8 h (default 4), longest session 4 to 24 h (12), verification window 5 to 60 min (15), wrong attempts before a lock 3 to 10 (5), lock minutes 5 to 240 (15). Each value is range-checked; idle can never exceed the longest session; only changed values are written and audited with before and after. New sessions and every sliding expiry read them.

## Audit

Every action is one entry in the platform audit log (FIG-1138, `recordPlatformAudit`, chained and append-only): `platform.signed_in`, `signin_failed`, `signin_locked`, `signed_out`, `two_step_enrolled`, `backup_code_used`, `reverified`, `reverify_failed`, `admin_invited`, `admin_joined`, `admin_suspended`, `admin_reinstated`, `admin_removed`, `admin_two_step_reset`, `admin_recovery_issued`, `admin_recovered`, `admin_invite_revoked`, `security_settings_changed`. Metadata holds no secret, token or password.

## Decisions taken without being asked

Platform admins have no trusted devices; two-step is always required; self-actions on the roster are refused; removal is a hard delete of the identity (the audit log keeps the email in its actor label); the invite link is returned to the verified inviting admin as well as emailed; a missing SMTP configuration logs the link like other auth emails (production needs SMTP).

## To wire

PL10, PL11 and PL14 in `src/ui/screens/platform/demo/`, and the platform sign-in page (new route). Not wired here.

## Tests

`tests/platformAdmins.test.ts` (24): enrol-first sign-in and backup codes, secrets at rest, generic failures, lockout and rate limits, challenge burn, platform role refused on tenant two-step tables, minimum two (suspend, remove, third admin, concurrency, self, dev, stranger), roster audit, verification window and renewal, keys, invitations (single use, expiry, withdrawn), two-step reset, recovery link, settings (defaults, validation, audit, effect on sessions and lock), routes (cookies, 404 for tenant users, 403 verify prompt). `tests/platformIdentityFoundation.test.ts` lists the new platform-owned tables.
