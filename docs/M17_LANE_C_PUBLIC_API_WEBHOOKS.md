# Public REST API with API tokens, and outbound webhooks (FIG-805, FIG-804)

Backend only, release V2. The settings screen is F7.03. Both are behind the `release.v2` flag: an organisation below V2 gets the explained
"not available yet" answer (403 `FEATURE_UNAVAILABLE`) from every route here. The frozen V1 contract
(`src/api/contract/openapi.v1.json`) is not changed; the new routes are listed in `NOT_IN_V1_CONTRACT` and documented in a document of
their own, `GET /api/v1/openapi.json`.

## 1. API tokens (FIG-805)

| What | Where |
|---|---|
| Token format, hashing, authentication, rate limit | `src/auth/apiToken.ts` |
| Create, list, revoke | `src/services/apiTokenService.ts`, `GET/POST /api/orgs/{org}/api-tokens`, `DELETE /api/orgs/{org}/api-tokens/{id}` |
| Table `api_tokens` (RLS, composite foreign key to the membership) | `20261123090100_api_tokens_webhooks` |
| Rate-limit action `API_TOKEN` | `20261123090000_api_token_rate_limit_action` |

- A token is `fbk_` plus 32 random bytes. **Only its SHA-256 is stored**; the plain token is in the create response and nowhere else (not in the list, not in the audit trail, not in logs).
- Expiry is required: 1 to 365 days, default 90. A token never lives forever. `last_used_at` is written at most once a minute. Revocation is immediate (`revoked_at`).
- Any member creates tokens for themselves (at most 25 active). A member lists and revokes their own; Management (`organization.manage_settings`) lists and revokes everyone's. Someone else's token answers 404.
- **A token runs as its owning membership.** Each request resolves that membership afresh (`resolveActiveMembership`), so a removed or deactivated person, a changed role or a suspended organisation takes effect on the next request (401). Scopes only narrow: `<entity>:read` and `<entity>:write` for `companies`, `contacts`, `leads`, `deals`, `activities`, `tasks`. The two are independent. A missing scope is an explained 403.
- Every failure to authenticate (missing, malformed, unknown, revoked, expired, owner gone) returns the same 401 message.
- The public API takes **only** a bearer token. It never reads the session cookie, so there is no CSRF exposure, and `/api/v1/**` sits outside the CSRF middleware like `/api/public/**`.

### The routes

`GET/POST /api/v1/{companies,contacts,leads,deals,tasks,activities}` and `GET/PATCH /api/v1/{...}/{id}` (activities: list per record and create only, as in the application).
Each calls the same service as the application's own route, so permissions, ownership, **masking**, archive rules, audit and RLS are those of the token's owner. Lists use the standard page envelope (`limit`, `cursor`, `page`, `pageSize`, `sort` on leads). Creates accept `Idempotency-Key`. Errors use the one error envelope. A deal's stage change goes through the same move gates as in the application (`updateDealChecked`).

### Rate limits

120 requests per minute per token and 600 per minute per address (the address limit protects the token lookup from floods of bad tokens). Over the limit: 429 `RATE_LIMITED`. Counters live in `auth_rate_limit_attempts` like the other public limits.

### The document

`GET /api/v1/openapi.json` (a token of any scope, or a signed-in session; nobody anonymous). Generated from the Zod schemas in `src/api/publicApi/schemas.ts` and the operation list in `src/api/v2OperationsC.ts`. It also documents the token and webhook management routes and the webhook payload and signature (`x-webhooks`).

## 2. Outbound webhooks (FIG-804)

| What | Where |
|---|---|
| Events, signing, backoff constants | `src/lib/webhookEvents.ts` |
| Address safety (SSRF) | `src/lib/ssrfGuard.ts` |
| Endpoints, emit, delivery | `src/services/webhookService.ts` |
| Job `webhooks.deliver` | `src/jobs/webhookJobs.ts` |
| Tables `webhook_endpoints`, `webhook_deliveries` (RLS, composite foreign keys) | `20261123090100_api_tokens_webhooks` |
| Routes | `/api/orgs/{org}/webhooks`, `/{id}`, `/{id}/rotate-secret`, `/{id}/test`, `/{id}/deliveries`, `/{id}/deliveries/{delivery}/retry` (Management only) |

### Events

