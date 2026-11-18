# Web forms builder and public form endpoint (FIG-1151, B6.19, design S6#2)

V1.1. Code: `src/lib/webForms.ts` (pure rules), `src/services/webFormService.ts` (builder), `src/services/webFormSubmissionService.ts`
(public endpoint), `src/repositories/webForms.ts`; migrations `20261108134250_web_form_rate_limit_action` and `20261108134300_web_forms`
(tables `web_forms`, `web_form_submissions`, both with RLS). The Settings screen for forms
(`src/ui/screens/settingsplus/`) is still on demo data; wire it in M14.

## Builder routes (Management, `configuration.manage`; outside the frozen V1 contract; create accepts `Idempotency-Key`)

| Route | What |
|---|---|
| `GET`, `POST /api/orgs/{org}/web-forms` | List, create (a draft with name, email, phone and message unless fields are given) |
| `GET`, `PATCH`, `DELETE /api/orgs/{org}/web-forms/{id}` | Read (with the last 30 days' counts), change or publish (`status` DRAFT, PUBLISHED, ARCHIVED), delete |
| `POST /api/orgs/{org}/web-forms/{id}/rotate-key` | New public key; the old one stops at once |
| `GET /api/orgs/{org}/web-forms/{id}/submissions?accepted=false&outcome=` | The log of attempts; `accepted=false` is the rejected-submission log, each with a plain-words explanation and any duplicate warning |

A form has up to 15 fields (`text`, `email`, `phone`, `textarea`, `select`), each optionally filling a lead field (`name`, `email`, `phone`,
`company`, `service`, `message`); an unmapped answer is added to the lead's notes under its label. A form must fill the name (required) and an email or a phone.
It also has a lead source (default Website), a success message, the websites allowed to post it, a hidden trap field name (default `website_url`) and an optional
Cloudflare Turnstile secret (write only: only `captchaConfigured` is ever returned).

## Public routes (`/api/public`, session-less, no CSRF; CORS open, the allowed-websites rule is enforced on the server)

| Route | What |
|---|---|
| `GET /api/public/orgs/{slug}/forms/{publicKey}` | What a page needs to draw the form: fields, trap field name, whether a captcha is needed |
| `POST /api/public/orgs/{slug}/forms/{publicKey}/submissions` | Submit; answers `{status: "received", message}` and nothing else (no ids) |

The public key (`wfk_...`) is embedded in a web page, so it is an address, not a secret. Protection is layered, in this order:

1. Unknown key, a key under another organisation's slug, a draft or archived form, a suspended organisation, or an organisation not on V1.1: one generic 404. The caller's address is still rate limited, so keys cannot be guessed quickly.
2. Body larger than 10,000 bytes.
3. Rate limits (durable, shared with the other public endpoints, action `WEB_FORM`): per address (10 a minute), per form (60) and per organisation (200); tunable with `WEB_FORM_RATE_LIMIT_WINDOW_MS`, `_MAX_PER_IP`, `_MAX_PER_FORM`, `_MAX_PER_ORG`.
4. The form's allowed websites, from `Origin` or `Referer`, when it lists any.
5. The body is read against the form's own fields: undeclared keys are ignored (a body cannot set an owner or a value), required answers, types, lengths, choices within their options.
6. The hidden trap (a bot is told it succeeded; no lead), the captcha when configured, and a link-spam check (more than 2 links).
7. The lead is made by the same ingestion as the website endpoint, so the existing assignment rules and follow-up task apply. The lead carries the form's lead source, `qualificationData.formId` and `formName`, and a `duplicateWarning` (`contact`, `company`) when the person or company already existed. The warning is for staff; the public response never says whether someone is already a customer.

Every attempt on a known form is written to its submission log and mirrored to the website request log that Settings already shows (B4.01), with the form's name in the reason. Rule 9: submitting a form creates a lead and what the assignment rules do; it moves no stage and sets no discount (a test checks no deal is created).

## Tests

`tests/webForms.test.ts`: the pure rules; builder permissions, validation, secrets never returned; a lead made with source and form id; duplicate warning to staff only; every rejection reason (generic 404 cases, key guessing, per-address and per-form limits, origin, size, JSON, validation, spam, trap, captcha), each logged; the route (CORS, envelope); rotated keys; deleting a form keeps the log; tenant isolation in the service and under RLS.
