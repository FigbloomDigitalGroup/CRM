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
