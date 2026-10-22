# API conventions

How every `/api/orgs/<org>/...` route is built (FIG-1014, B0.06). The leads list and create, and the deal detail, are the reference implementations: copy their shape when you convert or add a route. Frontend code and the typed client (F1.06) rely on these rules, so a route that breaks one is a bug.

## 1. Zod schemas are the source of truth

- Request and response shapes live in `src/api/dto/<area>.ts` (shared pieces in `common.ts`). One schema per request body, query and response.
- The route **parses** the request with the schema (`parseJsonBody`, `parseQueryParams`).
- The route **checks** its response with `respond(Schema, data)` (`src/api/respond.ts`). Outside production a response that does not match the schema throws, the route returns a 500 and the log lists the fields that drifted. In production the check is skipped for speed; the contract tests keep production honest.
- Response schemas are `z.strictObject`, so a new field must be added to the schema in the same change. Related records included on a response (company, stage ...) are `relation({...})`: only the fields clients rely on are pinned.
- Dates are `isoDateTime` and money is `decimalString` (they are JSON strings on the wire).
- The OpenAPI document is generated from the same schemas (section 6). Never hand-write a second description.

## 2. Error envelope

Every error from every route has this body (`src/lib/apiErrors.ts`):

```json
{
  "error": "Missing required permission: organization.manage_settings",
  "code": "FORBIDDEN",
  "message": "Missing required permission: organization.manage_settings",
  "fieldErrors": [],
  "requestId": "6f7c...",
  "denial": { "role": "Sales", "requiredRoles": ["Management"], "whoToAsk": "your organisation's Management users" }
}
```

| `code` | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Not signed in |
| `FORBIDDEN` | 403 | Signed in, role cannot do this; has `denial` |
| `NO_ACTIVE_MEMBERSHIP` | 403 | Not an active member of the organization |
| `NOT_FOUND` | 404 | Not in this organization |
| `VALIDATION_FAILED` | 400 | Bad input; `fieldErrors` lists `{path, message}` |
| `RATE_LIMITED` | 429 | Too many requests |
| `FEATURE_UNAVAILABLE` | 403 | The feature is not in this release yet, or switched off for the organization; `feature` says which and when (`docs/FEATURE_FLAGS.md`) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Idempotency key reused for a different request |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same key, first request still running |
| `INTERNAL_ERROR` | 500 | Anything unexpected; the cause is logged, never returned |

- `denial` feeds the explained no-access screen (S4): the caller's role, the roles that could do it, and who to ask. Services throw `ForbiddenError` via `requirePermission`, which attaches the role and permission keys.
- `error` (same text as `message`) and `issues` (same data as `fieldErrors`) are the pre-B0.06 fields. They stay so existing code keeps working; new code reads `code`, `message` and `fieldErrors`.
- `requestId` is also the `x-request-id` response header (on success too). A caller may send its own `x-request-id` (8 to 128 characters of letters, digits and `. _ : -`); anything else is replaced. Quote it when reporting a problem.
- Throw typed errors from services (`ValidationError`, `NotFoundError`, `ForbiddenError`, ...). Routes never build error bodies by hand: wrap the handler in `handleRoute`.

## 3. Lists: paging, sort, filter, search

Query parameters (paging in `src/lib/pagination.ts`, sort and filter in `src/lib/listQuery.ts`):

| Parameter | Meaning |
|---|---|
| `page` | 1-based page number (default 1) |
| `pageSize` or `limit` | 1 to 100 (default 25); `pageSize` wins if both are sent |
| `cursor` | The `nextCursor` of the previous response; wins over `page` |
| `sort` | `field` ascending, `-field` descending; each route lists its allowed fields, anything else is a 400 |
| `filter[key]` | One filter per key (`parseFilters`); unknown keys are a 400 |
| `q` | Free-text search, defined per route |

Response (`pageOf(item)`): `items`, `page`, `pageSize`, `total`, `pageCount`, `nextCursor` (null on the last page).

