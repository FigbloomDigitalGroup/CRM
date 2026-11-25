# API changelog

The V1 contract is `src/api/contract/openapi.v1.json` (generated from the Zod schemas, the recorded walk and `src/api/accountOperations.ts`).
After 1.0.0 it changes only with a version note here. `tests/apiContract.test.ts` fails when the contract in the code differs from the
frozen file, and when this file does not carry the frozen file's hash, so a change cannot ship without both.

To change the API on purpose:

1. Make the change and its tests.
2. `UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalk.test.ts` (only if a route, its request shape or its permissions changed; review the matrix diff).
3. `npm run contract:update` (rewrites the frozen file, the typed client and `docs/API_REFERENCE.md`; prints the new hash).
4. Add a section below with the new `contract-hash:` line and what changed, who it affects, and whether it breaks existing callers.

A change that removes or renames a path, field or enum value, narrows what a role may do, or makes an optional field required is **breaking** and
needs a new major version (`API_VERSION` in `src/api/openapi.ts`). Additions are minor. Wording-only and documentation changes are patches.

## 1.1.0, addendum — roles brought forward from V2 (25 Nov 2026)

contract-hash: ec13a6f26ccc9082de47a9f462af57dc02749d0d359ae280beb6e9036c006442

No path, field or enum changed (still version 1.1.0). The roles routes (`GET`/`POST /orgs/{org}/roles`, `GET`/`PATCH`/`DELETE /orgs/{org}/roles/{roleId}`, `GET /roles/catalog`, `POST /roles/preview`) and `GET`/`PUT /orgs/{org}/memberships/{membershipId}/permissions` are gated by the organisation toggle `roles.custom` (V1.1 and later, on by default) instead of the V2 release, and the permission `roles.manage` now takes effect from V1.1 (it was V2-only, so Management held it on no V1.1 organisation). On a V1.1 organisation Management is now allowed where the contract recorded `D` (feature unavailable or no permission), on all seven roles routes; the other four roles stay denied. Widens access for Management only, so not breaking. See `docs/ROLES_ACCESS_SCREENS.md`.

## 1.1.0, addendum — per-member permission overrides (UC-C5 step 3, FIG-1790, 24 Nov 2026)

contract-hash: c7e5d7846d2145ea55ffac4d00900a1bad399d09053238c097b10bd269260863

Additive only (still version 1.1.0, V2). `GET` and `PUT /orgs/{org}/memberships/{membershipId}/permissions` (`getMemberAccess`, `setMemberAccess`; `role.assign`, Management): add or remove single permission keys for one member on top of the role. See `docs/MEMBER_ACCESS_OVERRIDES.md`. No existing path changed. Re-run `npm run contract:update` after any later API change and replace the hash on this line.

## 1.1.0, addendum — typed service interest (18 Nov 2026)

contract-hash: 6e840859ead1653d3302937498fac3cfce491356398792b1f062c2b78f0eea22

Additive only. `POST /orgs/{org}/leads` and `PATCH /orgs/{org}/leads/{leadId}` accept an optional `serviceInterestName`: the service with that name is used, or it is added to the organisation's service list (needs `leads.create` or `leads.edit`). Ignored when `serviceInterestId` is sent on create. No existing caller is affected.

## 1.1.0 — Phase 2 improvements, additive (FIG-1675 to FIG-1681, M19, 15 Nov 2026)

contract-hash: 5e60ccf1e23f57d354285a8d1cb9ae4d99693355990159f3f7b5538bbf3e4005

Additive only (still version 1.1.0). No path removed or renamed, no required field added.

