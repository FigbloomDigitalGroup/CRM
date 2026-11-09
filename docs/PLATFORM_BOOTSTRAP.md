# Platform bootstrap: first sign-in on an empty production database (MVP-10)

Goal: Michael signs in as platform admin, creates the first organisation and invites its first Management user, with no dev account anywhere. The dev seed refuses to run when `NODE_ENV=production`, and production boot fails if a dev account exists (`src/auth/devAccountGuard.ts`, called from `src/instrumentation.ts`). Platform admins are never created by a migration or seed ([PLATFORM_IDENTITY.md](PLATFORM_IDENTITY.md), [PLATFORM_ADMINS.md](PLATFORM_ADMINS.md)); this command is the only way in from nothing.

## Before you start

1. Migrations and roles are applied ([DEPLOYMENT.md](DEPLOYMENT.md)); `npm run seed` has run (production-safe: roles and permissions only).
2. Environment of the shell you run the command in: `DATABASE_URL` (owner, used to check for dev accounts), `PLATFORM_DATABASE_URL`, `NODE_ENV=production`, and **`APP_BASE_URL`** set to the public https address (the link is built from it; bootstrap refuses without it in production).
3. For the link to arrive by email as well, email must be configured (`RESEND_API_KEY` and `EMAIL_FROM`, or SMTP; see `.env.example`). Without it the link is only printed by the command.

## Walk-through

1. **Create the invitation** (once):
   `npm run platform:bootstrap-admin -- michael@example.com "Michael Surname"`
   It creates no account and sets no password. It prints one single-use link (valid 7 days; a recovery link made with `--force` for an existing admin is valid 24 hours) and writes a platform audit entry. The link is never logged by the app; treat the terminal output as a secret and clear it afterwards.
2. **Open the link** (`/platform/accept-invite?token=...`), choose a password (at least the platform minimum). The identity is created here: exactly one, `is_dev = false`.
3. **Platform sign-in** at `/platform/sign-in` with email and password. First sign-in is **two-step enrolment**: scan the QR code (or enter the key) in an authenticator app, confirm with a code. Keep the recovery details safe; a second platform admin is advised (the console enforces a minimum of two before some actions).
4. **Create the first organisation** in the console (Organisations, New). This uses the product's provisioning path (`organizationProvisioningService`), which also loads the organisation's starting reference data (pipelines, stages, tags, catalogues) and no demo records.
5. **Invite its Management user by email** (the admin email entered in step 4; the invite is sent through the configured email provider).
6. The invitee opens the invite (`/accept-invite`), sets a password, and **signs in** at `/login`. If the organisation requires two-step, they enrol at first sign-in.
7. Check `/api/health`: `"email": {"status": "ok"}`.

## Safety rules (tested in `tests/platformBootstrap.test.ts`)

- A second run refuses while any non-dev platform admin exists. `--force` is for lockout only: it issues a recovery link for an existing email, or an extra invitation for a new one.
- In production it also refuses if a dev user (`@figbloom.local`) or dev platform identity exists, or `APP_BASE_URL` is unset.
- It never creates a dev account and never calls the seed.
- Lost the link or it expired: re-issue with `--force` (the previous live link for that email is revoked).

## Not done here

Sending a real test email, verifying the sender domain in Resend, and a real-inbox check are manual steps for Michael ([SUPPORT_BY_EMAIL.md](SUPPORT_BY_EMAIL.md)).
