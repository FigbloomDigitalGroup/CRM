# Sign-in rate limit (P2-02, FIG-1585)

Goal: a real person is never blocked from signing in by the rate limit, and nobody else can lock them out. Guessing passwords stays hopeless.

Code: `src/auth/loginThrottle.ts`, used by `startSignIn` in `src/services/authService.ts`.

## Rules

| Rule | Counted by | What happens |
|---|---|---|
| Growing wait | IP + email pair, failures in the last 15 minutes | After 3 failures the next attempt must wait 1 s, then 2, 4, 8, 16, up to 30 s. A refused attempt returns a wait (`retryAfterSeconds`); it is not counted and the server never sleeps. |
| Per-IP ceiling | failures from one address, last hour | 300 failures: hard block until the window passes (a real office does not reach it). |
| Per-email ceiling | failures for one email from all addresses, last hour | 200 failures: only the longest wait (30 s) applies, plus a security event. Never a block. |
| Account counter | `users.failed_sign_in_count` | Reaching `LOCKOUT_MAX_FAILURES` (200) sets `locked_until` as before, but it now means only the longest wait after the last failure. The right password works once it has passed. Admin unlock still clears everything. |
| Trusted device | cookie from two-step "remember this device" | A live, unrevoked cookie of that account skips every wait. |

Only failures count. A correct sign-in clears the IP + email pair. An attacker on address A only slows address A for that email; the person on address B is never affected.

The message uses the existing error slot: "Too many sign-in attempts. Please wait N seconds and try again." It is the same for an email that exists and one that does not. The login page itself is unchanged (frozen).

## What is stored

Table `auth_rate_limit_attempts`: action, scope (`pair`, `ip`, `email`), key (address, email, or `address|email`) and a time. Never a password or token (tested).

## Security events

Reaching the per-email ceiling writes the audit event `auth.rate_limit_ceiling` (to every organisation the person belongs to) and a log line `login.email_ceiling_reached`. Reaching the per-IP ceiling writes the log line `login.ip_ceiling_reached` only (no organisation to attribute it to). P2-16 can surface both in the audit trail.

## Password reset and two-step

* Password-reset request: the per-email limit of 3 let anyone block a victim's reset requests. It is now 3 per IP + email pair, with a per-email ceiling of 30 (mail flooding only) and the per-IP limit unchanged.
* Two-step code step: needs a challenge that only the right password issues, so a stranger cannot reach it; unchanged except that the account counter's lock is a wait (above).

## Settings

See `.env.example` and `docs/DEPLOYMENT.md`: `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX_PER_IP`, `LOGIN_RATE_LIMIT_MAX_PER_EMAIL`, `LOGIN_DELAY_WINDOW_MS`, `LOGIN_DELAY_FREE_ATTEMPTS`, `LOGIN_DELAY_BASE_SECONDS`, `LOGIN_DELAY_MAX_SECONDS`, `LOCKOUT_MAX_FAILURES`, `PASSWORD_RESET_RATE_LIMIT_MAX_PER_PAIR`.

## Not done

Trusted device for people without two-step: only the existing two-step trusted-device cookie bypasses the wait. A "known device" cookie for every successful sign-in would need its own signed cookie and a revocation list (a new table).
