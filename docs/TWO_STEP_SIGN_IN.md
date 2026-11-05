# Two-step sign-in (FIG-1134, B6.02)

Design reference: A5 (code step), S7 #2 (organisation policy), PL10 to PL14 (platform admins). Applies to organisation users and, always, to platform admins.

## The frozen sign-in pages are untouched

Hard rule 1: the login, sign-up, forgot password, reset password and accept-invite pages do not change. No file under `src/app/login`, `src/app/signup`, `src/app/forgot-password`, `src/app/reset-password` or `src/app/accept-invite` was edited, and `tests/uiGuards.test.ts` stays green without any loosening.

How the hand-off works without touching the page: the login page POSTs to `/api/auth/login` and, when `res.ok`, does `router.push('/o/' + organizationSlug)`. When a second step is needed, that API answers 200 in the same shape, with `twoStepRequired: true`, `twoStepPurpose` (`VERIFY` or `ENROL`) and `twoStepUrl: "/two-step"`, sets **no session cookie**, and sets a ten-minute httpOnly pending cookie (`figbloom_two_step_pending`). The page follows `organizationSlug` into `/o/<slug>`; the organisation layout (`src/app/o/[orgSlug]/layout.tsx`, not a frozen page) finds no session and, because the pending cookie exists, redirects to `/two-step` instead of `/login`. The `/two-step` page (A5, today a demo page behind `DEMO_SCREENS`) must call the routes below. The only frozen-adjacent file changed is the API route `src/app/api/auth/login/route.ts` (an API route is not one of the frozen pages, but Given should be aware).

## What exists

| Piece | Where |
|---|---|
| TOTP (RFC 6238, SHA-1, 30 s, 6 digits, plus or minus one step, replay-proof), no dependency | `src/auth/twoStep/totp.ts` |
| Seed encryption (AES-256-GCM, random nonce, version prefix); backup codes as keyed hashes | `src/auth/twoStep/secretBox.ts`, `backupCodes.ts` |
| One engine for both identity types (enrol, verify, backup codes, challenges), two stores | `src/auth/twoStep/engine.ts`, `stores.ts` |
| Tenant tables `user_two_step`, `user_backup_codes`, `user_trusted_devices`, `two_step_challenges`; platform tables `platform_two_step`, `platform_backup_codes`, `platform_two_step_challenges` | migration `20261109090000_two_step_sign_in` |
| Password step returns a session or a challenge | `startSignIn` in `src/services/authService.ts` (`login()` fails closed for an account that needs a second step) |
| Second step for users | `src/services/twoStepSignInService.ts`; routes under `/api/auth/two-step/*` |
| Policy, enrolment, backup codes, trusted devices, admin reset | `src/services/twoStepService.ts`; routes `/api/me/two-step*`, `/api/me/trusted-devices*`, `/api/orgs/{org}/security/two-step-policy`, `/api/orgs/{org}/memberships/{id}/two-step-reset` |
| Unusual-activity alerts (email plus audit) | `src/services/securityAlertService.ts` |
| Platform admins | `src/services/platformSignInService.ts`; routes under `/api/platform/auth/*` (see `docs/PLATFORM_ADMINS.md`) |

## Rules

- **Secrets.** The seed is stored encrypted with `TWO_STEP_ENCRYPTION_KEY` (base64, 32 bytes, from the secret manager; production fails closed without it; outside production a fixed dev-only key is used and protects nothing). Backup codes (10, single use, shown once) are HMAC hashes. Challenge and trusted-device tokens are random and only their SHA-256 is stored. Nothing secret is logged or placed in an audit entry or alert. The tenant application role is revoked from the user tables; they are read through the schema-owner connection, the platform tables only through the platform role.
- **Policy blocks sessions until verified.** Management (`security.manage`) can require two-step for the organisation. A person who belongs to any organisation that requires it is walked through enrolment first (`purpose: ENROL`): no session exists until the first code is confirmed and the backup codes were returned. Turning the policy on needs the actor to have two-step themselves and ends the sessions of members who have none (`TWO_STEP_REQUIRED`). A person cannot turn two-step off while an organisation requires it. A trusted device skips the code, never enrolment.
- **Brute force.** Every step is rate limited (per address and per account, new `AuthRateLimitAction` values), a challenge dies after 5 wrong codes, and wrong codes count toward the same account lockout as wrong passwords (B1.05). Used time steps cannot be replayed.
- **Recovery.** A backup code signs in (audited, alerted, remaining count shown). A member who lost the device and the codes is reset by Management (`membership.manage`): seed, codes and trusted devices removed, sessions ended, member emailed, audited. Refused for members of other organisations (an admin of one organisation must not weaken a person's security in another); those use backup codes or a Management user in each organisation. Platform admins: see `docs/PLATFORM_ADMINS.md`.
- **Alerts.** Email plus an audit entry for: backup code used, too many wrong codes, two-step turned off, reset by an administrator, a device trusted, backup codes regenerated; email for a new device on an account with two-step. Without SMTP configured the email is logged like the other auth emails (no code, secret or token in it).

## Decisions taken without being asked

- Trusted devices last 30 days, are for organisation users only, and are off unless the person ticks "remember this device". **Platform admins have no trusted devices** (higher privilege).
- Two-step for platform admins is mandatory with no switch.
- The login response carries `organizationSlug: "account"` for a person with two-step but no organisation, so the frozen page still redirects (it would otherwise show "not an active member").
- Two-step is not gated by the V1.1 release flag: nobody is enrolled by default, so V1 behaviour is unchanged.
- The error code list is frozen, so a wrong code is the ordinary 401 and the re-verification refusal a 403 whose message starts "Verify it's you".

## To wire (frontend)

A5, enrolment, the S7 #2 policy toggle and trusted devices are wired (M14, W6, 5 Nov 2026). The platform sign-in and PL10 to PL14 screens are not (platform lane).

## Tests

`tests/twoStepSignIn.test.ts` (25): RFC vectors, drift, encryption and tamper detection, nothing in the clear in the database, tenant role refused on the tables, enrolment, no session before the second step, replay, expiry, 5-attempt burn and lockout, rate limits, backup codes, trusted devices, new-device alert, untouched password-only accounts, policy (enrol-first, no session until confirmed, session end, cross-organisation isolation), disable and regenerate, administrator reset, the login hand-off and verify routes. `tests/platformAdmins.test.ts` covers the platform half.