- V1 lists are offset-paged because every list view needs a total and "page N of M". A stable `id` tiebreak is always the last sort key, so a row is never repeated or skipped.
- `cursor` is opaque. Today it wraps the next page number; a keyset cursor can replace it later (offline sync, B4.07) without changing the contract.
- Own-versus-organisation scope is enforced by the service, never by a client-supplied filter.
- Existing list routes keep working; adopt `limit`, `cursor`, `sort` and the envelope when a route is converted. Leads is done.

## 4. Idempotency keys on creates

For create endpoints used by mobile and offline sync (leads so far):

- Send `Idempotency-Key: <unique string>` (8 to 200 printable characters, a UUID is fine).
- Retrying the same request with the same key returns the first response with `Idempotent-Replayed: true` and creates nothing.
- Same key with a different body or path: 422 `IDEMPOTENCY_KEY_REUSED`. Same key while the first request is still running: 409 `IDEMPOTENCY_IN_PROGRESS` (a claim older than 60 seconds is treated as a crashed request and retaken).
- A request that fails is not stored; the key is freed so the retry runs again.
- Keys belong to one person in one organization (table `idempotency_keys`, row-level security, composite tenant key) and are forgotten after 24 hours.
- No header means no change in behaviour.
- To add it to another create route: `withIdempotency(ctx, request, body, () => create(...))` from `src/lib/idempotency.ts`, and mark the operation `idempotent: true` in `src/api/openapi.ts`.

## 5. Record fields the UI draws from

Every record DTO carries three standard fields (`RecordMetaShape`):

| Field | Meaning |
|---|---|
| `archived` | The record is archived (archived pill, read-only banner) |
| `masked` | A value on the record is hidden from this caller (deals: the value). Deals also keep `valueMasked`, the older name |
| `scope` | `own`: the caller sees only their own records; `organisation`: they see the whole organisation and may edit this one; `read-only`: they may view but not edit this record |

Build them in the DTO mapper (`toLeadDto`, `toDealDto`), never in the page. Masking itself stays in the service (rule 7); `masked` only reports it.

## 6. OpenAPI

- `src/api/openapi.ts` lists the converted operations (`OPERATIONS`) and builds an OpenAPI 3.1 document from their Zod schemas (Zod's own JSON Schema output; no extra generator).
- Outside production it is served at `GET /api/openapi.json`.
- `npm run openapi:export [path]` writes `openapi/openapi.json` (git-ignored). CI runs it and keeps the file as the `openapi` build artifact for diffing and for the typed client.
- A route appears in the document only after it is converted; converting means moving its schemas to `src/api/dto/` and adding a line to `OPERATIONS`.

## 7. CSRF (FIG-802)

The session cookie is `httpOnly` and `sameSite: lax`. Lax stops most cross-site POSTs but still travels on a top-level form navigation, so state-changing requests are also checked centrally in `src/middleware.ts` (rule in `src/lib/csrf.ts`):

- Every non-GET/HEAD/OPTIONS request under `/api/orgs/**` and `/api/auth/**` must carry an `Origin` (or, without one, a `Referer`) that matches the app origin: the origin the request arrived on (honouring `x-forwarded-host` / `x-forwarded-proto` behind a proxy) or `APP_BASE_URL`. Anything else, including a missing or `null` origin, gets `403` with code `CSRF_REJECTED` in the standard envelope.
- Exempt by path, because they do not use the cookie: `/api/public/**` (API key), `/api/cron/**` (secret) and `/api/health`.
- Browsers add `Origin` on every POST, so the app's own pages need no change. A script that calls the API with a session cookie must send `Origin` itself; e2e tests use `apiPost` in `e2e/helpers.ts`.
- Cookie stays `lax`, not `strict`: notification, invite and password-reset emails link into the app, and `strict` would drop the session on that first click-through and bounce a signed-in user to the login page.

## 8. Converting a route: checklist

1. Move or write the request and response schemas in `src/api/dto/<area>.ts` (strict responses).
2. Parse the request with them; wrap the handler in `handleRoute`.
3. Return `respond(ResponseSchema, ...)` and add record fields with a `to<Thing>Dto` mapper.
4. Add the operation to `OPERATIONS`.
5. If it is a create, wrap it in `withIdempotency`.
6. Add a contract test next to `tests/apiConventions.test.ts` (real handler, real database, check the body against the schema) and an authorization test for each role.
