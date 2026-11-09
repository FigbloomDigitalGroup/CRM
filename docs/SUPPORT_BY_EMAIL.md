# Support requests by email (decision 12)

On 5 Nov 2026 Michael decided that the CRM does not need a Customer Support role. Michael has a platform console for all Figbloom systems, and every customer support ticket goes there. So the CRM only has to let an organisation's members **raise a ticket by email**. This replaces FIG-1155 (B6.23) and FIG-1178 (F6.19); see `docs/DECISIONS.md` section 5.0, decision 12.

## What a member sees

Help panel (the question mark in the top bar), then **Contact support**. A dialog asks for a subject, a kind of request (question, something is not working, sign-in or access, billing or plan, something else), a message and an "urgent" tick. Sending shows a reference such as `FB-20261105-K7Q2X9`. The answer comes to the member's own email.

Every role has it (Management, Sales, Delivery, Finance, Restricted Technical): asking for help needs no permission key, only a signed-in membership in a V1.1 organisation.

## What Figbloom receives

One plain-text email, sent through the Resend API (`src/integrations/email/resend.ts`):

- To: `SUPPORT_INBOX_EMAIL`. From: `SUPPORT_EMAIL_FROM` (a domain verified in Resend).
- **Reply-To: the member's address**, so replying in the mail client answers the member directly.
- Subject: `[URGENT] [FB-yyyymmdd-XXXXXX] <subject>` (the urgent mark only when ticked).
- Body: the member's message, then a block with the reference, kind, urgency, who (name, email, role), the organisation (name, slug, id), the page path and the time.
- Headers for the platform console to read: `X-Figbloom-Support-Reference`, `X-Figbloom-Organization-Id`, `X-Figbloom-Organization-Slug`. Resend tags: `kind=support_request`, `category=<kind>`.

Nothing about deals is in it (hard rule 7): no value, cost, margin or payment. The page is a path only; query strings and fragments are cut off because they can carry tokens.

## The API

`POST /api/orgs/{orgSlug}/support-requests`, body `{ subject, message, category?, urgency?, pagePath? }`, answers `{ reference, sent }`.

- Gate: V1.1 release (`release.v11`), like every V1.1 route. Any active member.
- `Idempotency-Key` is honoured (the UI sends one), so a double click or a retry sends one email.
- Limits: 5 requests an hour per member, 20 an hour per organisation (`SUPPORT_REQUEST` in `auth_rate_limit_attempts`), then 429.
- Validation: subject 1 to 160 characters, message 1 to 5000, line breaks and control characters removed from the subject (no header injection).
- Not configured: in production, 503 `SERVICE_UNAVAILABLE` ("Support by email is not set up yet"). Elsewhere the request is logged and the answer is `sent: false`.
- Resend refuses or does not answer (10 second limit): 503, and the cause (HTTP status, Resend's error name) goes to the server log only. The API key is never logged or returned.
- Audit: `support.request_sent` with reference, kind, urgency and the Resend message id. **Never the subject or the message**: those are the member's words and live in the support inbox.

## Set-up

Needs Michael's Resend API key. Steps, variables and the check list are in `docs/DEPLOYMENT.md`, section "Support requests by email (Resend)". Variables: `RESEND_API_KEY`, `SUPPORT_EMAIL_FROM`, `SUPPORT_INBOX_EMAIL` (in `.env.example`).

## What was removed

- The Customer Support role (`CUSTOMER_SUPPORT`), its permission set, the `tickets.manage` permission, the `customer_support.role` flag and the dev account `dev.support@figbloom.local`. There are now five roles and seven dev accounts (six tenant users and the Dev Super Admin).
- The ticket, ticket message and satisfaction survey tables, services, routes and public survey link, and the Support workspace, ticket and customer screens and the Support home.
- Migration `20261120090000_remove_customer_support` does the database side. It stops if a real (non-dev, non-test) account still holds the role, and it deletes the dev and test accounts that held it. `20261109110000_support_tickets` stays in the history (it was never deployed); the `SURVEY_RESPONSE` rate-limit value stays because PostgreSQL cannot drop an enum value.
- The Customer 360 "tickets" section still answers `not_available`, now with the reason "Support tickets are raised by email to Figbloom support and are not held in the CRM."

## Not built, on purpose

- No ticket list, status or thread in the CRM, no satisfaction survey, no inbound reply handling: the platform console owns the ticket. If the console wants replies to appear in the CRM, that is a new decision.
- A member who prefers plain email can write to the support address directly; nothing here stops that. (Showing that address inside the app needs `SUPPORT_INBOX_EMAIL` exposed to the browser; not done, ask if wanted.)
- The system emails (password reset, invites, notifications, platform admin links, quotes) now use the same Resend key (MVP-11, 9 Nov 2026): `src/auth/email.ts` sends through SMTP when `SMTP_HOST` is set (it wins), otherwise through the Resend API when `RESEND_API_KEY` is set, with the sender from `EMAIL_FROM` (else `SMTP_FROM`) on a domain verified in Resend. In production with neither, the app logs an ERROR at boot, `/api/health` reports `email.status: "misconfigured"`, and no link is ever logged. In production a missing support configuration also logs an error and answers the member with a 503 "not set up".

## Tests

`tests/supportRequests.test.ts`: validation, composing the email (Reply-To, subject, headers, no deal data), the Resend adapter against a stand-in `fetch` (request shape, idempotency key, error mapping, key never in the error), the 503 when not configured in production, the log-only path in development, the rate limits, the audit event without the message, and every role allowed. `tests/components/screens/palette/` covers the dialog.