`lead.created`, `lead.assigned`, `lead.converted`, `deal.stage_changed`, `deal.won`, `deal.lost`, `contact.created`, `company.created`, `task.created`, plus `webhook.ping` (the test button). They are emitted from the services that change the record (`createLead`, `assignLead`, `convertLead`, `updateDeal`, `createContact`, `createCompany`, `createTask`, and `lead.created` also for the public website endpoint and web forms, through `emitLeadCreatedById`), after the change is saved. `emitWebhookEvent` never throws and never waits for the network. A stage move is `deal.stage_changed`; a move into a won or lost stage also emits `deal.won` or `deal.lost`. Not emitted: records created by a data import or the migration engine (they write through repositories, in bulk), the contact and company a website lead creates along the way, a deal made by lead conversion (only `lead.converted` is sent), and a deal move that is undone. These are listed as gaps for follow-up.

Payload: `{ id, type, createdAt, organizationId, data }`. `id` is the event id, the same on every attempt, so a receiver can ignore repeats. `data` carries a **fixed field list per record kind**, never the whole row, so notes and other free text cannot leave by accident.

### Signing

Each delivery carries `X-Figbloom-Timestamp` (unix seconds, set when the attempt is signed), `X-Figbloom-Signature: v1=<hex>` and `X-Figbloom-Event`, `X-Figbloom-Delivery`. The signature is HMAC-SHA256 of `<timestamp>.<raw body>` with the endpoint secret (`whsec_...`). A receiver recomputes it, compares in constant time and refuses a timestamp older than 5 minutes (`verifyWebhookSignature` in `src/lib/webhookEvents.ts` is the reference). The secret is stored sealed (`src/lib/secretBox.ts`, needs `INTEGRATION_ENCRYPTION_KEY`), shown once when the endpoint is created or rotated, and rotation takes effect at once (the old secret stops verifying; there is no overlap window).

### Delivery and retries

An event writes one PENDING row per subscribed endpoint and queues a `webhooks.deliver` job. The job sends what is due, claimed under a lease (`FOR UPDATE SKIP LOCKED`, so two workers never send the same one). Retry timing is on the delivery row, not in the job (so a failing receiver never dead-letters the job): after a failed attempt the next one waits 1, 3, 9, 27 minutes ... up to 6 hours; after 8 attempts (about eleven hours) the delivery is DEAD. 2xx is success; a 3xx is a failure (redirects are never followed). A 410 Gone, or ten dead deliveries in a row, switches the endpoint off (audited as `webhook.disabled`); Management resumes it with `PATCH status=ACTIVE`. Management can retry a dead delivery. The job also runs on a 5-minute schedule as the safety net, so the scheduler call `/api/cron/jobs` must fire at least that often (see `docs/JOBS.md`). The delivery log (`GET .../deliveries`) shows status, attempts, next attempt, status code and the error; it does not repeat the payload.

### Masking

Payloads are built as the **endpoint's creator**, resolved afresh at the moment of the event. A deal's value is run through `maskDeal` for that person's role (`value: null`, `valueMasked: true` without `deals.view.value`); margin is never sent. If the creator no longer has access, nothing is sent for that endpoint (rather than sending unmasked data).

### Address safety (SSRF)

Three layers, each enough by itself: (1) the URL text is checked when saved (https only, no credentials, port 443 or 1024 and up, no `localhost`, internal suffixes, dotless names, or private/loopback/link-local/metadata/carrier-NAT addresses in any IPv4 form or any IPv6 form including IPv4-mapped, NAT64 and 6to4); (2) a host name is resolved when saved and refused if any answer is not public; (3) every delivery connects through a custom `lookup` that checks the very address the socket will use, so a name that changes its answer later (DNS rebinding) is refused with nothing sent. Responses are capped at 4 KB and requests time out after 10 seconds.

`WEBHOOK_ALLOW_HTTP=true` allows `http://` for developing a receiver; it is ignored in production. There is no switch that allows private addresses.

## Tests

`tests/publicApi.test.ts` (18): hashing and once-only display, expiry, scopes, revocation, owner removal and suspended organisation, rate limit, masking as the owner's role, cross-organisation reads and writes, RLS and composite foreign keys on `api_tokens`, the document. `tests/webhooks.test.ts` (48): Management-only, once-shown and rotatable secret, 27 refused addresses, DNS rebinding with a live loopback server, every event from the real services, fixed field list, signature, replay and tamper checks, masking by creator, backoff and DEAD, retry, 410 and auto-disable, redirect as failure, the job, tenant isolation and RLS on both tables.

## Decisions taken without being asked (reversible)

- Any member may create a token for themselves; there is no new permission key, so the permission matrix is unchanged.
- Webhooks are Management only (`organization.manage_settings`), as the issue says "org admins".
- Creates return 200 (as the application's own creates do) rather than 201, because the idempotent replay stores and returns the first status.
- Webhook secret rotation has no overlap window.