- **New lead (FIG-1675):** `POST /orgs/{org}/leads` and the public API accept optional `newCompanyName` and `contact { name, email, phone, role }`; the response may carry `contactReused` and `companyReused`. Quick capture accepts an optional `role`.
- **Tasks and Calendar (FIG-1676, FIG-1677):** tasks gain `type` (TASK, CALL, MEETING, EMAIL, QUOTE, VISIT), `sourceActivityId` and `isFollowUp`; the tasks list and groups routes take an optional `type` filter; `POST /activities` takes an optional `nextStep`; `POST /calendar` with `kind: "activity"` now saves a task and answers `{ kind: "task", id, type, start }` (it used to save an activity that the Tasks page never listed).
- **Key notes (FIG-1678):** new `GET /orgs/{org}/leads/key-notes?leadIds=` (the latest 3 notes per lead, up to 50 leads).
- **Follow-up time (FIG-1681):** `PATCH /leads` `nextFollowUpAt` also accepts a date-only value (stored at 09:00 in the caller's time zone); quick-log `followUp.dueOn` accepts a date-time.
- **Import and export for every role (FIG-1680):** no route changed shape. Roles other than Management now hold the import and export keys, so those routes answer according to the caller's own access instead of 403 for everyone but Management. Exports are capped at 20,000 rows and rate limited.

## 1.1.0 — Request-shape record caught up, documentation only (M19, 13 Nov 2026)

The recorded request shapes now also list the optional `language` and `allowSigning` fields that `POST /orgs/{org}/api-tokens` and `PATCH /orgs/{org}/webhooks/{endpointId}` (and the user language preference) already accepted from the V2 backend work; they had not been written into the snapshot. Nothing changed for callers. The contract hash in the two sections below is the contract after this catch-up.

## 1.1.0 — Team page endpoints, additive (FIG-1598, P2-15, 12 Nov 2026)

contract-hash: 5e60ccf1e23f57d354285a8d1cb9ae4d99693355990159f3f7b5538bbf3e4005

Additive only (still version 1.1.0). Four new Management-only routes, all `GET`, under `/orgs/{org}/team`: `summary`, `members` (filter by `role`, `status`, `q`; `sort`; `page`/`pageSize`), `members/{membershipId}` and `attention`, each taking an optional `range` (`today`, `7d`, `30d`). Every other role gets the explained 403. A figure the caller's role may not see is `null`, deal values are `{ amount: null, masked: true }`, and payments never appear. No existing path changed. The hash line above is the contract as it stood when this was written: re-run `npm run contract:update` after any later API change and replace it (the same line appears in the section below when both changes are in one contract).

## 1.1.0 — Team activity preferences, additive (FIG-1600, P2-17, 12 Nov 2026)

contract-hash: 5e60ccf1e23f57d354285a8d1cb9ae4d99693355990159f3f7b5538bbf3e4005

Additive only (still version 1.1.0). `GET /me/notification-preferences` gains an optional `teamActivity` list (Management only) and `PATCH /me/notification-preferences` accepts an optional `teamActivity` object (event, channels, `mode` INSTANT, HOURLY or DAILY). Notifications gain `actorName` and a new type `TEAM_ACTIVITY`. No path changes. Re-run `npm run contract:update` after any later API change and replace the hash on this line.

## 1.1.0 — V1.1 routes described from a V1.1 walk, merged with the V2 routes (G2.03, 10 Nov 2026)

contract-hash: 9ec64d4c8a94158d9ee48fa45605d357370311a219595fb9430853524787644e

Documentation only, still version 1.1.0 and before the `api-v1.1` tag. The V1.1 routes are described from a walk of every route as each role on a V1.1 organisation (real allowed roles, request schemas, response shapes; see the amended V1.1 section below), now combined with the V2 routes added in M17. No route, status code or behaviour changed.

## 1.1.0 — V2 backend routes, additive (M17, Nov 2026)

contract-hash: 07436fd0247605dd10a8f3fba1bfe37cbbacea589023f1bc631cc6105a1a1f2d

Additive only (still version 1.1.0, behind `release.v2`): support access (request, approve, open, end, page-view log), per-organisation flags and limits, announcements and dismissals, e-signature signing (`/api/public/sign/{token}`), per-document client language, custom roles and field rules (`/roles*`), churn hints (`/churn-hints*`), API token and webhook management. The public `/api/v1/*` API has its own document at `/api/v1/openapi.json`. Existing routes keep their behaviour.

## 1.1.0 — V1.1 backend, additive (Nov 2026)

contract-hash: d744bd6ed6b4173259cdba95931b5964a4ef19ad68353d7f1135e457c9f93b0b

Amended before the `api-v1.1` tag (9 Nov 2026, G2.03, FIG-1158), so no caller can have depended on the earlier text: the V1.1 routes were recorded on a V1 organisation, where every one answers "not in your release", so the contract listed them as refused for every role (`x-allowed-roles: []`) with no request or response schema. They are now described from a walk of every route as each role on a V1.1 organisation (`tests/apiWalkV11.test.ts`, recorded in `src/api/contract/*V11.json`): the roles the permission model lets through, the request schema each route validates against, and the shape of its answer. The mock server serves the V1.1 examples for those routes (`src/api/contractExamples.ts`). No route, status code or behaviour changed; only the documentation of V1.1 routes did. Platform console, sign-in and two-step routes remain outside the contract (`src/api/accountOperations.ts`); they are not organisation routes and the platform walls are held by `tests/platformTenantDenialV11.test.ts`.

Minor version: nothing existing was removed or renamed, so V1 callers keep working.

- 95 new paths (platform console, Mailgun inbound email route (FIG-806), two-step sign-in, quotes and approvals, chat, OAuth and mail/calendar sync, assistant, card capture, sequences, forecast, saved views, web forms, support requests by email through Resend (`POST /orgs/{org}/support-requests`; there is no Customer Support role and no ticket API, decision 12)). Every V1.1 organisation route answers 403 `FEATURE_UNAVAILABLE` unless the organisation's release is V1.1 or later.
- Additive changes to existing routes: `deals/board` accepts `pipelineId`; `search` accepts type `messages`; `deals/{id}/move` and `move-check` accept `changePipeline`; some responses gained optional fields.
- Behaviour change to note: the sign-in and accept-invite API answers may now ask for a second step when the member has two-step sign-in on. The frozen pages are unchanged.

## 1.0.0 — V1 freeze (26 Oct 2026)

contract-hash: 2820832eaa826052cb87e11656c82838b19c762a67140235d87266a0b3e73c41

First frozen contract. Tag `api-v1.0` marks this version once the gate (G1.08) is approved.

Amended before the tag (27 Oct 2026, after the tenant attack and security review, so no caller can have depended on the earlier text): creating a lead with a status, source, company, contact or service from another organisation, recording a communication against an unknown activity, adding a duplicate proposal number, and website-key settings with no key now answer 4xx with the standard error envelope instead of 500; reading an attachment's file needs access to the record it is attached to. No path, field or enum changed.

- 284 paths and every organisation, account, public and scheduler route in `src/app/api`, except four left out on purpose
  (`/api/dev-session`, `/api/dev-sentry-test`, `/api/platform/preferences`, `/api/openapi.json`; reasons in `src/api/accountOperations.ts`).
- Request bodies and queries are the schemas the routes validate against. Operations marked `x-contract-source: derived` have their request
  schema recorded from the route itself and their answer described by shape rather than a hand-written schema; they tighten in V1.1 without
  changing behaviour.
- Every operation names the credential it takes (`security`) and the roles the permission matrix lets through (`x-allowed-roles`).
- Found and fixed while recording it (behaviour changes that clients may notice):
  - `POST /communications` with an unknown or other-organisation `activityId` now answers 400 (was a 500).
  - `POST /deals/{dealId}/proposals` with a proposal number the deal already has now answers 400 `DUPLICATE_PROPOSAL_NUMBER` (was a 500).
  - `POST /integrations/website-key/settings` before any website key exists now answers 404 (was a 500).
  - Files attached to a record (`/files/{id}`, `/download`, `/content`, `DELETE`) now need access to that record: holding `attachments.manage`
    no longer opens another person's attachment by file id. A file not yet attached belongs to the uploader alone.
